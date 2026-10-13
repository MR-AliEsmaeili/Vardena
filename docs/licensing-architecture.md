# Licensing architecture (L-01, L-02, L-03)

> **Status note (2026-10-11, updated).** This document describes the
> **implemented** licensing foundation: L-01 (enforcement chain), L-02
> (installation identity and local activation from a signed code) and **L-03**
> (signed license **files**, retained license versions, deterministic
> effective-version resolution, replay-safe import and a typed audit trail —
> `docs/licensing/version-model-and-file-exchange.md`, ADR-0046). The
> Owner-approved licensing product requirements are recorded in
> [PDR-11](decisions/product/PDR-11-vardena-licensing-product-requirements.md),
> which remains the product source of truth; its §19 conflicts were reconciled in
> §19.4 (`docs/tasks/pdr-11-conflict-reconciliation.md`). Everything PDR-11
> requires beyond this slice — Owner-side administration, full revocation,
> Grace/Read-Only enforcement, server replacement, the installation identity key
> and client-device licensing — is **not implemented** and is gated by the open
> items registered as OQ-74…OQ-85.

## Model

`Customer → Installation → License → LicenseVersion → Entitlement → assignable Permission → Role → Organization Membership → Access`

- **Customer:** minimal commercial identity; not the Organization party/customer master and not CRM.
- **Installation:** deployed Vardena instance. The current deployment is one installation and may contain multiple Organizations. Since L-02 it has a persistent backend-owned identity (below).
- **License:** installation-scoped commercial right, bound to exactly one customer and one installation (`licensing.licenses`). Since L-03 it holds no dates, limits or entitlements of its own — those belong to its versions. It is the future home of license-level revocation state (PDR-11 §10, OQ-78).
- **LicenseVersion:** one retained, signed version of a license (`licensing.license_versions`): validity window, status, limits, entitlements, signing key id, document hash, operation id, source, import facts and supersession state. Retained, never overwritten.
- **Entitlement:** typed `MODULE` or `FEATURE` capability, owned by a version. Feature codes do not imply the feature is implemented.
- **Permission:** code-defined RBAC operation. Only permissions whose module prefix is entitled are assignable/effective.
- **Membership/Role/Access:** unchanged authorization layers. Licensing does not grant access.

## Implemented enforcement

`LicensingService` evaluates the configured `LicenseProvider`. `PermissionsService` supplies only licensed permission codes and refuses an unlicensed assignment. `AuthorizationService` intersects stored grants with licensed modules on every evaluation. A removed entitlement therefore does not delete `rbac.role_permissions`; it makes the grant ineffective until restored.

`OrganizationsService.createOrganization` and pinned-organization bootstrap check active status, the `organization` entitlement, and the installation organization count. `UsersService.createUser` (when active) and re-enablement check the unique active row count in `users.users`. Membership in several Organizations does not multiply this count because memberships are not counted.

Limits and perpetual validity use SQL/configuration null. Positive integers are finite limits. A version's `validFrom` is inclusive; `validUntil` is exclusive.

Finite limit allocation is concurrency-safe. Organization creation and active-user creation/re-enablement execute their count and mutation in one PostgreSQL transaction while holding a transaction-scoped advisory lock derived from the licensed `installationId` and resource (`organizations` or `active-users`). Contenders for the same installation/resource serialize; after the winner commits, the next contender re-counts and is rejected at the limit. Authorization, validation, and password hashing remain outside this narrow transaction.

## Installation identity (L-02, ADR-0045)

The installation identifies itself with one row in `licensing.installations`
marked `is_self = true` (a partial unique index allows exactly one). The ULID
in that row is the installation id. `InstallationIdentityService.current()`
reads it and, only when it is absent, creates it inside a transaction that
also creates the installation's local customer row; a lost race is resolved by
re-reading, so concurrent boots converge on one identity.

The identity is therefore:

- **backend-owned** — never generated, stored or sent by the browser, and
  never read from `localStorage`;
- **stable** — created once and read from the database afterwards, unchanged
  across restarts, redeploys and image rebuilds;
- **not a fingerprint** — no MAC address, CPU id, disk serial, hostname or IP
  takes part in it. Hardware may change freely;
- **as durable as the database** — the `pgdata` volume (see
  `docker-compose.yml`) is what makes it survive. An empty database is a new
  installation, and a license issued for the old identity will not activate
  against it.

Licensing import never creates, recreates or adopts an installation: a document
for an unknown installation is rejected and no row is written (PDR-11 §6.5,
CF-5). A database restore that lacks identity material cannot silently become
the previous installation — it fails binding, and recovery stays an Owner-side,
auditable process.

### Installation identity key (designed, not implemented)

PDR-11 §5.1 requires a **dedicated cryptographic identity key** in addition to
the identity id: generated on first run, private part on the server, independent
of commercial activation. The two facts are separated by design
(`docs/licensing/version-model-and-file-exchange.md` §7) but the key is **not
implemented**: its storage depends on the backup-encryption design (PDR-11 U-2,
§6.1–§6.2 forbid escrow) and its loss must lead to the replacement workflow
(PDR-11 §6.4, U-9, PQ-3 → OQ-78/OQ-82), which does not exist. Until then the
installation id is the only binding identifier, exactly as in L-02.

## License documents, versions and effectivity (L-03)

A license reaches an installation as a **signed document**:

```text
file  :  { "format": "vardena-license", "fileVersion": 1, "document": "VLIC2.…" }   (primary)
text  :  VLIC2.<payload-base64url>.<signature-base64url>                            (fallback transport)
legacy:  VLIC1.<payload-base64url>.<signature-base64url>                            (L-02 compatibility)
```

All three decoders feed one verification pipeline, so the text transport is
never a weaker trust path (PDR-11 §7.12/§11.3). The payload is a canonical,
fixed-order record — `operationId`, `licenseId`, identifiers, `installationId`,
`status`, validity window, limits, module/feature entitlements and an optional
`supersedesOperationId` — signed with Ed25519 and verified against the
installation's trusted public keys. The installation stores **public keys only**
(`LICENSE_SIGNING_PUBLIC_KEYS`, comma-separated; `keyId:<material>` entries
allow key ids). A document naming an untrusted key id is rejected with a
distinct reason. Verification happens **at import only**, so rotating or
retiring a key cannot invalidate an already-retained version (PDR-11 §3.1,
CF-8).

### Version lifecycle

```text
import ─► retained ─┬─ not yet effective   (validFrom > now)
                    ├─ effective           (not retired yet, status ACTIVE, window contains now)
                    ├─ expired             (validUntil <= now, derived — never written)
                    └─ supersession        (recorded at superseded_at, in force from governs_until)
```

The **effective version** is resolved deterministically on every read
(`docs/licensing/version-model-and-file-exchange.md` §3.2): eligible versions are
those that have not stopped governing by the instant being evaluated
(`governs_until IS NULL OR governs_until > at`) — a recorded-but-not-yet-in-force
supersession does **not** make a version ineligible — and at most one of them may
cover that instant, because the import path enforces pairwise-disjoint effective
windows. A version therefore hands over exactly at its successor's `validFrom`,
which is what lets a future-dated renewal (or a future-dated supersession) be
imported without interrupting the license that is valid today. When nothing
covers the instant, an ended version reports `expired` and a future version
reports `not-yet-valid`; `UNLICENSED` remains the absence of any version. Status
vocabulary (`ACTIVE|EXPIRED|SUSPENDED`, `UNLICENSED`) is unchanged; the
`SUSPENDED` mapping question stays open (OQ-79) and no migration rewrites a
status value.

### Overlap, gaps and supersession — current status

The interim description from the initial L-03 slice was superseded by the
Product Owner decisions recorded in the
[OQ-80/OQ-86 decision brief](tasks/licensing-oq-80-oq-86-decision-brief.md)
and [PDR-13](decisions/product/PDR-13-post-gap-recovery.md). Their implementation
reached `main` through PR #142 (merge commit
`f0b047ae4950edced9e301411da710dd82c68ed1`). The current, detailed behavior is
maintained in the [version-model and file-exchange design](licensing/version-model-and-file-exchange.md#33-overlap-gaps-and-supersession);
the earlier interim wording is not the current rule. The merge and CI evidence
are not Product Owner acceptance; no acceptance record is present in this
repository. The verification record is
[`docs/tasks/licensing-post-merge-reconciliation.md` §16](tasks/licensing-post-merge-reconciliation.md#16-post-merge-verification-of-pr-142).

## Import, replay protection and audit

`POST /api/v1/license/import` accepts one field, the document (file contents or
text). Rejection order is fixed and total — authorization → transport parse →
payload version → signature (and key-hint check) → canonical/typed payload →
installation binding → document semantics (window, limits, entitlements, status,
already expired) → replay → version conflicts — and **nothing is persisted
unless every stage passes**. The submitted document and its signature are never
persisted; only a SHA-256 `document_hash` is retained.

Every v2 document carries a unique `operationId`. Applying it is one
transaction that **first takes a `FOR UPDATE` row lock on the installation row
and re-runs the conflict evaluation under it** (READ COMMITTED): customer
upsert, license upsert, version + entitlements insert, supersession stamp
(guarded, writing both the recorded and the hand-over instant), audit event
insert. A second application of the same operation is **rejected** (409,
`duplicate-operation`) and changes nothing; the unique index
`(installation_id, operation_id)` is the database backstop, and the row lock is
what makes the check authoritative for concurrent, *distinct* documents whose
windows conflict — the loser of such a race gets the documented 409 and writes
nothing. A document whose `licenseId` is bound to another customer, or belongs to
another installation, is refused with 409 (`license-binding-conflict`, nothing
written; see `docs/licensing/version-model-and-file-exchange.md` §3.5). A repeated legacy `VLIC1` code keeps its documented idempotent no-op
(`changed: false`) — the documented per-operation-type behaviour that PDR-11
PQ-8 asks about (OQ-81). Concurrency details and evidence: design §3.4,
ADR-0046 Decision 11, `test/licensing-persistence-live.e2e-spec.ts`.

Outcomes are recorded in the typed, append-only `licensing.license_audit_events`
table (`license.import.applied`, `license.import.rejected`,
`license.import.unchanged`, `license.version.superseded`) with actor, transport,
outcome, reason code, version/license ids and document hash — never a raw
document, signature or key. Retention is an open policy question (OQ-77); no
deletion exists. Rejections never change state, and an unverified document's
`operationId` is not trusted (it is recorded as null).

### Legacy L-02 semantics preserved

A different valid `VLIC1` code still replaces the single version that currently
governs (implicit legacy replacement: the version is stamped and retained, and
it stops governing when the new code's window starts); the same code again
remains an idempotent no-op. A `VLIC1` code may replace only that one version
implicitly — other overlaps, or a version whose supersession is already
recorded, are rejected rather than guessed.

## Migration from L-01/L-02 (migrations `20261014000000_licensing_version_model_and_import` and `20261015000000_licensing_supersession_governs_until`)

Every existing `licensing.licenses` row becomes a **retained version** (same
id, same status/provider/dates/limits/entitlements, `document_hash =
code_hash`, `source = 'legacy-code'`, `superseded_at = replaced_at`) and one
`licensing.licenses` row per distinct license id becomes the license identity;
entitlements move to `licensing.license_version_entitlements`. No validity,
history or idempotency is lost, no status is rewritten (CF-11 stays open), and
the L-02 partial unique index that encoded "exactly one current license" is
replaced by the version model.

The corrective migration adds `governs_until` (the instant a version stops
governing) and backfills it from the recorded successor's `valid_from` when one
is recorded — which repairs licenses that the first implementation retired the
moment a future-dated successor arrived — and otherwise from the recorded
instant, so migrated L-02 rows keep exactly the old meaning of `replaced_at`. A
check constraint keeps the two instants set together. Evidence:
`backend/prisma/rehearsal/licensing-version-model/rehearse.mjs` (including a
database that carries the premature-retirement defect and must come out
repaired) and the live PostgreSQL suite.

## Activation and persistence (L-02, ADR-0045)

`POST /api/v1/license/activate` remains available as the L-02 compatibility
alias for the same import pipeline (text code only). It requires an
authenticated session and the `Licensing.License.Activate` permission — an
ordinary user gets 403, an anonymous caller 401, and there is no "is admin"
shortcut. The backend derives every licensed fact from the verified payload; the
client can state nothing about status, validity, limits or entitlements.

`GET /api/v1/license/current` remains a pure evaluation: no retained version →
`UNLICENSED`/inactive with the installation id; otherwise the effective version's
state, or inactive with a reason (`status`, `expired`, `not-yet-valid`). It also
reports the effective `versionId`, an optional `scheduledVersion` (the next
not-yet-effective version) and a bounded retained-version history
(`versions`, newest first, 20 entries, `totalVersions`) so an operator can see
that a future renewal landed. It never activates anything and never calls out.

### Provider selection

`LICENSE_PROVIDER` chooses the implementation behind `LicensingService` and is
never inferred from `NODE_ENV`:

| value | behaviour |
| --- | --- |
| `persistent` (default) | evaluates the license this installation activated and stored |
| `local-development` | the L-01 configuration-backed synthetic license, for tests and local work |

`NODE_ENV=development` carries no licensing meaning whatsoever; the
`LICENSE_*` payload variables apply only to `local-development`.

### Bootstrap allowance

A never-licensed installation may hold exactly **one** active user: the
administrator who will activate the license (requiring a license to create the
only account able to install one would deadlock the installation). The
allowance is enforced by the same advisory-locked count as a licensed limit,
grants no permission, unlocks no organization, and does not exist for an
installation whose license expired or was suspended. Pinned
deployment-organization provisioning is deferred while unlicensed: run
`npm run bootstrap:system-admin` again after activation — it is idempotent and
provisions the organization then.

### Issuing a development or test license

Issuing is a developer CLI, never a product endpoint. It refuses to run with
`NODE_ENV=production`, and the private key lives only in the issuer's
environment — never in frontend config, never in the database, never in an
application table:

```
npm run license:keygen                                   # prints a key pair
LICENSE_SIGNING_PRIVATE_KEY=<base64> npm run license:issue -- \
  --installation <installation-id> --users 25 --modules organization,users \
  --valid-from 2027-01-01 --valid-until 2028-01-01 --out renewal.vlic
```

`--out <path>` writes the signed **file** (the primary transport). Without it the
CLI prints the signed file to stdout; `--artifact` prints the bare `VLIC2` artifact
instead, and `--format v1` still prints a `VLIC1` code for L-02 compatibility tests.
`--operation-id`, `--supersedes` and `--key-id` cover operation identity, explicit
supersession and key rotation. The issuer always generates a new `licenseId`; it has
no option to issue another version of an existing license (see the post-merge
reconciliation report, finding F-8). A
superseding document retires its target from its own `validFrom`, so it must
start at or after the instant it is imported: pass a current or future
`--valid-from` (the default start would be refused as `backdated-supersession`;
see `docs/licensing/version-model-and-file-exchange.md` §3.3 and OQ-86).
The installation id is printed by `npm run bootstrap:system-admin`, returned by
`GET /api/v1/license/current`, and shown on the frontend license screen.

## Development bootstrap

`LICENSE_PROVIDER=local-development` selects `LocalDevelopmentLicenseProvider` explicitly. Defaults are active, perpetual, unlimited, and entitled only for implemented modules. Configuration can restrict status, dates, limits, modules, and feature codes. Selection never branches on `NODE_ENV` and there is no admin/email bypass.

System-administrator bootstrap still creates ordinary User/Role/Membership records. User creation, pinned Organization provisioning, and permission reconciliation now pass through licensing. Unpinned bootstrap still creates no Organization.

## API

`GET /api/v1/license/current` is authenticated but intentionally needs no RBAC permission: it is a post-login bootstrap/self-state read. It returns evaluated non-secret state (including version identity, the scheduled version and the retained-version summary) and never returns a key, token, signature, hash or the submitted document.

`POST /api/v1/license/import` requires `Licensing.License.Activate` and is described under *Import, replay protection and audit* above. `POST /api/v1/license/activate` is the L-02 alias over the same pipeline.

## Persistence and provider status

Typed `licensing.customers`, `installations`, `licenses`, `license_versions`,
`license_version_entitlements` and `license_audit_events` tables are
**IMPLEMENTED**. `PersistentLicenseProvider` (the default) reads the effective
version. A commercial/CRM provider and any remote validation remain
**DEFERRED** — they would replace the provider token without touching consumers.

## Frontend consumption

The frontend has exactly one license source: `GET /api/v1/license/current`, read once per authenticated session through `features/licensing/use-license-state.ts` under the single query key `queryKeys.licenseState()`. There is no second context, API client, entitlement registry, storage copy, environment variable or development fallback, and the session's existing logout/401 cache reset evicts it with everything else.

The authenticated bootstrap order is fixed:

`login → session (GET /auth/me) → license (GET /license/current) → organization (GET /organizations) → organization context → workspace`

`app/layouts/license-gate.tsx` is that licensing stage. It renders its children — the organization gate and the workspace behind it — only while the evaluated license is active, and otherwise replaces them with one of three states: the read is in flight, the backend evaluated the license as not active, or the read failed (retryable, and never collapsed into "inactive" or "active"). What it adds beyond blocking is the information an operator needs: a never-licensed installation gets its own screen ("this installation has no license yet") quoting the installation id, distinct from the "license is not active" screen of an expired or suspended one.

### Frontend import (FE-LICENSE-01, extended by L-03)

When the session holds `Licensing.License.Activate`, the licensing stage renders
the import step (`features/licensing/license-import-form.tsx`) in place of the
explainer: a labelled **file** input (primary transport — the file is read
client-side and posted as text) and a labelled **document** field for the pasted
artifact (fallback transport), one submit action, and the installation id taken
verbatim from the current-license response. A session without that permission
sees the unchanged explainer, because the endpoint would answer 403 anyway — the
check is UX routing, not authorization, and no role, username or environment is
ever a license bypass.

The authority order is the point of the implementation: a 200 from the import
endpoint never marks the frontend state active. The mutation
(`features/licensing/use-import-license.ts`) invalidates and awaits a refetch of
the one canonical query key, and the gate releases only on a
`GET /license/current` that reports `active: true`; if that re-read fails, the
stage shows its retryable error state and the workspace stays closed. A rejected
document keeps the operator on the import screen with a Persian,
operation-scoped message (the backend sentence, its details and any
crypto/persistence internals are never rendered) and another attempt costs
nothing. Nothing about the license is verified client-side: the form only
rejects an empty or over-long value (the DTO limit).

The document is write-once memory: it lives in the form state and in the body of
a single request, and is never written to `localStorage`, `sessionStorage`, a
cookie, the URL, a query-string, a log, an analytics payload or a persisted
cache (the frontend has no logger, and the mutation cache is in-memory with
`gcTime: 0`). Import does not touch the session: no logout, no login, no reload —
the organization bootstrap simply runs behind the released gate. The CLI/API
paths are unchanged and remain available.

The stage is UX routing, never enforcement (AR-21). It compares no count against
`organizationLimit`/`userLimit`, derives no entitlement semantics of its own (the
contract's `entitlements` collection is consumed as-is), and changes nothing
about who may do what — `LicensingService` and the owning application services
remain the only enforcement points. Its necessity is a messaging one: because
`AuthorizationService.effectivePermissionCodes` filters stored grants through the
license, an inactive license yields an empty effective permission set, so without
this stage an inactive installation is indistinguishable in the UI from a user
who simply lacks permission. License and permission stay two different facts with
two different Persian explainers.

### PR #96

PR #96 was open and not merged when L-01 landed. Its follow-up requirement — read the authenticated license state before offering organization provisioning, route inactive states to a license state, and keep permission/membership checks untouched — is implemented by the licensing stage above: the first-organization bootstrap in `organization-gate.tsx` is reachable only behind an active license, and that gate itself no longer evaluates the license, so there is exactly one place where license state is interpreted.

## Licensing versus authentication

They are independent state machines. An inactive or expired license never ends
a session, never logs anyone out and never forces a login; an expired session
never changes license evaluation. Platform permissions (`Licensing.*`) survive
license filtering precisely so an unlicensed installation can still be
licensed by its administrator. Session behaviour itself is `docs/security.md`
§2. PDR-11 §10.1 (full revocation stops System Administrator login) is **not
implemented**; it conflicts with this invariant and is registered with its
recovery path as OQ-78, together with the constraint that any such recovery must
not depend on an ordinary licensed session and that **restore is never blocked
by license state** (OQ-53, `docs/operations/backup-and-restore.md` §3, G-9).

## Expiry policy (product decision — not implemented)

**Owner decision (2026-10-05, OQ-45):** after license expiration / the
applicable Grace period, user access policy enters **Grace**; after Grace,
**Read-Only mode** applies according to the final license policy. Read-Only
must not allow mutation — creating or editing operational documents,
Accounting Post, inventory-changing operations, or prohibited administration
changes; read-only visibility/report/export behavior should remain available
according to the final implementation. **Grace duration and enforcement
details remain OPEN (OQ-45) and no enforcement is implemented** — ADR-0030's
enforcement-off posture is unchanged. License entering Grace/Read-Only must be
surfaceable through the future administrative alert model (OQ-54 / OD-54-11).
Frontend contract: `docs/frontend/ux/document-editing-and-system-alerts.md` §4.
L-03 changes none of this: it selects *which version* governs, not what happens
after a version ends.

## Deferred / not implemented

CRM, billing, payments, remote validation, remote revocation, hardware
fingerprinting, marketplace/subscriptions, and an activation UI are not
implemented. Expiry **enforcement** (Grace/Read-Only above) is also not
implemented. Future `CrmLicenseProvider`-like infrastructure can replace the
provider token without changing consumers.

Confirmed by the 2026-10-11 reconciliation as still absent: full
revocation/reactivation and login-blocking state (OQ-78), server replacement and
its receipts (OQ-82), the installation identity key (blocked by PDR-11 U-2 and
OQ-78/OQ-82), client-device licensing (OQ-83), signed activation receipts
(OQ-84), the Owner-side licensing system and its role matrix (OQ-75, OQ-85),
clock-rollback detection (OQ-76), audit retention enforcement (OQ-77), and the
PDR-11 §8.6 capacity-conflict detection/resolution UI (a later slice that needs
the owning modules' public count contracts).
