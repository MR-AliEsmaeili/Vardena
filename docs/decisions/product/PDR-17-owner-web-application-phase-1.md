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
| License issuance/activation/deactivation/replacement/revocation/recovery | unavailable | unavailable | unavailable | unavailable |

Exact backend grants:
- Administrator: `customers.view`, `customers.write`, `users.manage`, `audit.view`.
- Issuance Specialist and Observer: `customers.view`, `audit.view`.
- Support: `customers.view`, with **server-enforced field filtering**.

Both customer list items and detail use the same explicit response allowlist.
Support receives **only** `id`, `customerCode`, `displayName`, `status`. No
contract reference, user attribution, timestamps, arbitrary metadata or future
columns are serialized for Support. Search uses only code/name, not contract
fields. The full current DTO for other authorized readers additionally contains
contractReference, createdAt, updatedAt, createdBy and updatedBy. UI types/rendering
handle the reduced DTO and use backend effective permissions; hiding controls is
not authorization. Direct API requests enforce the same permissions/projection.

Unknown roles and operations deny. There is no wildcard/prefix expansion.
Pending initial-password change permits only own identity/change/logout. Issuance
Specialist licensing mutations remain deferred **because those workflows do not
exist**, not because customer/audit reads lack an approved policy. Support has no
licensing mutation authority; adding such authority needs a separate decision.
OQ-75 remains OPEN for broader future operation/acceptance tracking, not as a
reason to deny the now-approved read access. No unrelated OQ is closed.

## Audit and OQ-77

The instruction selects option C, but no authoritative wording for option C is
present in current `main` (OQ-77 and PDR-11 §12.8/§15 U-7 still say OPEN; Phase 0
D-10 lists no retention options). Record that selection without fabricating its
meaning. Implement durable, attributable, minimal audit storage and viewing only;
no purge, deletion UI, invented duration or claim of tamper-proof storage.
OQ-77 stays OPEN pending exact wording and acceptance evidence.

## Manual lifecycle policies (not a new signed protocol)

Activation: the authorized team installs and checks a license; an Administrator or
Issuance Specialist explicitly records issued → activated, actor, server timestamp,
reason and available evidence reference. This is operator confirmation, **not** a
cryptographically verified customer receipt. Lifecycle APIs remain unavailable in
this slice; a reserved relational operational-record model can represent these facts.

Server replacement: an authorized deployment specialist manually deactivates and
revokes the old server's license lock. Administrator or Issuance Specialist decides
whether replacement is authorized for the same customer. The authorized specialist
obtains/installs the replacement. Administrator or Issuance Specialist records the
observed state, retaining actor/time/reason/prior/new status. Emergency old-server
loss is allowed with an attributable authorized decision; no old-server response
is required. Client-device replacement (OQ-83) is separate.

U-1 is deferred: no production key generation, custody implementation or signer.
No VLIC1/VLIC2/VDEA1/VDRQ1/VDRP1/canonicalization/enforcement changes. OQ-78,
OQ-82, OQ-83 and OQ-84 remain OPEN; these manual policies do not claim to implement
revocation, recovery, device clients or signed receipts. OQ-85's location/UI/store
directions are now approved but its operational acceptance is not inferred.
