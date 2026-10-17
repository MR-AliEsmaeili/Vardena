# PDR-17 — Owner licensing web application, first usable slice

- Date: 2026-10-15
- Authority: Ali Esmaeili's Phase 1 implementation instruction in this task.
- Status: approved product directions recorded; implementation/CI/acceptance are separate.
- Sources: [PDR-11](PDR-11-vardena-licensing-product-requirements.md),
  [PDR-14](PDR-14-licensing-customer-code.md),
  [ADR-0048](../../adr/0048-owner-side-licensing-separation-boundary.md).

## Approved boundary

Standalone Persian RTL web application under `owner-licensing/`, separate runtime,
configuration, credentials, PostgreSQL database and migration history. Owner is the
system of record; no customer database access, replication, cross-boundary foreign
keys, customer Owner mode, microservices or automatic callbacks. CRM/accounting/
billing/ticketing are excluded. Public-source hygiene applies to every artifact.
No mandatory second-person approval or pending-approval workflow.

## Approved role-access policy — current two-role model (2026-10-16)

The Owner MVP has exactly two operational roles: **Owner Admin** and **License
Operator**. The previously recorded four-role matrix (System Administrator,
Issuance Specialist, Observer, Support) is superseded; do not create or retain
those as MVP authorization roles.

- **Owner Admin** manages the Owner system, its settings/security and authorized
  Owner users, and holds Owner-admin decision authority.
- **License Operator** may view customer records and perform license operations
  such as issuance, renewal, cancellation and replacement only within explicit
  granted permissions. A License Operator cannot change Owner security settings
  or the primary signing key.

Sensitive operations must be attributable and audited. Owner-system roles are
separate from customer-system roles and from license entitlements. The primary
signing key remains under Owner control and outside the customer runtime; role
membership alone does not confer key custody, unrestricted recovery, or any
lifecycle operation not separately decided. Every operation remains explicitly
permissioned and server-enforced; unknown operations deny. Define and test the
exact endpoint/permission mapping before implementation.

OQ-75's role-count/role-purpose decision is closed at product level, and Phase 1.3
implements the exact server-enforced two-role permission mapping (`OWNER_ADMIN`
and `LICENSE_OPERATOR`) across the Owner database (`003-two-role-authorization.sql`),
API (`domain.ts`, `app.ts`, `operations.ts`, `bootstrap.ts`), and Persian RTL UI:

| Phase 1 operation | `OWNER_ADMIN` (Owner Admin) | `LICENSE_OPERATOR` (License Operator) |
| --- | --- | --- |
| Login, own identity (`GET /auth/me`), mandatory/voluntary own password change, logout | yes | yes |
| Effective permissions (`GET /permissions/effective`) | `customers.view`, `customers.write`, `users.manage`, `audit.view`, `operations.view`, `operations.record`, `replacements.authorize` | `customers.view`, `audit.view`, `operations.view`, `operations.record` |
| Customer list/detail (`customers.view`) | full allowlisted DTO | full allowlisted DTO |
| Customer create/edit (`customers.write`) | yes | no (`403 PermissionDenied`) |
| User and role administration, password reset (`users.manage`) | yes (retains last active `OWNER_ADMIN`) | no (`403 PermissionDenied`) |
| Audit explorer (`audit.view`) | yes | yes |
| Manual operational record list/detail (`operations.view`) | yes | yes |
| Routine license observation and follow-up activation/old-server/replacement-installation observations (`operations.record`) | yes | yes |
| Server-replacement authorization and emergency old-server-lost handling (`replacements.authorize`, `POST /operational-records/server-replacements`) | yes | no (`403 PermissionDenied`, audited as `OPERATION_MUTATION_DENIED`) |

Superseded four-role identifiers (`SYSTEM_ADMIN`, `LICENSE_ISSUANCE`,
`READ_ONLY_OBSERVER`, `SUPPORT_SPECIALIST`) are rejected by API validation,
authentication/session revalidation (`401 Unauthorized` even against an
unmigrated database), service-level operation guards, and database constraint.
For existing populated pre-003 databases containing legacy four-role rows,
automatic `003-two-role-authorization.sql` (`npm run migrate`) fails closed
(`ERRCODE = '23514'`) and rolls back cleanly rather than inventing an unapproved
automatic mapping (which would risk escalating `READ_ONLY_OBSERVER` or
`SUPPORT_SPECIALIST` to write-capable `LICENSE_OPERATOR`). Upgrading a populated
pre-003 database uses the supported preflight and transactional remediation
workflow (`npm run migrate:preflight` and `npm run migrate:remediate-roles --
<dispositions.json>`), which validates explicit per-account dispositions
(`MAP_EQUIVALENT` for `SYSTEM_ADMIN` → `OWNER_ADMIN`, which preserves exact
effective access because `POST /api/v1/operational-records/server-replacements`
was already authorized for `SYSTEM_ADMIN` under `operations.record` in
`1a982323db7f` and `replacements.authorize` is a permission-code split that
narrows `LICENSE_OPERATOR`; `RETAIN_REDUCED`; `DEACTIVATE`; or explicitly
authorized `ELEVATE_PRIVILEGE` with `allowPrivilegeElevation: true`), requires a
mandatory active-administrator `authorizedByUserId`, enforces
`LastAdminProtected`, revokes pre-upgrade sessions, writes append-only
`USER_LEGACY_ROLE_REMEDIATED` audit events attributed strictly to
`authorizedByUserId`, applies `003` in one PostgreSQL transaction, and performs
full pre-upgrade state reconstruction and plan re-validation on repeated runs.
Operational access review and final Product Owner acceptance remain
separate governance steps; there is no required second-person approval.

### Historical record — PR #160 four-role matrix (superseded 2026-10-16)

> Retained for auditability only. The following role names, access matrix and
> grants describe the former policy snapshot and are **not current MVP policy**;
> the two-role section above controls.

| Historical operation | System Administrator | Issuance Specialist | Observer | Support |
| --- | --- | --- | --- | --- |
| Login, own identity, own password change, logout | yes | yes | yes | yes |
| Customer list/detail | full current DTO | full current DTO | full current DTO | identity/status projection only |
| Customer create/edit name/status/reference | yes | no | no | no |
| User list/create, role assignment, enable/disable/reset | yes | no | no | no |
| Audit view | yes | yes | yes | no |
| Audit edit/delete/purge | no endpoint | no endpoint | no endpoint | no endpoint |
| Settings mutations | no endpoint | no endpoint | no endpoint | no endpoint |
| Inspect operator-observed activation and same-customer server-replacement records | yes | yes | yes | no |
| Record those operator observations | yes | yes | no | no |
| Cryptographic issuance, signed receipt, deactivation proof, client-device replacement, revocation/recovery | not implemented | not implemented | not implemented | not implemented |

The former backend grants were: Administrator (`customers.view`,
`customers.write`, `users.manage`, `audit.view`, `operations.view`,
`operations.record`); Issuance Specialist (`customers.view`, `audit.view`,
`operations.view`, `operations.record`); Observer (`customers.view`, `audit.view`,
`operations.view`); Support (`customers.view`, with a server-side field allowlist
and no operational-record grant). The former Support projection was limited to
`id`, `customerCode`, `displayName` and `status`; other roles' full DTO and
response/search details were described in the superseded PR #160 snapshot. These
permissions are historical evidence only, not an approved migration or runtime
state claim.

## Audit and OQ-77

**2026-10-16 retention clarification:** licensing audit records are append-only
and must be retained for at least three years from each event's occurrence.
Unresolved security incidents must never be automatically deleted. The earlier
Owner decision for permanent retention in a separate archive remains the stronger
current policy; three years is a minimum, not an automatic purge date. OQ-77 remains open for archive/storage, access,
minimization, incident resolution criteria and implementation evidence.


**Explicit Product Owner decision (2026-10-15):** retain audit history
permanently in a separate archive; restrict sensitive access to authorized roles
and avoid unnecessary exposure. No purge/deletion workflow may contradict this
policy. This supersedes the previous retention deferral: the historical option C
wording is still not reconstructed, and no choice is attributed to that label.
[PDR-11 §12.8/§20](PDR-11-vardena-licensing-product-requirements.md) is the
licensing retention source; OQ-77 remains OPEN only for schema, archive/storage,
minimization/access design and implementation evidence. Current durable audit
storage/viewing is not proof of a separate permanent archive or tamper-proof/
cryptographically immutable history. Manual observations remain manually
attributable facts, not cryptographically verified operations.

**Owner-side OQ-77 retention and archive implementation (2026-10-17):**
`owner-licensing/backend/migrations/004-audit-retention-archive.sql`,
`owner-licensing/backend/src/archive.ts`, `owner-licensing/backend/src/audit.ts`,
and `owner-licensing/frontend/src/features/audit/audit-page.tsx` enforce the
approved Owner-side retention and archive controls without inventing destructive
cleanup authority or incident-resolution semantics:
- Every event in `owner.audit_events` carries a deterministic 3-year UTC minimum
  retention timestamp (`minimum_retained_until = occurred_at + 3 years`) and
  validated incident metadata (`security_incident`, `incident_status` in
  `{'NONE', 'UNRESOLVED'}`). Security denials and failures (`outcome IN ('DENIED',
  'FAILED')` or security-denial event types) are automatically flagged
  `security_incident = true`, `incident_status = 'UNRESOLVED'` and protected by
  `UNRESOLVED_SECURITY_INCIDENT_HOLD`.
- Permanent separate archive persistence is enforced across two decoupled
  boundaries so the archive does not depend exclusively on the same PostgreSQL
  database and its backup lifecycle as the source audit records:
  1. **Independent durable filesystem archive store (`OWNER_AUDIT_ARCHIVE_DIR`,
     `FilesystemAuditArchiveStore`):** persists write-once (`link` + `unlink`,
     `chmod 0o444`, file and directory `fsync`), read-back-verified JSON batch
     bundles (`batches/batch-XXXXXX-<id>.json`) and an atomic `fsync`ed
     hash-chained `manifest.json` on an independent filesystem path/volume
     outside PostgreSQL.
  2. **Separate PostgreSQL archive ledger (`owner_audit_archive.archive_batches`
     and `owner_audit_archive.archived_audit_events`):** stores append-only
     archived batches with allowlisted `before_state`/`after_state` minimization,
     `durable_file_name`, `durable_bundle_sha256`, per-record SHA-256 digests
     (`record_sha256`), chained batch digests (`previous_batch_digest` →
     `batch_digest_sha256`), and source-matching triggers.
- Privileged archive-management routes (`GET /api/v1/audit-archive/status`,
  `GET/POST /api/v1/audit-archive/batches`, `GET /api/v1/audit-archive/batches/:id`,
  `POST /api/v1/audit-archive/verify`, `POST /api/v1/audit-archive/recover`)
  require `audit.archive` (`OWNER_ADMIN` only); attempts by `LICENSE_OPERATOR`
  are denied (`403 PermissionDenied`) and recorded as
  `AUDIT_ARCHIVE_ACCESS_DENIED` security incidents. Archive writes, bundle
  retrieval, verification, and recovery fail closed (`503 ArchiveStorageUnavailable`)
  when `OWNER_AUDIT_ARCHIVE_DIR` is not configured, and events are only reported
  as `archived: true` when verified in both the independent durable store and
  the PostgreSQL ledger.
- Database triggers, write-once `0o444` `fsync`ed bundle files, and SHA-256
  digests provide application-role append-only enforcement, cross-store
  tamper-evidence on verification, and deterministic recovery after a PostgreSQL
  restore (`POST /api/v1/audit-archive/recover`), not hardware WORM against a
  compromised OS root or PostgreSQL superuser. `OWNER_AUDIT_ARCHIVE_DIR` must be
  mounted on a dedicated durable volume outside the PostgreSQL data directory
  (a different path alone does not guarantee physical storage independence,
  WORM (not required for MVP by PDR-18), or protection against a compromised OS `root`, and provisioning
  the dedicated volume mount and external backup/restore procedure remains an
  unresolved operational requirement in target deployments). Customer-side
  `licensing.license_audit_events` archiving, incident-resolution lifecycle, and
  Product Owner acceptance remain open under OQ-77.

## Licensing restrictions, recovery and dates — product cross-reference

PDR-11 §§9–10, 12 and 20 record 14-day Grace → Read-Only after natural
subscription expiry only; intentional subscription cancellation gets no automatic
Grace. License cancellation, replacement, reissuance and contract termination
remain distinct events; contract-termination policy was decided in PDR-18 on 2026-10-17. Implementation/evidence remains open. The records
also cover immediate validated emergency restriction with explicit reason,
independent authenticated customer-administrator recovery, signed applicable
restoration, and rollback-only unlock only through controlled, attributable,
audited action after trustworthy-time and license/time revalidation establish
resolution. Failed or uncertain validation requires secure authorized recovery;
unrelated restrictions remain. Exact-successful-repeat result replay remains a
separate OQ-81 concern. These are required behaviors, **not implemented Owner/customer
lifecycle operations**. They do not grant additional Owner roles/permissions or
make manual observation an authorization artifact. OQ-78/76/81 track technical
follow-ups. PQ-3 is decided at product-policy level, not pending: ordinary
Restore remains the authorized IT/server-administrator Runbook path (OQ-53);
limited authenticated recovery grants no normal-user in-product Restore and is
not implemented. Identity/backup-encryption and recovery design gates remain.
OQ-45's natural-subscription-expiry deadline is decided as UTC expiry + 14×24 hours,
ending at `now >= boundary`. Contract-termination strictness remains separately
open; see PDR-11 §21 and the OQ-45 record.

All Owner user-visible dates, including customer/license screens, expiry/Grace,
activation/replacement history, audit views, reports and filters, must follow the
project-wide Persian/Jalali-first [date/time contract](../../datetime.md) §0.
PR #164 fixes the bounded raw-ISO Owner call sites identified in PDR-11 §20.5;
[the audit matrix](../../tasks/global-date-contract-audit.md) records actual
verification and remaining unverified surfaces, not blanket compliance.

## Manual lifecycle policies (not a new signed protocol)

Activation: the authorized team installs and checks a license; an authorized
Owner Admin or License Operator (subject to the explicit permission mapping,
which remains to be implemented) records issued → activated, actor, timestamp,
reason and available evidence reference. This is operator confirmation, **not** a
cryptographically verified customer receipt. The additive Owner migration
`002-manual-operations.sql` and its API/UI now store that fact. They do not issue
a license or produce a receipt. **Ordinary activation requires no separate signed
receipt** (OQ-84/PQ-9, product question now Decided); this attributable manual
history is sufficient for the approved scope. It is not signed customer evidence
and does not decide OQ-81's distinct durable API replay receipt/response DTO.

Every new customer-server installation/replacement requires **manual Owner
approval** attributable to an authorized Owner user; never automatic unrestricted
transfer. The authorized deployment specialist's deployment tasks and the
Owner-side old-server observations are **not themselves** authority, proof or
execution of cryptographic revocation. Earlier wording that the specialist
"manually deactivates and revokes" must not be read as an automatic or
pre-completion customer-server transition. Owner Admin makes the explicit replacement authorization decision; exact
endpoint grants remain subject to the OQ-75 permission-mapping implementation.
The authorized specialist obtains/installs the replacement. The authorized
operator records the observed state, retaining actor/time/reason/prior/new status. The responsible
role must be enforced under the two-role model; the historical four-role mapping
is not an active policy. Emergency old-server
loss is allowed with an attributable authorized decision; no old-server response
is required. That existing observation policy does not authorize a new emergency
revocation exception or determine revocation timing. PDR-11 §5.5 prohibits
premature invalidation from request/issuance alone and ties successful completion
to its approved workflow, preserving continuity when activation fails. The
2026-10-16 decision now fixes the order: activate the replacement first, then
manually decommission the old server, with auditable confirmation before
finalization; see the OQ-82 addendum below. The code-backed observations alone do
not enforce or prove that sequence. Owner records do not execute changes on an offline
customer server (PDR-11 §5.6/§10.4). Client-device replacement (OQ-83) is separate.

U-1/OQ-74 product policy is now approved: existing issued licenses are not
automatically invalidated solely by signing-key compromise (PDR-11 §4.4/§20.4).
Compatible incident response/custody/trust design remains deferred: no production
key generation, custody implementation or signer.
No VLIC1/VLIC2/VDEA1/VDRQ1/VDRP1/canonicalization/enforcement changes. OQ-78,
OQ-82 and OQ-83 remain OPEN; OQ-84 is Decided for ordinary activation; these manual policies do not claim to implement
revocation, recovery, device clients or signed receipts. OQ-85's location/UI/store
directions are now approved but its operational acceptance is not inferred.

## Manual observation slice — 2026-10-15

The reserved relational model now has an application write path. It records only
`OPERATOR_OBSERVED` facts. Every response states `cryptographicVerification =
NOT_IMPLEMENTED`, `signedArtifactProduced = false` and `customerServerContacted =
false`. License observations move only `ISSUED` → `ACTIVATED`. Same-customer
server replacement moves `REPLACEMENT_AUTHORIZED` → `OLD_SERVER_STATE_RECORDED` →
`REPLACEMENT_RECORDED`. Emergency old-server loss inserts the authorized decision
and the unavailable observation in one transaction; it does not wait for the old
server. History is append-only and must be the continuous legal sequence for
the current state, starting at `UNRECORDED`. Emergency old-server loss still
records both steps in one transaction. No cancellation, renewal, revocation,
recovery or client-device state is defined, so none is implemented. An abandoned non-terminal
replacement keeps its installation slot until a later decision defines withdrawal.
A completed replacement of installation B may later be the old installation of
another observation. Reuse of a replaced reference, pending-request withdrawal
and timeout recovery remain unspecified technical details under OQ-82. The
2026-10-16 replacement order and confirmation requirements are authoritative.
Evidence: [manual observation record](../../tasks/licensing-owner-side-manual-operations.md).

**Implementation snapshot, not current replacement policy:** the code-backed
manual-observation slice records operator assertions and does not verify that a
customer server was decommissioned. While Phase 1.3 enforces the two-role
authorization model (`OWNER_ADMIN` for `replacements.authorize`, and both
`OWNER_ADMIN` and `LICENSE_OPERATOR` for `operations.record`), the observation
slice's historical state names, skipped emergency path, and unbounded
observations are not proof of the 2026-10-16 OQ-82 replacement sequence or
configurable 1h–7d pending confirmation expiry. The approved OQ-82 sequence and
bounded confirmation expiry are in the dated addendum below. The manual device
policy is separately in PDR-15 §6; prior customer self-service device
replacement is not conformant evidence for that decision.

## Product decision update — OQ-82/OQ-85 (2026-10-16)

Server installation setup/replacement remains a **manual, Owner-authorized
workflow**. The replacement license must be activated on the new server before
the old server is manually decommissioned. Replacement stays pending until an
authorized operator records auditable confirmation that the old server was
manually decommissioned; only then may the replacement be finalized. The
pending-request/confirmation period is configurable by Owner Admin from **1 hour
through 7 days**, defaulting to **24 hours**. Its start/end semantics remain to be
specified. Expiry is not proof of decommission and does not authorize a remote
shutdown, remote deactivation, or a claim that the Owner can contact/control the
customer server. The approved docs do not explain how the new server activates
before decommission while respecting the existing one-active-installation/license
binding, nor how pending/finalization avoids inconsistent records. Exact evidence
and expiry/failure recovery remain open; OQ-82 implementation is blocked pending
specification.

The Owner licensing system and trust boundary are Owner-controlled
infrastructure. Customer deployments need no continuous connectivity to the
Owner, and the MVP does not use a federated issuer. Existing approved signed-file
exchange remains the offline trust mechanism; offline transfer does not remove
the need for a local customer server to apply and verify licensing data. This
boundary grants no new key custody or signing design. OQ-85's product boundary is
decided; operational hardening and deployment evidence remain open.

OQ-83's 2026-10-16 product decision is recorded in PDR-15: client-device
replacement is manually managed by Owner Admin in the MVP, not a customer
self-service replacement flow. Preserve the old device until the replacement
activates, then perform an atomic quota-neutral one-for-one swap. It is separate
from server replacement and ordinary activation receipts. Existing implementation
must be assessed against this superseding policy; this documentation change does
not alter runtime behavior.


## Product Owner decision update — activation dates and server replacement (2026-10-17)

See [PDR-18](PDR-18-licensing-contract-and-activation-policy.md) for the complete binding policy.

- Owner-side commercial contract dates must be stored and displayed separately from activation validity dates. On issue, activation start is populated from the current issuance date and is not editable; past and future starts are prohibited. The issuer sets the end date independently.
- Server replacement uses a limited one-time Owner authorization and may activate the new server before the old server is manually decommissioned. Owner Admin records customer/authorized representative approval with approver name, time, reason, and evidence reference. Do not claim remote shutdown or remote control.
- Engineering must propose a design that preserves license-to-Installation binding and handles activation failure, retries, pending/finalization consistency, and recovery before implementation. Existing period/timeout and evidence details not superseded by PDR-18 remain subject to the current PDR-17/OQ-82 record and require reconciliation rather than inference.

These are product decisions, not implementation claims. OQ-82 remains open for specification/evidence until the conflict-safe replacement protocol is reviewed.
