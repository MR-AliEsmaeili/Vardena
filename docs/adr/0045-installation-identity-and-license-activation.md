# ADR-0045: Persistent installation identity and local license activation

- **Status:** Accepted for L-02 (extends ADR-0030; does not replace its model). Decisions 2, 5, 6 and 7 are extended by **ADR-0046** (signed license documents, retained versions and effective-version resolution); the identity decision below still stands and is unchanged.
- **Renumbering note (2026-10-11):** This record was filed as `0036-installation-identity-and-license-activation.md` while `0036-legal-reporting-architecture.md` already held number 0036 and was the registered one. PDR-11 §19 recorded the collision as CF-14. It is renumbered to **ADR-0045** (the next free identifier; ADR-0027 stays unused, per the ADR index rule). **The decision text below is unchanged** — only the number, this note and the cross-reference note were added. The former path keeps a pointer file so historical links do not break. Historical task reports and acceptance records that cite "ADR-0036" for licensing are **not** rewritten; they are read through this note.
- **Reconciliation note (2026-10-11):** The Owner-approved licensing product requirements are recorded in [PDR-11](../decisions/product/PDR-11-vardena-licensing-product-requirements.md). Several of them conflict with this ADR (for example: future-dated renewals, refusal of not-yet-valid licenses, text code vs. signed file as delivery, identity after reinstallation or restore, and session behavior under full revocation). See PDR-11 §19 (CF-1 to CF-12). PDR-11 §19.4 and `docs/tasks/pdr-11-conflict-reconciliation.md` record how each was handled; the conflicts resolved by design are settled in **ADR-0046**.
- **Date:** 2026-10-01

## Context

L-01 evaluated a license that came from configuration
(`LocalDevelopmentLicenseProvider`). That is enough to prove the enforcement
chain, but it is not a licensing foundation: the installation had no identity
of its own, nothing was ever activated, nothing survived a restart as data,
and a deployment with `NODE_ENV=development` was effectively licensed by
accident. A license that can be granted by an environment variable is not a
license.

L-02 keeps the ADR-0030 model unchanged and answers the three questions it
left open: *who is this installation*, *how does it obtain a license*, and
*where does that license live*.

## Decision

1. **The installation has one backend-owned identity.** It is a ULID row in
   `licensing.installations` (`is_self = true`, enforced by a partial unique
   index), created exactly once — on first need — by
   `InstallationIdentityService` and read from the database ever after. It is
   not derived from hardware (MAC, CPU, disk serial, IP), not derived from the
   browser, and never generated on the client. A reinstall onto the same
   database keeps the identity; a new database is a new installation.
2. **A license is bound to that identity.** The signed payload names an
   `installationId`; activation rejects any license whose `installationId` is
   not this installation's. Binding is checked before anything is persisted.
3. **Activation is an authenticated, authorized write.**
   `POST /api/v1/license/activate` takes *only* a license code, requires the
   dedicated `Licensing.License.Activate` permission (no public endpoint, no
   "is admin" bypass, no email/username check), and returns the newly
   evaluated state. The caller never supplies status, validity, limits or
   entitlements: the backend derives all of them from the verified payload.
4. **Local-first trust: Ed25519 signatures, no network.** A license code is
   `VLIC1.<payload-base64url>.<signature-base64url>`. The installation holds
   only the authority's **public** keys (`LICENSE_SIGNING_PUBLIC_KEYS`,
   comma-separated so the authority can rotate). No activation server, no CRM
   call, no phone-home at startup or at any other time. An empty key list
   rejects every activation; an already-activated license keeps evaluating.
5. **Persistence is the licensing schema, not configuration — and the raw
   code is not part of it.** The activated license is a row in
   `licensing.licenses` with typed entitlement rows; the current license is
   the one with `replaced_at IS NULL` (partial unique index per
   installation). Only `code_hash = SHA-256(code)` is stored: it is all that
   idempotent re-activation needs, it is irreversible, and no encrypted or
   encoded copy of the code exists anywhere in the schema. Restarting, redeploying or rebuilding the container
   changes nothing — destroying the database volume does.
6. **Deterministic replacement.** Re-activating the same code is an idempotent
   no-op (`changed: false`). A different valid code replaces the current one
   in a single transaction, stamping `replaced_at` on the previous row so the
   history is auditable. An invalid code is rejected *before* any write: a
   valid license is never destroyed by a failed activation attempt.
7. **Rejection order is fixed:** authorization → authenticity (format,
   version, signature) → installation binding → semantics (validity interval,
   limits, entitlement codes) → lifecycle (status, dates). Nothing is
   persisted unless every stage passes.
8. **`NODE_ENV` has no licensing meaning.** The provider is chosen by name:
   `LICENSE_PROVIDER=persistent` (default) reads the activated license;
   `LICENSE_PROVIDER=local-development` keeps the L-01 configuration provider
   for automated tests and local work. Development is never implicitly
   ACTIVE.
9. **`UNLICENSED` is a distinct state, not an expired license.** An
   installation that never activated anything reports
   `status: 'UNLICENSED', licensed: false, active: false,
   inactiveReason: 'unlicensed'` together with its `installationId`, so an
   operator can obtain a license for it. Lifecycle values stay
   `ACTIVE | EXPIRED | SUSPENDED`.
10. **Bootstrap allowance.** A never-licensed installation may hold exactly
    one active user — the administrator who activates the license. Requiring
    a license to create the only account that can install one is a deadlock.
    The allowance grants no permission, unlocks no organization, is enforced
    by the same advisory-locked count as a licensed limit, and does not apply
    to an installation whose license expired or was suspended. Pinned
    deployment-organization provisioning is *deferred* while unlicensed
    (bootstrap is idempotent: re-run it after activation).
11. **Code generation is never a product capability.** Issuing is a developer
    CLI (`npm run license:keygen`, `npm run license:issue`) that refuses to
    run with `NODE_ENV=production` and reads the private key from the
    environment of the *issuer's* machine. No endpoint, no service, no table
    stores a signing private key.
12. **Licensing and authentication remain independent.** License state never
    creates, extends or ends a session; session state never changes license
    evaluation. The one deliberate intersection is that platform permissions
    (`Licensing.*`) survive licence filtering, so an unlicensed installation
    can still be licensed by its administrator.

## Consequences

- A fresh installation is inactive until someone activates a license. This is
  the intended behaviour and is visible to operators as an explicit
  "not licensed yet" screen quoting the installation id.
- The database volume becomes part of the installation's identity: restoring
  a backup restores the identity and its license; starting from an empty
  database yields a new identity for which the old license is invalid.
- Key rotation is possible without re-issuing licenses to every installation
  only while both the old and the new public key are listed.
- Revocation is not implemented: a license is valid until it expires, is
  suspended by issuing a replacement, or is replaced. Remote revocation would
  need the network dependency this ADR deliberately avoids.
