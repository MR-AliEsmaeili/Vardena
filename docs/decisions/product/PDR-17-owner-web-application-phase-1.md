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
those as MVP authorization roles. Owner Admin governs Owner users, access and
configuration and holds the authorized Owner-admin decision authority. License
Operator performs the approved routine customer/license operations. Every
operation remains explicitly permissioned and server-enforced; this role naming
does not by itself grant a signer, private-key custody, unrestricted recovery, or
any lifecycle operation not separately decided. Define and test the exact
endpoint/permission mapping before implementation; unknown operations deny.

OQ-75's role-count/role-purpose decision is closed at product level. Exact
permission enforcement, credential lifecycle, access review and acceptance
remain implementation/security work; no claim of implemented RBAC follows from
this record. There is no required second-person approval.

## Audit and OQ-77

**2026-10-16 retention clarification:** licensing audit records are append-only
and must be retained for at least three years. Unresolved incidents must never
be automatically deleted. The earlier Owner decision for permanent retention in
a separate archive remains the stronger current policy; three years is a minimum,
not an automatic purge date. OQ-77 remains open for archive/storage, access,
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
OQ-45's natural-expiry deadline is decided as UTC expiry + 14×24 hours,
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
a license or produce a receipt. **Ordinary activation requires no signed
receipt** (OQ-84/PQ-9, product question now Decided); this attributable manual
history is sufficient for the approved scope. It is not signed customer evidence.

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
customer server was decommissioned. Its historical state names, skipped emergency
path, unbounded observations and four-role authorization are not proof of the
2026-10-16 OQ-82/OQ-75 policy. The approved OQ-82 sequence and bounded
confirmation expiry are in the dated addendum below. The manual device policy is
separately in PDR-15 §6; prior customer self-service device replacement is not
conformant evidence for that decision.

## Product decision update — OQ-82/OQ-85 (2026-10-16)

Server installation setup/replacement remains a **manual, Owner-authorized
workflow**. The replacement license must be activated on the new server before
the old server is manually decommissioned. Replacement stays pending until an
authorized operator records auditable confirmation that the old server was
manually decommissioned; only then may the replacement be finalized. The
confirmation expiry is configurable from **1 hour through 7 days**, defaulting
to **24 hours**. Expiry of that confirmation window is not proof of decommission
and does not authorize a remote shutdown, remote deactivation, or a claim that
the Owner can contact or control the customer's server. Exact evidence fields,
expired-pending recovery and the workflow/API remain implementation gaps under
OQ-82.

The Owner licensing system and trust boundary are Owner-controlled
infrastructure. Customer deployments need no continuous connectivity to the
Owner, and the MVP does not use a federated issuer. Existing approved signed-file
exchange remains the offline trust mechanism; this boundary grants no new key
custody or signing design. OQ-85's product boundary is decided; operational
hardening and deployment evidence remain open.

OQ-83's 2026-10-16 product decision is recorded in PDR-15: client-device
replacement is manually managed by Owner Admin in the MVP, not a customer
self-service replacement flow. Preserve the old device until the replacement
activates, then perform an atomic quota-neutral one-for-one swap. It is separate
from server replacement and ordinary activation receipts. Existing implementation
must be assessed against this superseding policy; this documentation change does
not alter runtime behavior.
