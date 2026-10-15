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

## Approved role-access policy — PR #160 Product Owner correction

The initial implementation restricted specialist/support business permissions
because the referenced proposal was absent from the earlier tree. Product Owner
review of PR #160 explicitly clarified the required intent. **This section
supersedes that initial restriction**, without inventing unimplemented lifecycle
operations or imposing a second approver.

| Operation | System Administrator | Issuance Specialist | Observer | Support |
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

Exact backend grants after the manual-observation slice:
- Administrator: `customers.view`, `customers.write`, `users.manage`, `audit.view`, `operations.view`, `operations.record`.
- Issuance Specialist: `customers.view`, `audit.view`, `operations.view`, `operations.record`.
- Observer: `customers.view`, `audit.view`, `operations.view`.
- Support: `customers.view`, with **server-enforced field filtering**. No operational-record grant.

Both customer list items and detail use the same explicit response allowlist.
Support receives **only** `id`, `customerCode`, `displayName`, `status`. No
contract reference, user attribution, timestamps, arbitrary metadata or future
columns are serialized for Support. Search uses only code/name, not contract
fields. The full current DTO for other authorized readers additionally contains
contractReference, createdAt, updatedAt, createdBy and updatedBy. UI types/rendering
handle the reduced DTO and use backend effective permissions; hiding controls is
not authorization. Direct API requests enforce the same permissions/projection.

Unknown roles and operations deny. There is no wildcard/prefix expansion.
Pending initial-password change permits only own identity/change/logout. The
manual-observation slice below is the only licensing mutation currently defined.
Support has no licensing mutation authority; adding such authority needs a separate
decision.
OQ-75 remains OPEN for broader future operation/acceptance tracking, not as a
reason to deny the now-approved read access. No unrelated OQ is closed.

## Audit and OQ-77

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

## Licensing restrictions, recovery and dates — product cross-reference

PDR-11 §§9–10, 12 and 20 now record 14-calendar-day Grace → Read-Only, immediate
validated emergency restriction with explicit reason, independent authenticated
customer-administrator recovery, signed applicable restoration, rollback-only
automatic clearance after trustworthy-time validation, and exact-successful-repeat
result replay. These are required behaviors, **not implemented Owner/customer
lifecycle operations**. They do not grant additional Owner roles/permissions or
make manual observation an authorization artifact. OQ-78/76/81 track technical
follow-ups. PQ-3 is decided at product-policy level, not pending: ordinary
Restore remains the authorized IT/server-administrator Runbook path (OQ-53);
limited authenticated recovery grants no normal-user in-product Restore and is
not implemented. Identity/backup-encryption and recovery design gates remain.
OQ-45 separately retains the exact Grace deadline and distinct termination
questions; 14-calendar-day duration does not select deadline arithmetic.

All Owner user-visible dates, including customer/license screens, expiry/Grace,
activation/replacement history, audit views, reports and filters, must follow the
project-wide Persian/Jalali-first [date/time contract](../../datetime.md) §0.
PR #164 fixes the bounded raw-ISO Owner call sites identified in PDR-11 §20.5;
[the audit matrix](../../tasks/global-date-contract-audit.md) records actual
verification and remaining unverified surfaces, not blanket compliance.

## Manual lifecycle policies (not a new signed protocol)

Activation: the authorized team installs and checks a license; an Administrator or
Issuance Specialist explicitly records issued → activated, actor, server timestamp,
reason and available evidence reference. This is operator confirmation, **not** a
cryptographically verified customer receipt. The additive Owner migration
`002-manual-operations.sql` and its API/UI now store that fact. They do not issue
a license or produce a receipt. **Ordinary activation requires no signed
receipt** (OQ-84/PQ-9, product question now Decided); this attributable manual
history is sufficient for the approved scope. It is not signed customer evidence.

Every new customer-server installation/replacement requires **manual Owner
approval** attributable to an authorized Owner user; never automatic unrestricted
transfer. The authorized deployment specialist's deployment tasks and the
Owner-side old-server observations are **not themselves** authority, proof or
execution of cryptographic revocation. Earlier wording that the specialist
"manually deactivates and revokes" must not be read as an automatic or
pre-completion customer-server transition. Administrator or Issuance Specialist decides
whether replacement is authorized for the same customer. The authorized specialist
obtains/installs the replacement. Administrator or Issuance Specialist records the
observed state, retaining actor/time/reason/prior/new status. Emergency old-server
loss is allowed with an attributable authorized decision; no old-server response
is required. That existing observation policy does not authorize a new emergency
revocation exception or determine revocation timing. PDR-11 §5.5 prohibits
premature invalidation from request/issuance alone and ties successful completion
to its approved workflow, preserving continuity when activation fails. Whether a
reachable old server may deliberately be revoked **before** successful replacement
activation remains the precise PO question in OQ-82/U-9; do not infer an answer
from observation statuses. Owner records do not execute changes on an offline
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
another observation. Whether a replaced reference may be reused as a new
replacement target is not decided here; OQ-82 remains OPEN for that choice.
Evidence: [manual observation record](../../tasks/licensing-owner-side-manual-operations.md).
