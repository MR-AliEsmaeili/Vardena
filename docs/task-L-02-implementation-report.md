# L-02 — Installation identity, license activation, session continuity

Companion to `docs/licensing-architecture.md` and ADR-0036. L-01 proved the
enforcement chain against a configured license; L-02 gives the installation an
identity of its own, a way to be licensed, and a place for that license to
live.

## What changed

| Concern | L-01 | L-02 |
| --- | --- | --- |
| Installation identity | none (a string inside the configured license) | ULID row in `licensing.installations` with `is_self = true`, created once by the backend |
| License source | environment variables | signed license code activated through the API; the derived license (not the code) is stored in `licensing.licenses` |
| Default provider | `local-development` | `persistent` (`LICENSE_PROVIDER`; `NODE_ENV` has no licensing meaning) |
| Fresh installation | ACTIVE in development | `UNLICENSED`, inactive, reporting its installation id |
| Activation | none | `POST /api/v1/license/activate`, `Licensing.License.Activate` only |
| Restart | re-read configuration | re-read the stored license; no re-entry, no activation at startup |

## Components

- `InstallationIdentityService` — reads or creates the single `is_self`
  installation row (plus its local customer) in one transaction; concurrent
  boots converge by re-reading after a lost race.
- `domain/license-code.ts` — `VLIC1.<payload>.<signature>` parsing, Ed25519
  verification against `LICENSE_SIGNING_PUBLIC_KEYS`, payload semantics
  (validity interval, positive-or-null limits, known entitlement codes) and
  the SHA-256 `codeHash` used for idempotency.
- The raw license code is **never written to the database**. It exists only
  in memory during activation; persistence receives the derived license plus
  `code_hash = SHA-256(code)` for idempotency, and nothing reversible.
- `LicenseActivationService` — fixed rejection order (authorization →
  authenticity → installation binding → semantics → lifecycle), idempotent
  no-op for the same code, transactional replacement stamping `replaced_at`,
  and no write at all on any rejection.
- `PersistentLicenseProvider` — the default `LicenseProvider`: reads the
  current (`replaced_at IS NULL`) license of this installation.
- `LicenseActivationController` / `LicenseStateController` — the write and the
  read; `GET /license/current` stays a pure evaluation.
- `src/tools/development-license-authority.ts` + `issue-development-license.ts`
  — key generation and issuing for development and tests only; refuses
  `NODE_ENV=production`; the private key is read from the issuer's
  environment and never stored.

## Deadlocks deliberately broken

1. **Permission deadlock.** An unlicensed installation has an empty effective
   permission set, so nobody could activate a license. Platform permissions
   (`Licensing.*`) now survive license filtering. The grant itself remains
   ordinary RBAC — no wildcard, no admin bypass.
2. **User deadlock.** An installation that never activated a license may hold
   exactly one active user, the administrator who activates it. The allowance
   is enforced by the same advisory-locked count as a licensed limit, grants
   no permission, unlocks no organization, and does not exist once a license
   has existed (expired/suspended ⇒ no allowance). Pinned deployment
   organization provisioning is deferred while unlicensed; re-run the
   idempotent bootstrap command after activation.

## Session continuity

Vardena has no second token to refresh: ADR-0007 opaque sessions already
provide a sliding idle deadline plus an absolute cap, and both remain
configurable. The regression that pushed users to the login screen was the
cookie: Express `res.cookie({ maxAge })` is milliseconds, and the value was
divided by 1000, so the browser discarded a 12-hour session after ~43
seconds. The cookie now carries the absolute lifetime; revoked, idle-expired
and absolutely-expired sessions still require a real login. Licensing and
authentication remain independent: license state never ends a session.

## Operating notes

- The `pgdata` volume holds the installation identity. An empty database is a
  new installation and old licenses will not activate against it.
- `LICENSE_SIGNING_PUBLIC_KEYS` accepts several comma-separated keys so the
  authority can rotate; an empty list rejects every activation while an
  already-stored license keeps evaluating.
- Remote revocation is not implemented (it would require the network
  dependency this design avoids): a license ends by expiry or replacement.
- No activation UI ships in L-02. The frontend only tells the operator that
  the installation is unlicensed and shows the installation id; activation is
  done through the API or the CLI.
