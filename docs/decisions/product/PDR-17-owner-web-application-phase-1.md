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

## Permission source reconciliation (before implementation corrections)

The instruction approves a proposed operation-level matrix, but the current tree's
PDR-11 §13, Phase 0 D-6 and OQ-75 contain **categories only**, explicitly leaving
operation-level permissions open. The inspected merged design PR #156 contains no
such proposal. We cannot reconstruct an absent proposal as an approved grant.
The following is the **conservative implemented subset**, derived from the explicit
minimums in this instruction, not a claim to recover the missing full matrix:

| Operation | System Administrator | Issuance Specialist | Observer | Support |
| --- | --- | --- | --- | --- |
| Login, own identity, own password change, logout | yes | yes | yes | yes |
| Customer list/detail | yes | restricted pending matrix evidence | yes | restricted pending limited-support scope |
| Customer create/edit name/status/reference | yes | restricted pending matrix evidence | no | no |
| User list/create, role assignment, enable/disable/reset | yes | no | no | no |
| Audit view | yes | restricted pending matrix evidence | yes | no |
| Audit edit/delete/purge | no | no | no | no |
| Settings mutations | no endpoint | no | no | no |
| License issuance/activation/deactivation/replacement/revocation/recovery | unavailable | unavailable | unavailable | unavailable |

Unknown roles/operations deny. Pending initial password change permits only own
identity, password change and logout. Restricted roles retain a usable shell with
an explicit scope notice, not a misleading empty customer list. **OQ-75 remains
OPEN** for the missing matrix, especially specialist customer writes and limited
support fields/actions. No new business permission is granted by inference.

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
