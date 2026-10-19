# PDR-11: Vardena Licensing — Product Requirements Source of Truth

> **Owner Phase 1 update (2026-10-15):**
> [PDR-17](PDR-17-owner-web-application-phase-1.md) records the approved Owner
> web/PostgreSQL boundary, no dual control, durable audit, manual activation and
> server-replacement policy. It supersedes earlier undecided directions only to
> that extent. The historical option C wording is not reconstructed. The
> explicit 2026-10-15 decisions below now establish audit retention and the
> licensing restriction/recovery policies; no unknown permission is inferred.

> **Current decision reconciliation (2026-10-16, documentation only):** current
> Product Owner decisions for OQ-45 and OQ-74–OQ-85 are consolidated in **§21**;
> consult §21, [`docs/tasks/licensing-po-decision-traceability-2026-10-16.md`](../../tasks/licensing-po-decision-traceability-2026-10-16.md)
> and the central registry for current decisions and status. §20 remains relevant
> for source-backed technical assessment, compatibility constraints, acceptance
> criteria and evidence-backed follow-ups; it is not the sole current decision-
> status source. §§18–19 preserve dated traceability and reconciliation history,
> not current open-question statuses. Approval of behavior is not implementation,
> verification, acceptance of code, or authorization to merge.


- **Type:** PDR (Product Decision Record) · decision IDs: **none assigned**. This record is traced by section (§); see §18. No OQ, C, or ADR identifier was created by this record.
- **Status:** **Decided — approved product-requirements reference** (Owner-approved, 2026-10-11). Documentation only. **This is not an implementation specification and not authorization to start coding.** Implementation requires a separate, explicit Product Owner instruction after technical design.
- **Status update (2026-10-11, later the same day):** the Product Owner gave the explicit follow-up instruction — resolve §19, reconcile affected records, produce the technical design, and begin implementation with a tested first vertical slice. That work is recorded in §19.4, `docs/tasks/pdr-11-conflict-reconciliation.md`, [ADR-0045](../../adr/0045-installation-identity-and-license-activation.md) and [ADR-0046](../../adr/0046-signed-license-documents-and-version-lifecycle.md). At that date §15 registered OQ-74…OQ-85 without deciding them; subsequent dated decisions, including §20, supersede that historical status.
- **Decided by:** Repository Owner / Product Owner, via the Owner-approved licensing brief of 2026-10-11. The brief itself is not stored in the repository; this record is its canonical transcription.
- **Date:** 2026-10-11
- **Language:** English, consistent with the other PDR and OQ records. Established technical terms are kept in English.
- **Scope of this record:** the Vardena licensing product requirements. It does not change implemented behavior. §19 records original conflicts; §20 retains technical assessment, compatibility constraints, acceptance criteria and evidence-backed follow-ups; §21 is the current scoped Product Owner decision reconciliation and status summary, without self-approving technical architecture.
- **Companion records:** [`docs/licensing-architecture.md`](../../licensing-architecture.md) (implemented foundation, L-01/L-02) · [ADR-0030](../../adr/0030-license-foundation.md) · [ADR-0045 — installation identity and license activation](../../adr/0045-installation-identity-and-license-activation.md) (filed as ADR-0036 until the 2026-10-11 renumbering recorded in §19.4 and CF-14) · [OQ-45](./OQ-45-license-expiry-behavior.md) · [OQ-53](./OQ-53-disaster-recovery-and-restore.md) · [OQ-61](./OQ-61-crm-ticketing-timing-ownership.md) · [`docs/operations/backup-and-restore.md`](../../operations/backup-and-restore.md) · [PB-BASELINE v1](../../product/product-business-decision-baseline-v1.md) §10–§12.

> **How to read this record.**
>
> - **"Must"** marks an Owner-approved requirement.
> - **OPEN** (§15) marks a question that is not decided. Do not implement it as decided.
> - **Design item** (§16) marks a technical question left to design. It is not a product decision.
> - **Conflict** (§19) marks a difference from an existing repository record. It is recorded, not resolved.

---

## 1. Purpose and scope

**1.1 Purpose.** This record is the single, version-controlled, authoritative product requirements reference for the Vardena licensing system. Future technical design and implementation must rely on this repository record, not on conversation history.

**1.2 In scope.** Owner-side licensing management; server licenses bound to one Vardena server installation; client-device licensing; module and capacity entitlements; subscription expiry and restricted mode; full revocation and reactivation; server installation replacement; offline operation and signed file exchange; and the security, audit, and clock-rollback requirements at product level.

**1.3 Out of scope.** Technical design, implementation, cryptographic choices, file formats, schemas, endpoints, UI layouts, and test or training environments. See §16 and §17.

**1.4 Usability.** Normal licensing, activation, administration, and recovery workflows must be usable through a graphical interface. Routine CMD or PowerShell operations must not be required.

**1.5 Security objective.** The objective is practical protection against straightforward copying, forgery, and unauthorized operations. The system does **not** claim absolute protection against a person with full local operating-system administrator access.

**1.6 Relationship to the implemented foundation.** The repository already contains an implemented licensing foundation (L-01, L-02; see `docs/licensing-architecture.md`, ADR-0030, ADR-0036). Approval of this record does not mean any part of it is implemented, and the existence of that foundation does not mean any part of this record was approved earlier. Where the two differ, this record states the product requirement and §19 records the difference.

## 2. Terminology and conceptual architecture

**2.1 Terms.** These terms are used consistently in this record.

| Term | Meaning in this record |
|---|---|
| Owner-side licensing system | The Owner's system that manages customers, contracts, licenses, versions, signed updates, status tracking, replacements, and audit history. It never runs on a customer server. |
| Owner signing private key | The secret used to sign licensing data. It stays on the Owner side, in a secure environment, and is used only by the authorized issuance process. |
| Trusted public-key material | Public keys held by a customer server to verify signed licensing data. It can never sign. |
| Customer | The commercial party that owns one or more Vardena server installations and holds contracts. |
| Contract | The commercial agreement under which licenses are sold or renewed. Owner-side only. |
| License | The commercial right bound to one customer and to one server installation. It has a type (perpetual or subscription), a status, and a history of versions. |
| LicenseVersion | One signed, retained version of a license: its dates, modules, and capacity limits. A commercial change is represented by a new LicenseVersion. |
| Server installation | One Vardena server deployment, with its own installation identity. |
| Installation identity key | The dedicated identity and cryptographic key of a server installation. It is generated automatically on the first Vardena run and is independent of commercial activation. Its private part stays on the server. (Shape of the key: §16.) |
| Server installation replacement | A dedicated, auditable workflow for hardware failure, reinstallation, or a necessary move to another server. It is recorded as a ReplacementRecord. |
| Client device | A client device registered against a server license and identified by its own device key. |
| Module entitlement | The commercial right to use a module. |
| Capacity | The number of users and the number of registered devices the license allows. |
| User permission | An application permission held by a user within an entitled product. It never bypasses a missing module entitlement or a capacity restriction. |
| Restricted mode | A restriction with explicit reason/context. Expiry follows Grace then Read-Only (§9); it is not deletion or full revocation. |
| Full revocation | Blocks normal commercial access, while preserving restricted administrator license/recovery access (§10). It is not expiry. |
| Signed file | A digitally signed file transferred manually. A text representation may exist as a fallback, but it is only a transport mechanism. |
| Operation | A uniquely identified licensing action (for example, issue, renew, revoke, reactivate, replace, activate). Every operation has its own authenticity checks. |
| Activation receipt | A signed record that a successful activation happened, identifying the operation and its outcome. |
| AuditEvent | A retained, attributable record of a licensing-relevant event (§12.7). |

**2.2 Three conceptual areas.** The licensing product has three areas:

1. **Owner-side licensing management** — the Owner's system (§4).
2. **Server license** — a license associated with one specific Vardena server installation (§3, §5, §9–§11).
3. **Client-device licensing** — registered client devices, controlled independently of the server license (§7).

**2.3 Entitlement versus permission (Must).**

- License entitlements determine which modules and capacities the customer may use.
- User permissions determine which actions a user may perform inside the entitled product.
- A user permission must never bypass a missing module entitlement or a capacity restriction.

**2.4 Conceptual shape (illustrative, not a schema).**

```text
Owner side (Owner-controlled)                  Customer server (offline-capable)
  Customer ── Contract                           ServerInstallation (identity key)
     └── License                                     ├── current/future LicenseVersions (imported signed files)
           ├── LicenseVersion (signed, retained)     ├── ClientDevice registrations (device keys)
           └── ReplacementRecord                     └── local audit trail
  AuditEvent (Owner) ◄──── receipts / status ────── manual file transfer (offline-capable)
```

## 3. Server license types and lifecycle

**3.1 Perpetual license (Must).**

- Has no time-based expiry.
- Remains subject to its purchased modules and capacity limits.
- Must not require periodic renewal merely because time passes.
- Must remain valid through ordinary signing-key rotation, including the approved non-automatic-invalidation policy for key compromise (§4.4, §20; U-1/OQ-74).

**3.2 Subscription license (Must).**

- Has explicit start and end dates.
- Is renewed by importing a new signed license file.
- The Owner manually specifies the start and end dates of each new version.
- A future-dated renewal does **not** immediately replace a still-valid current version. The current version remains valid until its own end date. The new version becomes effective according to its own start date.
- Reactivating a revoked subscription does **not** extend its original expiry date (§10.6).

**3.3 Commercial change versus installation replacement (Must).**

- A commercial license or version change represents a purchase, a contract change, a module change, or a capacity change. It is represented by a new signed LicenseVersion. Historical versions and audit events are retained.
- Installation replacement is a separate concept (§5.4).

**3.4 Version effectivity.** Which version governs follows the validity dates and the previously approved overlap/gap/retained-history rules (OQ-80/OQ-86, §15 PQ-5 and §20.1); this reconciliation does not reopen them.

**3.5 Conceptual lifecycle states.** The approved concepts are: *not yet effective* (a future-dated version before its start date), *effective* (within validity), *expired* (subscription end reached, restricted mode per §9), and *revoked* (full revocation per §10). The precise state machine is a design item (§16). `SUSPENDED` is not a new product state for future records, but legacy `SUSPENDED` values must not be blanket-mapped to any other status, including `CANCELLED`. Classify historical records only from attributable cause; ambiguous cases remain restricted and reviewable (OQ-79/§21). Earlier wording that called `SUSPENDED` "removed" did not authorize a migration or infer a replacement status. The legacy enum remains a compatibility concern; audit, compatibility and migration work remain open. Grace and Read-Only are approved behavioral phases, not an instruction to add wire enum values.

## 4. Owner-side licensing administration

**4.1 The Owner-side system manages (Must):**

- customers and contracts;
- license issuance;
- license versions and signed updates;
- module entitlements and capacity limits;
- subscription renewal;
- license revocation and reactivation;
- server installation replacement;
- Owner-side status tracking and corrections;
- audit history.

**4.2 Access control (Must).** The Owner-side system supports multiple users with role-based access control. The approved role categories are listed in §13. Exact permissions for each role are **OPEN** (§15, U-5) and are not decided by this record.

**4.3 Approval model (Must).** Second-person approval is **not** mandatory. Role-based authorization and auditability are required.

**4.4 Signing key handling (Must).**

- The Owner signing private key must remain in a secure environment on the Owner side.
- Only the authorized issuance process may access it.
- It must **never** be distributed to customer servers.
- Ordinary signing-key rotation must not invalidate otherwise valid perpetual licenses issued under a previous key.
- **Product Owner decision (2026-10-15, U-1/OQ-74):** existing issued licenses remain valid and are not automatically invalidated solely because a signing key is compromised. This does not make a compromised key safe. Engineering must document the consequences and compatible key-rotation/incident-response design for new issuance, trust updates, key revocation and controlled recovery (§20.4); production custody and unresolved security trade-offs remain gated. No signed format or existing artifact is changed by recording this policy. Continued validity of issued licenses does not establish trust in new artifacts under the compromised key: signature verification alone cannot distinguish genuine new imports from forgeries. Issued-but-not-imported provenance, trust rollout, containment, offline recovery and production custody remain design-gated (§20.4); return any exact safety incompatibility to the Product Owner rather than blanket-invalidating existing licenses or trusting all future signatures.

**4.5 Owner-side status tracking (Must).**

- The Owner manually updates its recorded view of a customer's status from the information available.
- A missing customer status report must **not**, by itself, restrict customer use.
- The Owner's recorded status may be unconfirmed or out of sync with an offline installation.
- Correcting an incorrect Owner-side status must preserve the previous value, the new value, the timestamp, the actor, and the correction reason.
- A change in the Owner system does **not** automatically execute an operation on an offline customer server.

## 5. Server installation identity and replacement

**5.1 Identity (Must).**

- Each server installation generates a dedicated server installation identity and cryptographic key automatically on the first Vardena run.
- This identity generation is independent of commercial license activation.
- The private part of the identity key stays on the server.
- The first successful license activation binds that license to this installation/server ID. Reactivation on the same installation is permitted; ordinary activation against a different server ID is refused and requires the approved replacement process (ADR-0045).

**5.2 Signed license file (Must).**

- The server license is delivered as a **digitally signed file**, not merely as a plain-text key.
- The customer server verifies signed license data using trusted public-key material.
- The Owner signing private key must **never** be present on the customer server.

**5.3 One active installation per license (Must).** One active server installation is allowed per license.

**5.4 Replacement versus commercial change (Must).** These concepts are distinct.

- *Installation replacement* covers hardware failure, reinstallation, or a necessary move to another server. It **must not** automatically require repurchasing the same commercial rights. It must have a dedicated, auditable replacement workflow.
- *Commercial change* is a new signed LicenseVersion (§3.3).

**5.5 Replacement workflow — current Product Owner policy (OQ-82, 2026-10-16).**

1. Every new server installation/replacement requires manual Owner authorization
   attributed to an authorized Owner user; no automatic unrestricted transfer.
2. Set up the replacement server and activate its replacement license **before**
   manually decommissioning the old server. A request, authorization or issuance
   alone does not invalidate the old server.
3. After replacement activation, the old server is manually decommissioned. The
   replacement remains pending until an authorized operator records auditable
   confirmation that this manual decommission occurred; only then may the Owner
   replacement record be finalized.
4. The confirmation window is configurable from **1 hour through 7 days**, with
   a **24-hour default**. Window expiry alone is not proof of decommission and
   does not perform a remote shutdown, remote deactivation, or any action on the
   customer's server.
5. Preserve attributable replacement history and continuity if activation fails.
   The prior rule that a cancelled request cannot be reused remains; exact
   pending/cancellation/failure state, evidence fields, timeout recovery and API
   contract remain technical follow-ups under OQ-82.

The pending replacement request/confirmation period defaults to **24 hours**
and may be configured by Owner Admin from **1 hour to 7 days**. Its start/end
semantics require specification; expiry alone does not prove that the old server
stopped.

**Unresolved OQ-82 integration/specification gap:** §5.3 requires one active
installation per license and §5.1/ADR-0045 binds activation to an installation
ID, while this policy requires replacement activation before old-server
decommission. The approved records do not specify how the new server can pass
activation while the old installation remains active, or how pending and final
records are committed without violating binding or creating inconsistent/dual
active records. Do not infer a temporary multi-active exception, binding bypass,
state machine or transaction. This is an implementation/specification blocker
for OQ-82, but does not alter the decided order; the missing activation and
finalization contract must be designed before implementation/acceptance.

No separate signed receipt is required for **ordinary activation** (OQ-84).
That decision does not settle operation-specific server-replacement evidence. The
exact evidence and validation for auditable manual decommission confirmation
remain unspecified and must not be guessed. In addition, the new-server activation
path and atomic pending/finalization semantics under §5.3/ADR-0045 are not
specified; OQ-82 implementation is blocked until designed. Existing Owner
observation records are not proof that the customer server was decommissioned.

Owner-side authorization and records do not execute a license-state transition
on either customer server. An offline server cannot be remotely controlled, and
instant remote revocation of a disconnected server cannot be guaranteed. This
workflow is distinct from client-device replacement (OQ-83).
**5.6 Continuity of an isolated old server (Must).** An isolated old server may continue using its cached licensing state until it receives an applicable signed update or revocation. **Instant remote revocation of a disconnected server cannot be guaranteed.**

## 6. Backup and recovery rules

**6.1 Identity key in backup (Must).** The server's private identity key is included in the full backup, **in encrypted form**.

**6.2 No escrow (Must).** No separate recoverable key-recovery mechanism is approved. No Owner-side escrow of the backup decryption key is approved. Do not invent a key escrow or recovery service.

**6.3 Encrypted does not mean recoverable (Must).** The encrypted private key may be present in a backup, but that does **not** make it recoverable if the capability to decrypt it is lost.

**6.4 Loss of the key (Must).** If the original key, or the ability to decrypt or recover it, is lost, the installation must go through the **replacement process** (§5.5).

**6.5 Database restore is not identity (Must).**

- A database restore without the installation identity key is **insufficient** to establish the old installation's identity.
- If a new environment lacks the required identity material, recovery must be handled through **Owner support**.
- A database restoration alone must **not** silently create or impersonate the previous identity.

**6.6 Cryptographic design (Design item).** Algorithms, encryption-key handling, backup access controls, and recovery boundaries are technical design work (§16; §15, U-2).

**6.7 Backup, export, and restore authority (Recorded — existing decisions).** The existing records apply and are not changed here:

- Business Export (Excel) and Disaster/Technical Backup are distinct (`docs/operations/backup-and-restore.md` §1; OQ-46).
- Normal ERP users never have an in-product Restore. Restore is performed by the customer's authorized IT or server administrator per the Runbook (OQ-53).
- Restore must never be blocked by license state (OQ-53; `docs/operations/backup-and-restore.md` §3). Full revocation preserves essential backup/recovery through §10.3, without granting ordinary users in-product Restore or commercial access.

## 7. Client-device licensing and lifecycle

> **Current replacement policy correction (2026-10-16):** device identity,
> client-side private-key custody, quota/history and quota-neutral atomic-swap
constraints remain. The former customer-admin/self-service signed replacement
> workflow in the earlier §7 details is historical; automated customer self-service
> replacement is deferred for MVP and superseded by [PDR-15 §6](PDR-15-client-device-licensing-and-replacement.md#6-product-owner-update--mvp-replacement-operating-model-2026-10-16): replacement is manually Owner Admin-managed, the old device stays active until the new device activates, then the swap is atomic. Do not present prior self-service replacement or VDRP1 flow as current policy or MVP conformance evidence. Regular enrollment is not re-decided; exact replacement workflow/evidence/API remain open.

**7.1 Counting (Must).** Client-device entitlement is counted by **registered devices**. It is not counted by concurrent sessions, and it is not the number of user accounts.

**7.2 Quota consumption (Must).** A registered device consumes quota until it is explicitly deactivated or replaced. **Decision update (2026-10-15, PDR-15 / OD-LIC-04):** replacement is a one-for-one exchange and does not increase consumed quota. While replacement is pending, the old active device continues to consume one unit; only successful atomic completion changes the old device to replaced and activates the new device. Pending replacement requests do not consume a second unit.

**7.3 Administration in the GUI (Must).** The customer's System Administrator manages devices through Vardena's graphical interface. The licensing UI must expose:

- registered devices;
- registration and activation;
- deactivation;
- replacement (the former customer self-service replacement UI/workflow is
  superseded for MVP by PDR-15 §6; Owner Admin manages replacement);
- license information;
- consumed and available device quota.

**7.4 Direct activation (Must).** The administrator may activate a device directly when the request is valid and quota is available. There is **no** separate device-activation approval stage.

**7.5 Deactivation and replacement are distinct (Must).** They are separate operations with separate meanings and records.

**7.6 History retained (Must).** Device history is retained. Device records must not simply be deleted.

**7.7 Device identity (Must).**

- A device's identity must **not** rely solely on its IP address or machine name.
- The intended identity model is a **dedicated cryptographic key per device**. The device's private key stays on the client. The server associates the device's public key with its authorization.
- **Decision update (2026-10-15, PDR-15 / OD-LIC-04):** the private key remains client-side and is never sent to or persisted by the server. The former signed self-service replacement proof/choreography is historical and superseded for MVP by PDR-15 §6; no new replacement-specific signed protocol is authorized. Regular enrollment is not re-decided by that addendum.

**7.8 Reinstallation (Must).** Reinstallation may destroy a device key. A recovery or replacement workflow is therefore required.

**7.9 Historical customer-admin replacement detail (superseded for MVP by PDR-15 §6).** The earlier customer System Administrator self-service flow allowed replacing a lost/reinstalled device without access to its old key; it is not the current MVP replacement procedure.

**7.10 Replacement safety properties (current baseline; former workflow details historical).** Under PDR-15 §6, the old device remains active until the replacement activates, then a successful replacement performs an atomic quota-neutral swap; failed activation must not partially swap or strand the old device. The 2026-10-15 signed self-service flow's correlated-response checks, “replacement without the old key” mechanics and one-pending-request limit are historical design details, not independently approved current workflow requirements. Manual Owner Admin evidence and customer-side activation/import mechanics remain to be specified.

**7.11 Historical offline self-service replacement protocol (superseded for MVP by PDR-15 §6).** The earlier customer-driven flow left completion pending until a signed response/evidence was imported. Its VDRQ1/VDRP1 request/response choreography is preserved as prior implementation evidence, not the approved MVP replacement workflow. No signed artifact or receipt is newly required for the manual Owner Admin replacement flow; its evidence/activation mechanics remain open. This is distinct from OQ-84's no-signed-receipt rule for ordinary activation and from OQ-81's separate API replay-receipt contract.

**7.12 Activation paths (Must; general enrollment scope).** These earlier general
device-activation paths are not an authorization for customer self-service
replacement. For MVP replacement, PDR-15 §6 controls and no replacement-specific
signed workflow is newly approved here. Regular enrollment is not re-decided by
that addendum.

- *Normal activation* may use the local server.
- *Alternate activation-code flow:* Vardena generates a code. The client sends it to the local server, which validates quota and registers the device.
- *True offline activation* must support manual transfer of a request and a response, using a file, a USB drive, or an equivalent method.
- **Signed files are the primary offline transfer method.** A text code may be supported as a fallback. A text representation is **only a transport mechanism**. It does not replace signature verification or operation binding.

**7.13 Quota reduction (Must).**

- If the signed entitled device count is reduced below the number of active registered devices, the **administrator explicitly selects** the excess devices for deactivation. Deactivation is a separate, audited operation; a license import or replacement never silently selects devices.
- Until the active count is within the new finite limit, **new device registration is blocked**. The signed reduction may be applied after either the administrator explicitly deactivates selected devices and retries it, or the administrator resolves the conflict through the existing authorized, audited licensing reduction flow. The latter does not select or deactivate devices; retained active devices may remain above the new limit while new registration stays blocked.
- **Never silently auto-deactivate or delete devices.** History is retained.
- **Decision update (2026-10-15, PDR-15 / OD-LIC-04):** a successful replacement does not add quota use; it atomically exchanges one active device for another. PDR-15 §2.15 confirms the existing authorized licensing reduction flow as an alternative to manual deactivation, superseding the earlier reason-only no-bypass sentence.

## 8. User, device, and module entitlements

**8.1 Separation.** Entitlement and permission are separate (§2.3). A permission never overrides a missing entitlement.

**8.2 Module entitlement removed (Must).**

- Normal use of that module stops.
- The module's data is preserved.
- General backup and export functionality remains available.
- Ordinary module functionality is **not** allowed merely because a user still holds permissions.
- Entitlement conflicts must be checked and communicated **before** the new version is applied.
- No destructive automatic correction is allowed.

**8.3 User capacity reached (Must).**

- When the registered user count reaches the current entitlement, existing users continue to operate, subject to all other applicable rules.
- Creating additional users is blocked until a new LicenseVersion grants sufficient capacity.
- The system must **not** silently increase capacity.

**8.4 User capacity reduced (Must).**

- The customer's System Administrator **manually** deactivates excess users.
- Existing user data is **not** deleted.
- Users are **not** deactivated automatically.
- The capacity conflict is reported clearly and requires an explicit resolution.

**8.5 Device capacity reduced.** See §7.13.

**8.6 Applying a downgraded or changed version (Must).** Before applying a LicenseVersion that reduces entitlements or capacity, the system must:

1. check the resulting state for conflicts;
2. explain the conflicts to the customer's System Administrator;
3. preserve data;
4. require explicit resolution of excess users or devices where applicable;
5. prevent new registrations or creations that would worsen an unresolved capacity conflict;
6. not silently destroy, delete, or automatically deactivate existing records.

The atomic application algorithm is a design item (§16).

## 9. Subscription expiry and restricted mode

**9.1 Product Owner decision — natural subscription expiry (OQ-45, updated 2026-10-16).**
For **natural subscription expiry only**, the path is **Active → Grace (14×24 hours in UTC) →
Read-Only**. The exact boundary is the recorded signed expiry Instant plus
14×24 hours in UTC; Grace ends at `now >= boundary`. This is not calculated in
the display timezone and is not rounded to a local date. See the canonical
[OQ-45 record](OQ-45-license-expiry-behavior.md).
At natural subscription expiry, display the actual reason/status; normal authorized operation
continues during Grace and the existing Read-Only capabilities apply afterwards.

Intentional subscription cancellation is not natural subscription expiry and receives no
automatic 14-day Grace. Subscription cancellation, license cancellation, expiry,
replacement and reissuance remain distinct lifecycle events. The resulting
cancellation/restriction transition is not inferred here; see OQ-78. The separate
contract-termination strictness question remains open. Signed half-open validity,
`validUntil`, display-zone formatting and Owner-authorized signed extensions are
unchanged. Grace/Read-Only enforcement and verification remain unimplemented.

Any Grace beyond the natural-subscription-expiry period of 14×24 hours in UTC
requires Owner authorization and a valid Owner-issued signed artifact through
approved validation. Local settings,
database edits, restarts or clock changes must not extend Grace. This is an
observable anti-bypass requirement, not a claim of absolute protection against
an OS administrator (§1.5). Expiry is neither technical failure nor emergency
revocation (§10.10); an outage alone does not suspend commercial rights or
silently extend the signed validity/Grace period.

**9.2 Implementation requirements — Read-Only capabilities.**

- All existing users may log in subject to normal account/authentication and
  authorization requirements, not only System Administrators.
- Existing permissions continue to govern viewing documents and reports,
  printing and Excel export. Read-Only grants no new permission.
- Database backup remains available through the approved administrative/recovery
  path (§6.7); license status and license renewal remain accessible.
- Business-document creation, business-data modification, and operations
  affecting inventory or accounting are blocked, including Accounting Post.
  Enforce this at backend/API and relevant asynchronous processing paths;
  disabled or hidden frontend controls alone are insufficient.
- Preserve users, permissions, business data and document history: no deletion,
  rewriting or weakening when entering Read-Only.

**9.3 Restoration.** Read-Only is reversible. Accept a valid renewal and
revalidate license state before returning to the previously authorized operational
state, without manual reconstruction of data/permissions. Renewal never clears
an independent emergency or integrity restriction. Future-dated versions and
post-gap recovery still follow their existing decisions, not a new bypass (§20.1).

**9.4 Delegated technical design and status.** Engineering owns the enforcement
mechanism, module/worker operation classification and acceptance tests, applying
the PO-selected UTC boundary in OQ-45/PDR-11 §21 without weakening §9.2.
Grace/Read-Only enforcement is not implemented or verified by this PR. Follow-ups and acceptance criteria are in §20.5–§20.6.

**9.5 Dates.** License/expiry/Grace screens, reports and filters follow the
project-wide Persian/Jalali-first policy in [docs/datetime.md](../../datetime.md)
§0, including the established timezone, digit and historical-fallback conventions.

## 10. Full revocation and reactivation

**10.1 Product Owner decision — emergency restriction (OQ-78, 2026-10-15).** Full revocation/emergency stop is distinct from contract expiry. Block normal commercial access immediately when valid, applicable Owner authorization or an explicitly defined security policy requires it; display the actual reason to the administrator/user as appropriate. Do not start expiry Grace or conflate reasons. This supersedes the earlier blanket administrator-login prohibition: restricted recovery access remains possible (§10.3). No ambiguous replacement for `SUSPENDED` is introduced.

**10.2 No automatic deletion (Must).** Customer data is **not** automatically deleted by revocation.

**10.3 Product Owner decision — restricted recovery access (OQ-78/PQ-3).**
The System Administrator must be able to enter a restricted license/recovery
interface using the approved administrator identity/authentication process,
independently of ordinary commercial login. It permits viewing license state and
restriction reason, importing a valid Owner-issued signed artifact through the
approved validation process, and essential backup/recovery operations through
the approved administrative path (§6.7). It grants no general commercial access
and is not an emergency bypass. This limited administrative path remains available
to apply applicable signed offline cancellation/revocation or replacement
artifacts under their approved validation rules; opening the path or importing a
cancellation artifact does not restore ordinary user access. The Owner records
authorized cancellation/replacement actions in its audit history.

An import clears a restriction only if the artifact is valid, customer/installation
applicable, authorized for the intended operation, and accepted by the relevant
state-transition rules. Recovery access and license-state changes must be
auditable. Preserve the Owner/customer separation: no Owner keys, Owner runtime,
customer-database access from Owner, callback or dependency on online service.
This is a required behavior, **not an existing recovery implementation**; the
concrete authentication/session/protocol gaps are recorded in §20.5.

**10.4 Offline servers (Must).**

- License cancellation/revocation is distinct from intentional subscription
  cancellation, expiry, replacement and reissuance. For an offline server, the
  approved license-cancellation/revocation action takes effect locally only after
  its applicable signed offline artifact is imported through the restricted
  administrative path; the Owner records the cancellation in its audit history.
- Importing the cancellation artifact does not restore ordinary user access.
  Instant remote revocation cannot be promised to a disconnected server.

**10.5 Binding (Must).** Revocation files must be cryptographically bound to the relevant license and operation.

**10.6 Reactivation (Must).**

- Restoration of normal commercial operation requires valid Owner authorization and a **new valid Owner-issued signed code or file**, according to the approved protocol. An ordinary renewal cannot silently clear an unrelated emergency restriction; neither restart nor clock correction bypasses it.
- The Owner may reverse a previously recorded revocation.
- The complete revocation and reactivation history is preserved.
- Reactivation restores the **previous** license status subject to revalidation of current validity and all independent restrictions; it is not unconditional permission for commercial operation.
- Reactivation of the same revoked license does **not** change its original
  license dates. This does not require a separately reissued license after
  recovery to preserve those dates; no additional reissuance transition is
  defined here.
- If a subscription has expired, reactivation alone does **not** renew it.
- A signed reactivation file must be imported on the customer server.
- An offline server remains in its previous local state until the valid file is imported.

**10.7 Operation identity (Must).** Every operation has a unique identifier and authenticity checks.

**10.8 Product Owner decision — duplicates (OQ-81/PQ-8).** An exact repeat
of an already successful request returns the previous result, rather than
executing again. Conflicting reuse is rejected. Define identity using the
relevant operation identity, request contents and persisted result; a similar
human-readable description is not identity. A replay must not repeat effects,
consume quota twice or create another lifecycle transition. Engineering must
specify safe authorized retrieval of the original result and conflicting reuse
detection, including concurrent retries, before changing current protocols.
The existing v2 rejection/legacy no-op asymmetry is an implementation gap, not
an exception to this product decision (§20.5).

**10.9 No false duplicates (Must).** A genuinely new valid operation must not
be rejected merely because it resembles an older operation.

**10.10 Failure classification (Product Owner decision).** Distinguish at least:

| Condition | Required behavior |
|---|---|
| Ordinary temporary technical/service/infrastructure failure | Not, by itself, a commercial suspension. Preserve offline boundaries; report the technical failure honestly. |
| Natural subscription expiry | §9: 14×24 hours in UTC Grace then defined Read-Only; renewal path. |
| Validated Owner-directed emergency restriction | Immediate applicable restriction with valid authorization and a specific recorded reason; §10.3 recovery and §10.6 restoration, not expiry Grace. |
| Security-integrity verification failure | Follow existing signed-artifact verification/security boundaries; reject invalid artifacts without accepting their claimed authority. Genuine incidents need explicit, deterministic, testable responses. Unresolved incident-to-restriction policy remains technical/security follow-up, not invented business policy. |

There is no blanket fail-open or fail-closed licensing rule. A rejected artifact
is not proof of an authorized Owner stop. Restrictions must retain independent
reasons so renewal, clock repair or restart never clears an unrelated one.

## 11. Offline operation and signed file exchange

**11.1 Offline operation (Must).** The customer server normally runs locally and must support offline operation. A permanent internet connection is **not required** for normal customer use.

**11.2 Local verification (Must).** The customer server verifies signed licensing data locally, using trusted public-key material (§5.2).

**11.3 Signed files first (Must).** Signed files are the primary exchange method. A text representation is a fallback transport only. It does not replace signature verification or operation binding (§7.12).

**11.4 Manual transfer (Must).** Offline requests, responses, and receipts are transferred manually, by file, USB drive, or an equivalent method.

**11.5 Owner-side receipts (Must).** Receipts from an offline customer can be imported into the Owner system when the customer is offline (§5.5 step 7).

**11.6 No automatic execution (Must).** The Owner's recorded view may be out of sync with an offline installation. An Owner-side change does not execute automatically on an offline server (§4.5).

**11.7 Offline artifact application.** Approved license cancellation/revocation and reactivation take effect locally on an offline customer server only after the applicable valid signed artifact is imported (§10.4/§10.6). The former OQ-83 signed self-service device-replacement flow in §7.11 is historical and superseded by PDR-15 §6; current device replacement does not acquire a new signed protocol here. OQ-82 server replacement remains a manual Owner-authorized sequence with its activation/evidence mechanism unresolved; no signed replacement artifact is inferred.

**11.8 Formats (Design item).** The exact file formats and protocols for licenses, renewals, revocations, reactivations, replacement requests and responses, and activation receipts are **not** decided here (§15, U-3; §16). Backward compatibility and versioning are **OPEN** (§15, U-8).

## 12. Security and audit requirements

**12.1 Objective.** Practical protection against straightforward copying, forgery, and unauthorized operations (§1.5). No absolute protection against a full local administrator is claimed.

**12.2 Authenticity (Must).** Every signed licensing input is verified before it is accepted, using trusted public-key material only.

**12.3 Binding (Must).** Signed inputs are bound to the relevant license, installation, device, and operation as applicable.

**12.4 Replay and duplicates (Must).** Operation identifiers and authenticity checks prevent replay. Duplicate operations are rejected or handled as defined in §10.8 without changing state twice.

**12.5 Signing-key custody (Must).** The Owner signing private key is never present on a customer server (§4.4, §5.2).

**12.6 Product Owner decision — clock rollback (U-6/OQ-76).**

- A small backward clock change by itself does **not** trigger restriction.
  Restrict only when reliable time-integrity evidence establishes meaningful
  rollback; do not invent a numeric threshold or tolerance.
- When the evidence requires a rollback-only restriction, apply it and record the
  appropriate attributable security/audit event. Persist the time-integrity
  evidence needed for subsequent validation.
- After clock correction, revalidate trustworthy current time and the relevant
  license/time evidence against the persisted evidence. If validation establishes
  that the rollback issue is resolved, removal of only the rollback-only
  restriction requires a controlled, attributable, audited unlock. It is not an
  unconditional or automatic unlock.
- If validation fails or evidence remains uncertain, require secure, authorized,
  attributable and audited recovery. Do not invent an unsigned local reset,
  watermark erasure or universal Owner-signature waiver; exact mechanisms remain
  engineering design work.
- Never clear an independent emergency or other unrelated restriction. Clock
  correction, renewal, restart or database manipulation must not bypass unrelated
  restrictions or alter signed license expiry (§1.5's practical security limit
  remains).
- Detection, persistence, trusted-time evidence, tamper/restart resistance, the
  controlled unlock and secure recovery are **not implemented** and require
  engineering design, tests and acceptance under U-6/OQ-76.

**12.7 Audit history (Must).** History must be preserved for at least:

- license issuance and versions;
- license imports and their outcomes;
- renewals and entitlement changes;
- revocation and reactivation;
- server replacement requests, cancellations, activations, and receipts;
- device registration, activation, deactivation, and replacement;
- user and device capacity conflicts and their resolution;
- Owner-side status updates and corrections;
- clock rollback alerts and recovery;
- duplicate operation attempts where relevant.

**12.8 Product Owner decision — audit (U-7/OQ-77).** Audit history is retained
**permanently in a separate archive**. Sensitive audit access is restricted to
authorized roles and must not unnecessarily expose sensitive data. No deletion
or purge workflow may contradict permanent retention. Exact schema, archive
boundary/storage, minimization/redaction, access control and restore/continuity
mechanisms remain engineering/security design work. Current typed tables and
append-only application paths do not establish a separate permanent archive or
cryptographic immutability. Do not claim tamper-proof storage without design and
implementation evidence. Manually recorded Owner actions remain attributable
observations, not cryptographically verified operations (PDR-17).

**12.9 Non-destructive principle (Must).** Licensing actions never delete customer data as a side effect. Every destructive or capacity-changing consequence requires an explicit, auditable resolution (§7.13, §8.2, §8.4, §8.6).

## 13. Owner-side roles and responsibilities

The Owner MVP has exactly two roles: **Owner Admin** and **License Operator**.
This supersedes the earlier four-role categories recorded in dated history and
the former PDR-17 matrix. Owner Admin administers Owner users/access/configuration and carries
Owner-admin decision authority. License Operator performs approved routine
customer/license operations. Exact endpoint grants and security controls are not
yet fully specified or implemented; role names alone do not grant signing-key
custody, unrestricted recovery, or an otherwise undecided lifecycle operation.
See [PDR-17](PDR-17-owner-web-application-phase-1.md) and OQ-75.

**13.1 Cross-cutting (Must).** Every role-based action is attributable to an actor and recorded in the audit history (§12.7). Role-based authorization is required even though second-person approval is not (§4.3).

**13.2 Signing key (Must).** No role grants routine access to the Owner signing private key beyond the authorized issuance process (§4.4).

## 14. Conceptual entities and relationships

These are conceptual entities. They do **not** prescribe schema names, tables, or storage. The existing `licensing.*` tables are not a design commitment (§19, CF-17).

| Entity | Conceptual purpose | Principal relationships |
|---|---|---|
| Customer / Contract | The commercial party and its agreements. | A customer holds contracts and licenses. |
| License | The commercial right bound to one customer and to one server installation. | Has one or more LicenseVersions and may have ReplacementRecords. At most one active server installation per license (§5.3). |
| LicenseVersion | A signed, retained version of a license with its dates, modules, and capacity. | Belongs to one license. Versions are retained, never overwritten. |
| ServerInstallation | One server deployment with its identity key. | Receives license versions; hosts client devices; is the subject of replacements. |
| ReplacementRecord | A tracked replacement operation for one installation. | References the license, the replaced installation, and the replacing installation. At most one valid pending request at a time (§5.5). |
| ClientDevice | A registered client device with its own key and history. | Belongs to one server installation and therefore consumes that license's device quota while registered (§7.2). |
| AuditEvent | An attributable, retained record of a licensing-relevant event. | References the actor and the affected entity. Retained. |

Cardinalities beyond the constraints stated in this record are design items (§16).

## 15. Product decisions and remaining design questions

Originally unresolved items from the Owner brief (U-1…U-9) and reconciliation
(PQ-1…PQ-9) retain their identifiers. The Handling column now distinguishes
approved product behavior from residual technical/security/implementation work.
Do not infer approval of a mechanism from approval of behavior. §20 and the
central registry give current dispositions; older dated status notes are historical.

### 15.1 Owner-brief items and remaining scope

| ID | Open question | Handling |
|---|---|---|
| U-1 | Signing-key compromise (OQ-74). | **Product policy decided 2026-10-15:** existing issued licenses are not automatically invalidated solely by key compromise (§4.4). Incident response, rotation/custody and security consequences remain design-gated (§20.4). |
| U-2 | **Exact backup cryptographic design.** Algorithms, encryption-key handling, backup access controls, and recovery boundaries. | Technical design item (§6.6). Any loss-of-capability consequence stays as §6.3–§6.5. |
| U-3 | **Exact file formats and protocols** for signed licenses, renewals, revocations, reactivations, replacement requests and responses, and activation receipts. | Technical design item (§16). |
| U-4 | **Precise state machines** for license versions, server replacement, client-device replacement, pending requests, cancellation, and replay prevention. Including the Owner-side "unconfirmed" status. | Technical design item (§16). |
| U-5 | Owner role permissions and authentication. | The two-role model (Owner Admin, License Operator) is decided in §13/PDR-17; exact permission mapping, security review and implementation remain OQ-75. No inferred signing or recovery grants. |
| U-6 | Clock rollback (OQ-76). | **Product behavior decided:** small clock rollback alone does not restrict; reliable evidence of meaningful rollback is required. After correction, verified resolution permits only a controlled, attributable, audited rollback-only unlock; failed/uncertain validation requires secure authorized recovery (§12.6). Thresholds and mechanisms remain engineering work; none is implemented. |
| U-7 | Audit (OQ-77). | **Retention/access policy decided:** permanent separate archive, authorized sensitive access, minimization, no contradictory purge (§12.8). Schema/archive/security controls remain design and implementation follow-ups. |
| U-8 | **Backward compatibility**: versioning and migration rules for future signed-file formats. | Technical design item (§16). |
| U-9 | **Server replacement activation/finalization, failure recovery and evidence** (§5.5; OQ-82). | The Owner-approved manual order and bounded pending confirmation period are in §21/PDR-17. The spec does not explain activation of the new installation while the old is active under §5.3/ADR-0045. Exact binding-compatible activation, pending/finalization atomicity, decommission evidence and timeout/failure recovery remain technical gaps; do not infer proof or remote decommission. Implementation is blocked until specified. |

### 15.2 Product clarifications found during reconciliation

| ID | Open question | Why it matters | Handling |
|---|---|---|---|
| PQ-1 | Natural-subscription-expiry Grace (OQ-45). | Grace boundary, extension authority and cancellation distinction. | **Decided:** natural subscription expiry gets 14×24h UTC Grace; ends at `now >= expiry + 14 days`; Owner-authorized valid signed extension only. Intentional subscription cancellation gets no automatic Grace. Contract-termination strictness remains open; enforcement is unimplemented (§9/§21). |
| PQ-2 | Read-Only meaning (OQ-45). | One observable contract. | **Decided:** all existing users under normal auth, existing read/report/print/Excel rights, backup/status/renewal; no business mutation; backend/async enforcement and reversible restoration (§9). |
| PQ-3 | Full revocation/recovery (OQ-78). | Recovery must not depend on commercial login. | **Product behavior decided:** restricted authenticated administrator recovery interface and backup path (§10.3), valid signed restoration (§10.6). Authentication/session/state/protocol design remains open. |
| PQ-4 | Legacy `SUSPENDED` (OQ-79). | Compatibility and historical meaning. | **Product policy decided:** classify only from attributable evidence; never blanket-map to any status. Ambiguous history remains restricted/reviewable. Audit, compatibility, migration and rollback work remain open; no enum/schema/signed-byte change or migration is claimed (§3.5/§20.3/§21). |
| PQ-5 | Overlapping/gapped subscription versions (OQ-80/OQ-86). | Retained effective history and renewal. | **Previously decided, unchanged:** Option B overlap, G2 renewal gaps and full retained-history checks; PDR-12/PDR-13 and later Q3 clarification remain authoritative (§20.1). |
| PQ-6 | Device replacement quota effect and offline workflow (OQ-83). | Prevent excess quota and customer lockout. | **Quota-neutral one-for-one swap is decided.** The 2026-10-16 MVP workflow is manually managed by Owner Admin, not customer self-service; keep the old device active until replacement activation, then atomically swap. Exact workflow/evidence and reconciliation of existing implementation remain OPEN. Existing device key-custody and quota-reduction rules remain. See PDR-15 §6 and §7.13. |
| PQ-7 | **Owner-side system ownership and location.** Is the Owner-side licensing system part of Vardena or a separate tool? Existing records defer CRM and commercial providers (ADR-0030; `docs/licensing-architecture.md`), and OQ-61 is Open on CRM ownership and timing. | Determines where Owner-side requirements are built and who owns the data. | Owner decision. Linked to OQ-61. |
| PQ-8 | Duplicate operations (OQ-81). | Safe retries and conflicts. | **Product behavior decided:** exact successful repeat returns persisted previous result, conflicting reuse rejected, no repeated side effects (§10.8). Technical identity/result retrieval remains open. |
| PQ-9 | Ordinary activation receipts (OQ-84). | Evidence is not a signature. | **Decided:** no separate signed receipt required for ordinary activation; manual attributable activation history suffices for approved scope (PDR-17). This does not decide OQ-83 replacement evidence or OQ-82 server-replacement protocol details, and is separate from OQ-81 API replay receipts/DTO. |

## 16. Technical design questions deferred to the next phase

These are the originally delegated technical questions, not new product choices. Later accepted designs and PDR-15/PDR-16 answer scoped parts; they are not reopened here. Remaining work needs design before implementation. Where architecture changes, an ADR is required first (AR-29; PB-BASELINE §11.2 requires an ADR for licensing enforcement). Product constraints now decided in §§9–10/12/15 are mandatory:

1. Identity key: algorithm, generation, storage, rotation, and the relation to the existing installation identifier.
2. Signed file container, canonical form, signature scheme, and trusted-key distribution and retirement (also U-3, U-8).
3. Server-side representation of current and future LicenseVersions, and the atomic application algorithm (§8.6).
4. Replay protection: operation identifier namespace, persistence, and comparison semantics (§10.7–§10.9; U-4).
5. Device key model, device enrollment proof, and atomic device replacement (§7.7–§7.10).
6. Replacement-specific evidence/receipt format and validation (§5.5; OQ-82). Ordinary activation requires no signed receipt (PQ-9/OQ-84).
7. Revocation and reactivation file content and import rules (§10.4–§10.6).
8. Offline transfer packaging for files, USB, and text fallback (§7.12, §11.3).
9. Backup encryption design and key handling (U-2).
10. Clock monitoring: time source, persisted last-accepted time, detection and trusted-time revalidation/recovery (U-6); no arbitrary threshold, automatic unlock, or clearance of unrelated restrictions.
11. Audit persistence, permanent separate archive and sensitive-data controls (U-7); retention policy is decided by §12.8.
12. Owner-side permission matrix and authentication of Owner users (U-5).
13. Mapping to, and migration from, the implemented licensing schema (§19).
14. Module-level enforcement of restricted mode (§9.4).
15. GUI flows for conflict resolution, quota reduction, and replacement.
16. Verification strategy. Test or training environments are excluded (§17).

> **Dated note (2026-10-12), recording only — items 3 and 15 above are
> partially answered by [PDR-13](./PDR-13-post-gap-recovery.md) (decision
> **OD-LIC-02**, OQ-87 Option B) and its same-change L-04 implementation: the
> §8.6 atomic application algorithm now exists (usage-aware conflict check
> inside the import transaction under the allocation advisory locks, structured
> explain payload, dedicated audited `reduction-resolution` operation), and the
> documented API contract (OpenAPI) is the resolution surface — no GUI flow is
> implemented or claimed (item 15 stays deferred). This note changes no other
> item and no §1–§15 policy text.
>
> **Historical PDR-15 design cross-reference (2026-10-15; replacement workflow superseded 2026-10-16).** The original Product Owner decision **OD-LIC-04** recorded client-device policy and resolved quota/replacement questions as understood then. The customer-side technical design for device identity proof, signed replacement exchange, state transitions, authorization, persistence, and verification is maintained in [`docs/licensing/client-device-lifecycle.md`](../../licensing/client-device-lifecycle.md) as prior self-service implementation/design evidence. It does **not** establish the current manual Owner Admin replacement workflow or its implementation. Current replacement policy is PDR-15 §6; exact manual workflow/evidence remains open (OQ-83). This older cross-reference does **not** decide ordinary activation receipts (PQ-9/OQ-84), server replacement, revocation, Owner-side issuance, backup-key design, or any other open item.

## 17. Scope exclusions and implementation guardrails

### 17.1 Exclusions (Must)

- **No implementation** is authorized by this record. This includes licensing services, cryptographic utilities, endpoints, UI, device registration, activation, renewal, revocation, and replacement workflows.
- **No test, training, or sandbox environment entitlements.** The Product Owner has explicitly confirmed these are not in the current product scope. Revisit only after an explicit future product decision.
- **No pricing, billing, payments, or contract-termination policy.** Pricing belongs to the Owner's commercial process (PB-BASELINE §11.1).
- **No promise of instant remote revocation** for a disconnected server (§5.6, §10.4).
- **No requirement for permanent internet** for normal customer use (§11.1).
- **No absolute-protection claim** against a full local administrator (§1.5).
- **No second-person approval requirement** (§4.3).
- **No routine CMD or PowerShell** for licensing workflows (§1.4).
- **No hardware binding or fingerprinting decision.** The identity model in this record is key-based (§7.7). Existing records list hardware fingerprinting as deferred (`docs/licensing-architecture.md`). This record neither approves nor rejects it.

### 17.2 Guardrails for any future implementation (Must)

- **G-1 — No bypass.** A license is never a permission bypass. No administrator, developer, email, username, or environment (including `NODE_ENV`) bypass exists. A user permission never overrides a missing entitlement or capacity.
- **G-2 — Server authority.** Client and UI state is never authoritative. The customer server and the Owner system enforce the rules.
- **G-3 — Signing key custody.** The Owner signing private key is never present on a customer server, in a database, in a product endpoint, or in frontend configuration.
- **G-4 — No silent destruction.** No automatic deactivation, deletion, or data loss. Every capacity or entitlement consequence requires an explicit resolution.
- **G-5 — Attributable history.** Every state-changing licensing operation records its actor, time, and outcome, and is retained (§12.7).
- **G-6 — Idempotent and replay-safe.** Duplicate operations never change state twice (§10.8, §12.4).
- **G-7 — No automatic offline execution.** Owner-side changes never execute automatically on an offline server (§11.6).
- **G-8 — Text is transport.** A text code never substitutes for signature verification or operation binding (§7.12, §11.3).
- **G-9 — Restore not license-blocked; authority preserved.** OQ-53/§6.7 retain
  ordinary Restore exclusively on the approved authorized IT/server-administrator
  Runbook path, never normal ERP-user in-product Restore. PQ-3 is decided at the
  product-policy level: §10.3 requires independently authenticated, limited
  administrator recovery, not commercial access. Neither path is license-blocked;
  identity-key/backup-encryption, authentication/session and recovery design remain
  gated by OQ-53, U-2, OQ-78 and OQ-82. No recovery implementation is claimed.
- **G-10 — Design gate.** No implementation starts from this record alone. Technical design (§16) and the explicit Product Owner instruction come first.

## 18. Decision traceability table

Rows are traced by section, because no Owner decision IDs were assigned. **Historical status snapshot (2026-10-15):** implementation/status cells in this table preserve the earlier audit record; they are not claims of current-policy conformance or runtime verification. For current OQ-45/OQ-74–OQ-85 decisions and gaps, §21 is authoritative. "Implemented" in this historical table means only that the earlier audit recorded supporting repository/static-code evidence; it does not mean runtime-validated.

| # | Topic | Approved requirement (summary) | Canonical section | Related existing decision (verified) | Status |
|---|---|---|---|---|---|
| 1 | Three conceptual areas | Owner-side management, server license, client-device licensing | §2.2 | `docs/licensing-architecture.md` (model) | Approved · Owner-side not implemented |
| 2 | Entitlement vs permission | Entitlement is not permission; permission never bypasses entitlement or capacity | §2.3, §8.1, G-1 | ADR-0030 Decision 5 | Approved · partially implemented (L-01 filter) |
| 3 | Offline operation | Normal use requires no permanent internet | §11.1 | PB-BASELINE §10 (DECIDED); ADR-0036 Decision 4 | Approved · consistent with existing records |
| 4 | Graphical interface | Normal workflows usable in GUI; no routine CMD or PowerShell | §1.4 | None found | Approved · not implemented |
| 5 | Security objective | Practical protection only; no absolute protection claim | §1.5, §12.1 | PB-BASELINE R-02 (risk) | Approved |
| 6 | Perpetual license | No time expiry; no periodic renewal from elapsed time | §3.1 | ADR-0030 Decision 2 (null `validUntil` = perpetual) | Approved · partially implemented |
| 7 | Perpetual through key rotation | Ordinary rotation must not invalidate perpetual licenses | §3.1, §4.4 | ADR-0036 Consequences (rotation requires both keys listed) | Approved · alignment required (CF-8) |
| 8 | Signing-key emergency policy | Compromise response for licenses | §4.4, §15 U-1 | None | **OPEN** |
| 9 | Subscription dates | Explicit start and end dates set by Owner per version | §3.2 | ADR-0030 Decision 2 (`validFrom` inclusive, `validUntil` exclusive) | Approved · partially implemented |
| 10 | Renewal by signed file | Renewal is a new signed file imported on the server | §3.2, §5.2 | ADR-0036 Decision 6 (replacement by code) | Approved · **conflict** (CF-1, CF-3) |
| 11 | Future-dated renewal | Does not replace a still-valid current version; effective at its start date | §3.2, §3.4 | ADR-0036 Decision 6; `replaced_at IS NULL` partial unique index; not-yet-valid refused at activation | Approved · **conflict** (CF-1, CF-2) |
| 12 | Overlap or gap of versions | Resolution not stated | §3.4, §15 PQ-5 | None | **OPEN** |
| 13 | Reactivation does not extend expiry | Original dates kept | §3.2, §10.6 | None | Approved · not implemented |
| 14 | Commercial change vs replacement | Distinct concepts; separate records | §3.3, §5.4 | None | Approved |
| 15 | History retained | Versions, audit, and replaced records retained | §3.3, §12.7 | ADR-0036 Decision 6 (replaced rows kept) | Approved · partially implemented (no AuditEvent entity) |
| 16 | Owner-side capabilities | Customers, issuance, versions, entitlements, renewal, revocation, replacement, status, audit | §4.1 | `docs/licensing-architecture.md` (developer CLI only) | Approved · not implemented |
| 17 | Owner RBAC | Multiple users with RBAC | §4.2, §13 | ADR-0006; ADR-0016 (platform RBAC pattern) | Approved · role permissions OPEN (U-5) |
| 18 | Historical Owner role categories (superseded 2026-10-16) | Owner System Administrator, License Issuance Specialist, Read-only Observer, Support Specialist (limited); current MVP has Owner Admin and License Operator only | §13/PDR-17 | None | Historical categories; exact current permission mapping remains open (U-5/OQ-75) |
| 19 | No second-person approval | Not mandatory; RBAC and audit required | §4.3 | None | Approved |
| 20 | Signing key custody | Owner side only; authorized process only; never on customer servers | §4.4, §5.2, G-3 | ADR-0036 Decision 11 (no product key storage) | Approved · consistent with existing records |
| 21 | Owner status tracking | Manual; missing report does not restrict use | §4.5 | None | Approved · not implemented |
| 22 | Status corrections | Preserve previous value, new value, timestamp, actor, reason | §4.5, §12.7 | None | Approved · not implemented |
| 23 | Owner change not auto-executed | No automatic action on offline server | §4.5, §11.6, G-7 | ADR-0036 Decision 4 (no phone-home) | Approved · consistent with existing records |
| 24 | Identity generation | Automatic on first run; independent of activation | §5.1 | ADR-0036 Decision 1 (identity created on first need) | Approved · partially implemented |
| 25 | Identity key | Dedicated cryptographic identity key; private part stays on server | §5.1, §16 item 1 | ADR-0036 Decision 1 (identity without key material) | Approved · **extension required** (CF-6) |
| 26 | Signed license file | License delivered as a digitally signed file | §5.2, §11.3 | ADR-0036 Decision 4 (signed text code) | Approved · **conflict** (CF-3) |
| 27 | Verification | Server verifies with trusted public keys | §5.2, §11.2 | ADR-0036 Decision 4 | Approved · partially implemented |
| 28 | One active installation per license | Exactly one active installation per license | §5.3, §14 | ADR-0036 (one current license per installation) | Approved · partially reflected (per installation, not per license) |
| 29 | Replacement workflow | Tracked request, Owner-issued file, import, identity, activation, receipt, finalization, retained history | §5.5 steps 1–10 | None | Approved · not implemented |
| 30 | Replacement does not revoke immediately | Issuing a file does not revoke the old installation | §5.5 step 3 | None | Approved |
| 31 | One pending request | At most one valid pending request | §5.5 step 11 | None | Approved · state machine OPEN (U-4) |
| 32 | Cancellation | Owner may cancel and reissue; canceled request not accepted | §5.5 steps 12–13 | None | Approved · recovery detail OPEN (U-9) |
| 33 | No strand on failure | Customer not unnecessarily locked out if activation fails | §5.5 step 14, §7.10 | None | Approved · protocol OPEN (U-9) |
| 34 | Isolated server continuity | Cached state until signed update or revocation; no instant remote revocation | §5.6 | ADR-0036 Consequences (revocation not implemented) | Approved · extension of existing position |
| 35 | Identity key in backup | Included in full backup, encrypted | §6.1 | `docs/operations/backup-and-restore.md` (backup not implemented) | Approved · design item (U-2) |
| 36 | No key escrow | No recoverable mechanism or Owner escrow approved | §6.2, G-9 | None | Approved |
| 37 | Encrypted is not recoverable | Loss of decryption capability is loss of recovery | §6.3 | None | Approved |
| 38 | Lost key → replacement | Lost identity key goes through replacement | §6.4 | None | Approved |
| 39 | DB restore is not identity | DB restore without key is insufficient; Owner support; no silent identity creation or impersonation | §6.5 | ADR-0036 Consequences ("restoring a backup restores the identity and its license") | Approved · **conflict** (CF-5) |
| 40 | Backup and export distinct | Business Export (Excel) ≠ Disaster/Technical Backup | §6.7 | OQ-46; `docs/operations/backup-and-restore.md` §1 | Approved · existing decision (consistent) |
| 41 | Restore authority | Admin-only via Runbook; never in-product for normal users | §6.7 | OQ-53 (Owner decision 2026-10-05) | Approved · existing decision (consistent) |
| 42 | Restore not license-blocked | Restore never blocked by license state | §6.7, G-9 | OQ-53; `docs/operations/backup-and-restore.md` §3 | Approved · **conflict with §10** (CF-10, PQ-3) |
| 43 | Device counting | Registered devices, not sessions or accounts | §7.1 | None (OQ-44 concerns offline sync, not device quota) | Approved · not implemented |
| 44 | Device quota consumption | Consumes quota until deactivated or replaced; replacement is a quota-neutral one-for-one exchange. Current replacement is manually Owner Admin-managed; old device remains active until new activation, then swap atomically. | §7.2/PDR-15 §6 | PDR-15 / OD-LIC-04 | Policy decided 2026-10-16; implementation reconciliation/evidence open (OQ-83) |
| 45 | Historical customer device GUI | Former customer GUI included device/activation/deactivation/replacement controls; replacement UI is superseded for MVP by manual Owner Admin workflow | §7.3/PDR-15 §6 | Historical requirement/status only; regular enrollment not re-decided; current replacement implementation not evidenced |
| 46 | General direct device activation | No separate device-activation approval stage in the earlier general enrollment policy | §7.4 | PDR-15 / OD-LIC-04 | Regular enrollment not re-decided by PDR-15 §6; no new replacement workflow inferred |
| 47 | Deactivation vs replacement | Distinct operations; history retained; no deletion | §7.5, §7.6 | PDR-15 / OD-LIC-04 | Policy constraints retained; current implementation status not verified here |
| 48 | Device identity | Not IP or machine name alone; per-device key; private key stays client-side | §7.7 | PDR-15 / OD-LIC-04 | Policy retained; this historical status is not proof of implementation or current-flow conformance |
| 49 | Reinstallation | A recovery/replacement path is required; current MVP device replacement is manually Owner Admin-managed under PDR-15 §6 | §7.8/PDR-15 §6 | PDR-15 / OD-LIC-04 | Policy decided; exact workflow/evidence and implementation remain open (OQ-83) |
| 50 | Historical customer self-service replacement without old device | Former flow allowed replacement without the old device/key; not separately approved as a current manual Owner Admin workflow | §7.9/PDR-15 §6 | Historical rule superseded for MVP; exact current workflow remains open |
| 51 | Device replacement safety | Controlled, auditable, atomic, no partial swap; old device stays active until replacement activation | §7.10/PDR-15 §6 | Policy decided; manual Owner Admin evidence/workflow and implementation remain open (OQ-83) |
| 52 | Historical offline self-service device replacement | Former customer-driven flow awaited a correlated trusted signed response; superseded for MVP by manual Owner Admin replacement | §7.11/PDR-15 §6 | Historical design only; current Owner Admin workflow/evidence/implementation remain open (OQ-83); OQ-84 remains separate |
| 53 | General device activation paths | Local server; Vardena-generated code; offline file or USB transfer (former replacement-specific signed response is not current MVP policy) | §7.12, §11.4 | ADR-0036 (license code activation only); PDR-15 / OD-LIC-04 | General enrollment not re-decided; manual Owner Admin replacement policy decided, implementation/evidence open (OQ-83); Owner issuer out of scope |
| 54 | Historical offline file-transfer design | Former device flow treated signed files as primary and text as transport fallback; no new replacement artifact/protocol is authorized by PDR-15 §6 | §7.12, §11.3, G-8 | Existing protocol/vector material is preserved; replacement workflow remains open and no protocol change is made here |
| 55 | Device quota reduction | Explicitly select excess devices; block new registration until resolved; never auto-deactivate/delete | §7.13, §8.5 | PDR-15 / OD-LIC-04 | Existing policy constraints remain; implementation status not verified in this documentation audit |
| 56 | User capacity at limit | Existing users continue; new users blocked; no silent increase | §8.3 | ADR-0030 Decision 3; `docs/licensing-architecture.md` (advisory-locked limit) | Approved · partially implemented |
| 57 | User capacity reduced | Admin manually deactivates excess users; no deletion | §8.4 | `docs/licensing-architecture.md` (active-user limit) | Approved · reduction flow not implemented |
| 58 | Module entitlement removed | Use stops; data kept; backup and export remain; no destructive correction | §8.2 | ADR-0030 Decision 5 (grants stored but ineffective) | Approved · partially implemented (export exception not implemented) |
| 59 | Downgrade application | Conflict check, explanation, preservation, explicit resolution, no destruction | §8.6 | None | Approved · algorithm is design item (§16) |
| 60 | Expiry → restricted mode | Restricted mode; allowed and stopped operations defined | §9.1–§9.3 | OQ-45; `docs/frontend/ux/document-editing-and-system-alerts.md` §4 | Approved · **conflict** (CF-9) |
| 61 | Grace before restricted mode | Not stated in the brief | §9.5, §15 PQ-1 | OQ-45 | **Historical baseline conflict (2026-10-11); superseded by §9/§21 and the OQ-45 record.** |
| 62 | Restricted-mode module detail | Beyond baseline; must not weaken baseline | §9.4 | OQ-45 (Read-Only) | Design item · PQ-2 OPEN |
| 63 | Full revocation | Stops application, including System Administrator login | §10.1 | ADR-0030 and ADR-0036 Decision 12 (licensing never ends a session) | Approved · **conflict** (CF-4) |
| 64 | No deletion on revocation | Customer data not deleted automatically | §10.2 | PB-BASELINE §12 (no deletion at contract end) | Approved · consistent |
| 65 | Recovery from revocation | External recovery process | §10.3 | OQ-53 | Approved · process OPEN (PQ-3) |
| 66 | Offline revocation | Effective only after signed file import | §10.4, §11.7 | ADR-0036 Consequences | Approved · extension (not implemented) |
| 67 | Revocation binding | Bound to license and operation | §10.5 | None | Approved |
| 68 | Reactivation | Reverses revocation; history kept; previous status restored; dates unchanged; expired not renewed; signed file import; offline stays previous until import | §10.6 | None | Approved · not implemented |
| 69 | Operation identity | Unique ID and authenticity checks | §10.7, §12.4 | ADR-0036 Decision 6 (idempotency for codes only) | Approved · partially implemented (activation only) |
| 70 | Duplicate operations | Reject with clear message; no second state change | §10.8, G-6 | ADR-0036 Decision 6 (idempotent no-op for activation) | Approved · **differs** (CF-12, PQ-8) |
| 71 | No false duplicates | New valid operations not rejected for resembling old ones | §10.9 | None | Approved |
| 72 | Clock rollback detection | **Historical wording superseded by current §12.6 (2026-10-16):** earlier row said admin clears after correction; current policy requires reliable meaningful-rollback evidence and a controlled, attributable, audited rollback-only unlock after validation | §12.6 | None | Historical entry; current policy in §12.6/§21 |
| 73 | Audit history scope | Listed events retained | §12.7 | None | Approved · schema OPEN (U-7) |
| 74 | Non-destructive principle | No destruction as a side effect of licensing | §12.9, G-4 | PB-BASELINE §12 | Approved |
| 75 | Conceptual entities | Customer/Contract, License, LicenseVersion, ServerInstallation, ReplacementRecord, ClientDevice, AuditEvent | §14 | `licensing.*` tables (naming only) | Approved (conceptual) · **naming conflict** (CF-17) |
| 76 | Owner-side system ownership | Location and ownership of the Owner system | §15 PQ-7 | OQ-61 (Open); ADR-0030 (CRM deferred) | **OPEN** |
| 77 | Suspended vs revoked | Mapping of `SUSPENDED` | §3.5, §15 PQ-4 | ADR-0030 Decision 2; ADR-0036 | **OPEN** |
| 78 | Test and training environments | Excluded from current scope | §17.1 | None (brief) | Approved exclusion |
| 79 | Implementation gate | No implementation without design and explicit PO instruction | §17.2 G-10 | AG-15; AR-29 (ADR before architecture change) | Approved |
| 80 | Licensing within V1 | Licensing must be usable (not merely present) in the V1 product | §1.2, §17.1 | PDR-06 OD-V1-02 | Recorded existing decision · consistent |

## 19. Relationship to existing repository records and conflicts

**19.1 Method.** No existing record was overwritten or deleted. Accepted ADRs were not changed in their decision text. The only edits to existing records are status annotations or cross-references (listed in §19.3). Each conflict below is recorded for the Product Owner and, where architecture is affected, for the ADR process (AR-29). The conflicts are **not** resolved by this record.

**19.2 Conflicts and differences.**

| ID | Existing record | Difference from this record | Handling |
|---|---|---|---|
| CF-1 | ADR-0036 Decision 6; `licensing.licenses` partial unique index on `replaced_at IS NULL` | ADR-0036 replaces the current license immediately when a different valid code is activated. This record (§3.2) requires a future-dated renewal to coexist with a still-valid current version. | **Conflict.** New ADR and design required. ADR-0036 unchanged. |
| CF-2 | ADR-0036 Decision 7 (step 5); `docs/licensing-architecture.md` (activation); `license-activation.service.ts` | A not-yet-valid license is refused at activation. This record requires importing a future-dated renewal so it can take effect at its start date. | **Conflict.** Same handling as CF-1. |
| CF-3 | ADR-0036 Decision 4 (`VLIC1` text code as the delivery form) | This record (§5.2, §7.12, §11.3) makes the **signed file** the primary delivery and treats text as a fallback. The current code is itself signed, so the difference is delivery form, not signature. | **Conflict** on delivery form. Owner decision and ADR. |
| CF-4 | ADR-0030 (*Licensing versus authentication*); ADR-0036 Decision 12; `docs/security.md` (licensing is an independent state machine); frontend UX §4 (Read-Only never logs the user out) | Full revocation stops System Administrator login (§10.1). Those records say license state never ends a session. Expiry is consistent (§9.2). PQ-3 also asks how a reactivation file is imported if login is blocked. | **Conflict** with stated principles. Owner decision and ADR. Records unchanged except annotation. |
| CF-5 | ADR-0036 Decision 1 and Consequences | ADR-0036 says a reinstall onto the same database keeps the identity, and that restoring a backup restores the identity and its license. This record says a database restore without the identity key is insufficient (§6.5), and a reinstallation is a replacement (§5.5, §7.8 for devices). | **Conflict.** Must be decided before identity design. |
| CF-6 | ADR-0036 Decision 1 (ULID identity, no key) | This record requires a dedicated cryptographic identity key (§5.1). | **Extension required** via ADR. Not a contradiction of the existing decision text. |
| CF-7 | ADR-0036 Consequences ("Revocation is not implemented") | This record approves signed offline revocation and reactivation (§10). | **Extension required**; consistent with the existing "not implemented" statement. |
| CF-8 | ADR-0036 Consequences (rotation possible only while old and new public keys are both listed) | This record requires ordinary rotation not to invalidate perpetual licenses (§3.1). That holds only if old keys remain trusted. Retirement policy is a design item. | **Alignment required** in design (U-1, U-3). |
| CF-9 | Historical OQ-45 wording (Owner decision 2026-10-05: Grace → Read-Only; durations OPEN); `docs/frontend/ux/document-editing-and-system-alerts.md` §4 | **Historical conflict description (2026-10-11).** Current policy and deadline are recorded in §9/§21 and the OQ-45 decision record; only termination strictness and implementation remain open. |
| CF-10 | OQ-53 and `docs/operations/backup-and-restore.md` §3 (restore never blocked by license state) | §10.1 full revocation stops the application; §10.3 says recovery requires an external process. | **Open** (PQ-3). Restore rule stays as recorded until the Owner decides. |
| CF-11 | ADR-0030 `SUSPENDED` lifecycle value, implemented and refused at activation | Approved concepts are *revoked* and *restricted mode* (§3.5). Their mapping to `SUSPENDED` is undefined. | **Open** (PQ-4). |
| CF-12 | ADR-0036 Decision 6 (re-activating the same code is an idempotent no-op with `changed: false`) | This record (§10.8) requires rejection with a clear message for a duplicate reactivation. | **Differs** by operation type. Owner decision (PQ-8). |
| CF-13 | `docs/adr/README.md` index | ADR-0030 is listed as *Proposed*. The ADR file says *Accepted for L-01; extended by ADR-0036*. | **Pre-existing status inconsistency.** Not changed here; flagged for the ADR process. |
| CF-14 | Two files numbered ADR-0036: `0036-installation-identity-and-license-activation.md` (licensing) and `0036-legal-reporting-architecture.md` (accounting) | Only the legal-reporting ADR-0036 is in the ADR index. The licensing ADR is referenced by number from ADR-0030, `docs/licensing-architecture.md`, and this record. | **Pre-existing numbering collision.** Not renumbered: renumbering would rewrite historical references. Flagged for the ADR process. |
| CF-15 | `docs/decisions/product/README.md` index | The index has no row for PDR-10, which exists as a file. | **Pre-existing index gap** unrelated to licensing. Not changed here; flagged. |
| CF-16 | `docs/current-state-reconciliation.md` (licensing rows state "No license schema/module/enforcement") | Stale relative to the implemented L-01/L-02 foundation. | **Pre-existing staleness.** Not changed here; flagged. |
| CF-17 | `licensing.*` schema (`customers`, `installations`, `licenses`, `license_entitlements`) | Schema names differ from the conceptual entities (§14). | **Naming only.** Not a design commitment. Mapping is a design item (§16 item 13). |
| CF-18 | `.vardena/agent-rules.md` AG-09 and AG-07; `docs/open-questions.md` | Those rules require unresolved business rules to be registered as OQ entries. The brief forbids inventing OQ identifiers. | **Process conflict.** Unresolved items are preserved in §15 without new IDs. The Owner decides whether and when to register them. |
| CF-19 | Owner-side system and CRM: `docs/licensing-architecture.md` and ADR-0030 (commercial provider deferred); OQ-61 (Open); PB-BASELINE CRM scope (licenses, contracts, renewals) | Owner-side requirements in §4 presuppose a home for customers, contracts, and licenses. Existing records do not decide that home. | **Open** (PQ-7). |
| CF-20 | `docs/licensing-architecture.md` ("signed offline files ... DEFERRED") | This record approves signed offline exchange as a requirement (§11). It is not yet implemented. | **Status difference**, annotated in that document. |
| CF-21 | `backend/src/modules/licensing/application/license-activation.service.ts` comments | Comments mention a `revoked` lifecycle. The implemented status type is `ACTIVE`, `EXPIRED`, `SUSPENDED` only. | **Observation.** Code not changed (documentation-only task). Flagged for the implementation phase. |
| CF-22 | Branch rule AG-02 (`docs/<slug>` branch names) | The session branch is fixed to `arena/ecdc91f5-vardena`. | **Process note.** The documentation work is on the session branch, as the session rules require. |

**19.3 Records changed in the same pull request.** Status annotations and cross-references only: this record; `docs/decisions/product/README.md`; `README.md`; `docs/licensing-architecture.md`; ADR-0030 and ADR-0036 (licensing) status notes; OQ-45 and OQ-53 cross-references; `docs/open-questions.md` reconciliation log; `docs/modules.md` licensing pointer; `STATE.md`. No decision text was rewritten.

### 19.4 Post-PR #136 reconciliation addendum (2026-10-11)

Recorded after the Product Owner's follow-up instruction (resolve §19, reconcile
records, design, and implement the first slice). **No decision text in §1–§18 and
no row of §19.2 was rewritten**; this addendum records what the follow-through
did. The authoritative per-item matrix is
`docs/tasks/pdr-11-conflict-reconciliation.md`.

- **Settled by design and implemented (first slice):** CF-1, CF-2 (future-dated
  documents are retained and take effect by date), CF-3 and CF-20 (signed files
  are the primary transport; text is the same signed artifact; the owning
  document no longer describes this as deferred), CF-8 for ordinary rotation
  (verification happens at import only), CF-17 (conceptual-to-typed mapping).
- **Settled as documentation/governance:** CF-13 (ADR-0030 index status
  corrected), CF-14 (the licensing ADR-0036 is renumbered to **ADR-0045**; the
  former path keeps a pointer; historical records are not rewritten), CF-15
  (PDR-10 index row added), CF-16 (current-state addendum), CF-18 (open items
  registered), CF-21 (stale lifecycle comments removed), CF-22 (session-branch
  process note).
- **Advanced but not finished:** CF-5 (import can never create or adopt an
  installation identity — tested; restore semantics documented), CF-6 (id and
  identity key are separated by design; the key is **not implemented**, blocked
  by U-2 and U-9/PQ-3), CF-7 (the import pipeline revocation will reuse exists;
  revocation itself is not implemented), CF-12 (duplicate semantics are defined
  per operation type; the policy scope is open), CF-19 (issuance boundary fixed;
  where the Owner-side system lives is open).
- **Preserved as OPEN, now registered:** CF-4 and §10 recovery (OQ-78), CF-10
  (unchanged: restore is not blocked by license state; revocation recovery is
  OQ-78), CF-9 (OQ-45 unchanged), CF-11 (OQ-79; audit performed — no write path
  can persist a non-`ACTIVE` status, so no lossy migration is needed or done).
- **§15 registration:** U-1→OQ-74, U-5→OQ-75, U-6→OQ-76, U-7→OQ-77,
  PQ-3→OQ-78, PQ-4→OQ-79, PQ-5→OQ-80, PQ-8→OQ-81, U-9→OQ-82 (server replacement)
  and OQ-83 (device), PQ-6→OQ-83, PQ-9→OQ-84, PQ-7→OQ-85 (cross-referencing
  OQ-61). U-2 stays a technical design item; U-3, U-4 and U-8 are answered for
  the import path by ADR-0046 and `docs/licensing/version-model-and-file-exchange.md`.
  PQ-1 and PQ-2 stay with **OQ-45**.
- **Interim behaviours added by the design are technical, fail-closed choices,
  not product decisions:** overlap is rejected unless the signed document
  explicitly supersedes a named operation (OQ-80); duplicate handling differs by
  operation type (OQ-81); gaps are allowed and reported as expired. Each is
  documented in ADR-0046 and can be replaced by an Owner decision without a
  data migration.
- **Registered later (2026-10-11, Product-Owner temporal directive):
  OQ-86.** §3.2 settles only the future-dated renewal, and §3.4 hands
  overlapping or gapped versions to PQ-5 (OQ-80); neither says whether a
  *backdated* document may retire a version from an instant already in the past
  and so rewrite which version governed then. The interim behaviour is
  fail-closed: such an import is refused (`backdated-supersession`, 422, nothing
  written) while a hand-over at or after the import instant, the correction of a
  version that had already ended, and documents that retire nothing keep their
  documented behaviour. The rule is a domain rule, not a database constraint —
  no migration is needed to lift or narrow it. §15 is unchanged: no item was
  converted into a decision, and **PQ-5/OQ-80 stays Open**.
- **Post-merge verification addendum (2026-10-11).** PR #137 is **merged** to `main` at `345047a` (CI on the merge commit: success). It is **not Owner-accepted**. Verification found two defects against §2.1 — a license re-bound to another customer was applied, and a foreign `licenseId` surfaced as an unmapped error. Both are refused by one retained-state refusal, `license-binding-conflict` (409, nothing written). **Proposed for Product Owner ratification:** the reason name and its HTTP class are an implementation interpretation of ADR-0046's conflict class, not text in §1–§18. Gap C (a non-superseding backdated overlap) is recorded under OQ-86 and is **not** changed. The OQ-80/OQ-86 decision brief is `docs/tasks/licensing-oq-80-oq-86-decision-brief.md`. §15 is unchanged; PQ-5/OQ-80 and OQ-86 stay OPEN. **Merge-state note (2026-10-12, records only — no policy change):** those two refusals are not on `main` at `345047a`; they reached `main` through PR #138, merge commit `d283744b4098346b6ef2e0b91922266f10cdabd1` (merge-commit CI green, run `38210710188`), which also added the race-safe identifier claim and the `LicenseImportResultDto` import-response schema. PR #138 is **merged, not Owner-accepted**. Still awaiting the Owner and unchanged by that merge: ratification of the `license-binding-conflict` name and its 409 class, Q3 (renewal identity), Q4 (installation customer change), and the open follow-ups F-6 (`GET /license/current` and `POST /license/activate` have no OpenAPI response schema) and F-7 (no CI drift check for the generated client). Verification record: `docs/tasks/licensing-pr-138-post-merge-verification-and-l-04-readiness.md`.
- **Unchanged product policy:** no Grace/Read-Only enforcement, no revocation, no
  installation identity key, no replacement workflow, no device licensing, no
  Owner-side system, no test/training entitlements, no CRM/billing.

---

**Owner decisions addendum (2026-10-12, documentation only — §1–§18 untouched).** The Product Owner decided the licensing questions this PDR deferred: **OQ-80** overlap = **Option B** (the later starting version governs in the overlap) and gap = **G2** (a renewal that would leave a gap is refused); **OQ-86** = **Option C** (the candidate is checked against the full retained effective history, retired windows included); the legacy `VLIC1` restriction is preserved; import tolerance stays strict; as-of reads stay a recomputation from the retained records; **Q3** renewal identity is the same `licenseId`; **Q4** an installation's commercial customer may change only through an explicit, authorized, audited operation; and the reason `license-binding-conflict` (409, nothing written) is ratified. §8.6 is **not** overridden by the precedence rule — a reducing or changed version still requires the check/explain/preserve/explicit-resolution flow, which is the L-04 slice, and every path that retires a version fails closed (`reduction-requires-resolution`) until it exists: the guard covers the explicit signed supersession (review fix on PR #141, 2026-10-12), the implicit hand-over and the legacy `VLIC1` replacement, because a signed document cannot resolve a capacity or entitlement conflict it cannot even observe. The decisions are recorded verbatim, with consequences and the blocked follow-on (OQ-87: may a new license identity cover a lapse?), in `docs/tasks/licensing-oq-80-oq-86-decision-brief.md` §7/§8; registry rows in `docs/open-questions.md`. OQ-80/OQ-86 are recorded as decided with implementation recorded in the same change; **CI update (2026-10-12): the branch's verified head `68d50517c2d2888f38f10ca1a615f05ce19b7fe0` (run `38239438399`, `completed / success`) carries that implementation, its tests and these records — so only Product Owner acceptance remains outstanding.** **License-term addendum (2026-10-12, documentation only — §1–§18 untouched).** The Product Owner then made the final decision on the term question those decisions left open: an **explicit, valid, signed supersession may replace a perpetual grant (`validUntil = null`) with a time-limited one**, and that is the *only* change it authorizes (§3.1 term change), subject to strict non-reduction of `organizationLimit`, `userLimit` and the granted entitlements (§8.2/§8.4/§8.6); implicit precedence and the legacy `VLIC1` transport keep the stricter guard and gain no bypass, and naming a version never unlocks a capacity or entitlement reduction. Recorded as **PDR-12** (decision id **OD-LIC-01**) in [`docs/decisions/product/PDR-12-license-term-supersession.md`](PDR-12-license-term-supersession.md), implemented in PR #141. **L-04 remains outstanding** (§8.6's check/explain/preserve/explicit-resolution flow against current usage is not implemented by it) and **OQ-87 stays OPEN**.

**Q3 supersession addendum (2026-10-13, documentation only — §1–§18 untouched).**
The Product Owner removed one requirement from the 2026-10-12 decision set
recorded above: **preserving the previous `licenseId` during renewal is not a
product requirement.** A newly issued license must remain bound to the same
intended customer and the same customer code, and a changed `licenseId` must not
bypass customer binding, installation binding, retained history, version
precedence, capacity/entitlement reduction controls, replay protection, or audit
requirements. `--license-id` must **not** be implemented merely to force reuse of
the old identifier, so the tooling follow-up the addendum above left open is
withdrawn. **§8.6 is unchanged and its trigger is unconditional** ("before
applying a LicenseVersion that reduces entitlements or capacity"): a reducing or
changed version still requires the check/explain/preserve/explicit-resolution
flow. The audit of the merged tree establishes that **F-8 is not fully
satisfied** and records the two exact gaps with their corrective tasks in
[`docs/tasks/licensing-po-acceptance-audit-2026-10-13.md`](../../tasks/licensing-po-acceptance-audit-2026-10-13.md):
(a) a successor that **retires nothing** (a contiguous renewal), for both a
retained and a new identifier, is not evaluated by that flow — **L-05**, a
requirement defect that keeps PR #142 at `HOLD` until it is implemented and
verified; narrowing §8.6 is not an accepted alternative; and (b) the **same
customer code** the decision requires is not representable, signed or validated
anywhere in the current model, document or API — **L-06**, whose representation
is an Owner decision item. The superseding record for Q3 itself is the decision
brief §8.3.1; the earlier text stays as the record of what was decided on
2026-10-12. Separately, the **F-12** requirement the records carried as an open
remediation path is now decided — the initial password remains exactly `1`, and a
forced first-login password change enforced in the backend and the frontend is
**outstanding implementation**, with its acceptance tests in the same audit §5.

*End of PDR-11. This record is an approved product-requirements reference, not an implementation specification. It does not itself authorize implementation work. The historical OQ-83 implementation addendum below is superseded for replacement workflow by the 2026-10-16 PDR-15 §6 policy.*

**Historical OQ-83 implementation addendum (2026-10-15; superseded in replacement scope on 2026-10-16).** At that time, the Product Owner's device decision was recorded in [PDR-15](./PDR-15-client-device-licensing-and-replacement.md), and the registry row remained OPEN during implementation/review. The addendum described customer-side enrollment, quota, lifecycle, explicit deactivation, signed offline replacement, authorization, REST/OpenAPI/client/UI, migration and tests. It is retained as historical scope only: it does not authorize the former customer self-service replacement workflow as current MVP policy and is not evidence that any new manual Owner Admin workflow is implemented. OQ-84, OQ-78, OQ-82 and OQ-85 remain separate; ordinary activation receipts, server replacement, revocation/recovery, Owner-side issuance and offline operation of Vardena are not authorized by this historical note.

## 20. Licensing product reconciliation — 2026-10-15 (documentation only)

**Authority:** Product Owner Ali Esmaeili's explicit instructions for this
reconciliation, decisions A–L and global Persian/Jalali policy. No historical
"Option C" meaning is inferred. **Final recording baseline:** fetched
`origin/main` at `636c19b0a137dc2b602fb1be1861fafaeecb7332`. Initial pre-edit
inspection used `70aad01d8878290f7b61c81efe460b15850798aa` with a clean matching
session branch. A final fetch found PR #163 merged; its session-error fix and
implementation record were inspected, with no change to any required PDR/ADR,
registry or licensing policy. The same session branch was fast-forwarded to the
new baseline before committing these documentation-only changes; the conflict
assessment remains unchanged. No new PDR/ADR/decision identifier is allocated:
existing sections and registry identifiers suffice under the product conventions.

### 20.1 Pre-edit assessment and preserved decisions

The required source audit read PDR-11/15/16/17, ADR-0046/0048, the live OQ
registry, OQ-45, ADR-0042/0044, `docs/datetime.md`, licensing design and actual
state consumers. OQ-45/74/76/77/78/79/81/84 were not renamed or superseded by a
new OQ identifier. Their product choices were unresolved or only partially
recorded; OQ-82/83 already had approved policy with remaining technical work.

The explicit new instructions resolve earlier contradictory wording, rather
than asserting historical approval: §9's immediate restricted mode/unspecified
Grace; §10's blanket administrator-login block/external-only recovery; §10.8's
duplicate rejection; §12.6's administrator-only clearance; and §12.8/PDR-17's
unresolved retention. CF-9/CF-10/CF-12 are resolved **at product level**; CF-4's
session/authentication architecture remains to be designed, and CF-11's enum/data
compatibility requires §20.3. No additional conflicting approved product choice
was found that needs reinterpretation to record these instructions.

Preserved without reopening:

- OQ-80/OQ-86 overlap, gap, strict import and retained-history/as-of rules;
  PDR-12's term supersession constraints; PDR-13's dedicated, authorized,
  reasoned, audited post-gap recovery (OQ-87). Emergency recovery is **not**
  post-gap recovery and ordinary renewal is neither bypass.
- The later Q3 clarification does not require reuse of `licenseId`; customer
  identity/code, installation binding, retained history, reduction controls and
  explicit audited transfer remain unchanged (PDR-14 and the Q3 addendum).
- PDR-15 device-key identity, quota unit, quota-neutral one-for-one atomic
  replacement, pending/cancelled-request and reduction safety. No new device or
  replacement state/protocol is approved by this PR.
- PDR-16 canonical bytes, omission semantics and VECTORS_ONLY conformance;
  existing signed formats/signatures are untouched.
- Manual Owner approval for **every** new customer-server installation or
  replacement, installation/customer binding, actor/reason/history, old-server
  loss handling and failure-recovery requirements; no unrestricted transfer.
  PDR-17 observations remain manual, not signed deactivation or replacement proof.
- **Historical Owner-role policy (2026-10-15; superseded by §21/PDR-17):** the
  then-current four categories were Administrator, Issuance Specialist, Observer
  and Support; no mandatory second approver was required. The current MVP has
  exactly Owner Admin and License Operator. Exact grants remain an implementation
  gap; no signing or unrestricted recovery permission is inferred. Owner/customer
  separation and backup/restore boundaries remain (ADR-0048, OQ-53).

### 20.2 Current product dispositions (not implementation completion)

| Prompt decision | Existing identifier | Authoritative location / disposition |
|---|---|---|
| A–B | OQ-45; PQ-1/PQ-2 | **Historical 2026-10-15 disposition; superseded by §21:** natural-expiry policy and UTC boundary are decided. The separate termination-trigger/strictness question remains open; enforcement/verification remain follow-up. |
| C–E | OQ-78; PQ-3; CF-4/CF-10 | §§10.1–10.6, 10.10: product behavior decided; OQ-78 stays OPEN only for security/session/recovery protocol design and implementation. |
| F | OQ-76; U-6 | §12.6: product response decided; row stays OPEN for time-integrity mechanism/recovery and tests. |
| G | OQ-77; U-7 | §12.8/PDR-17: permanent separate archive/access policy decided; row stays OPEN for schema, minimization, archive design and implementation evidence. |
| H | OQ-81; PQ-8; CF-12 | §10.8: product behavior decided; row stays OPEN for identity/content/result persistence, secure retrieval and conflict protocol. |
| I | OQ-74; U-1 | §4.4 and §20.4: non-automatic-invalidation policy approved; row stays OPEN for compatible incident-response/key lifecycle design and security consequences. |
| J | OQ-82; U-9 | **Historical as of 2026-10-15; superseded by §21/PDR-17:** manual approval remains; the 2026-10-16 Owner decision fixes new-server activation before manual old-server decommission and requires auditable confirmation within the configured expiry window. Failure/cancellation, evidence and implementation details remain open; no remote revocation is implied. |
| K | OQ-84; PQ-9 | **Decided**, product question closed: no ordinary activation signed receipt; manual attributable history sufficient for approved scope. OQ-83 operation-specific evidence and OQ-82 design untouched. |
| L | OQ-79; PQ-4; CF-11 | §3.5 and §20.3: concept removed; row stays OPEN for compatibility/data audit and staged technical removal/mapping. |
| Global dates | Date/time digit scope decided 2026-10-16; broader OQ-02 OPEN | `docs/datetime.md` §0 and ADR-0044: global Jalali-first and PO-approved Persian date/time digits; canonical/API ASCII retained. Broader number/text localization is not inferred. |

OQ-45 retains its distinct contract-termination trigger/strictness question: the
instructions define expiry and authorized emergency stops, not a stricter policy
triggered by termination alone. Do not infer that missing policy.
OQ-75 (broader Owner operation authority/acceptance), OQ-83 (implementation review
and operational dependencies), OQ-85 (broader operational acceptance/ownership)
and OQ-61 remain open; approved subsets are not reopened. OQ-14/OQ-19 account
and lockout policies, OQ-43 statutory document retention, OQ-46 export scope,
OQ-52 RPO/RTO and OQ-53 remaining recovery details are not decided here. Permanent
licensing audit retention does not silently settle statutory business-document
retention. Older historical status notes in this PDR/registry remain dated evidence.

### 20.3 `SUSPENDED`: safe compatibility/removal plan (engineering follow-up)

Baseline consumers include `backend/prisma/schema/licensing.prisma`, the applied
foundation/version-model SQL migrations, `domain/license.ts`,
`domain/license-code.ts`, `domain/license-document.ts`, `api/dto/license.dto.ts`
under `backend/src/modules/licensing/`, frontend manual/generated API contracts,
fixtures and the populated licensing migration rehearsal. The old registry audit
reported no normal write path for non-ACTIVE licenses, **not proof that every
installed database lacks historical SUSPENDED rows**; the rehearsal explicitly
includes one. The domain evaluator currently exposes only generic `status` for
non-ACTIVE state. It cannot safely infer the original restriction reason.

Required staged design before implementation:

1. Inventory runtime/API/worker/UI consumers and aggregate-audit actual target
   rows and retained artifacts, including historical/migrated values and reasons.
2. Stop treating SUSPENDED as a product concept; show the actual approved
   condition and explicit context. Define a mapping only from attributable
   evidence. Do **not** automatically map historical rows to CANCELLED, ACTIVE,
   EXPIRED, REVOKED, or any other status. Unexplained legacy restrictions remain
   restricted and reviewable; preserve their original value/history pending
   authorized reconciliation.
3. Keep compatibility readers/wire values as necessary during a coordinated
   rollout; signed parsers must still verify historical bytes. Never rewrite a
   signed payload/hash or edit an applied migration to remove the value.
4. Propose additive migration/API compatibility and rollback/recovery sequencing,
   rehearse populated data and verify clients before later removing a storage/API
   enum value. No replacement ambiguous state is authorized. Exact projection,
   constraints and transition implementation require engineering review/ADR as
   appropriate, not an invented enum change in this documentation PR.

### 20.4 Signing-key compromise: consequences and unresolved security design

ADR-0046 Decision 7 verifies at import; retained versions are not re-verified
against the current trust list. This supports continued local use of already
accepted licenses but **does not protect new imports** signed with a compromised
trusted key. Cryptographic verification alone cannot distinguish a legitimate
previously issued file from an attacker-created file using that same key.
An offline installation also cannot learn an incident/trust update instantly.

Engineering must specify containment of new issuance, replacement-key trust
rollout, treatment of compromised keys for future verification versus continued
use of existing licenses, provenance of issued-but-not-yet-imported artifacts,
and authorized offline controlled recovery, without changing existing signed
bytes or automatically invalidating existing licenses solely due to compromise.
Custody, trust-update authorization and revocation boundaries remain unresolved;
this PR supplies no production signer, keys or safe-design claim. If engineering
finds the approved policy cannot be met safely without a business trade-off,
report the exact incompatibility to the Product Owner and stop that design;
do not substitute blanket license invalidation or trust every future signature.

### 20.5 Evidence-backed implementation gaps (not implemented here)

| Baseline evidence | Required separate follow-up |
|---|---|
| `domain/license.ts` evaluates expiry directly; `application/licensing.service.ts` filters all non-platform permissions when inactive. No Grace/Read-Only operation classification. | Implement the decided UTC boundary (signed expiry + 14×24h; `now >= boundary`), preserve authorized read/print/Excel, accounts/permissions and renewal restoration, and gate business writes across APIs and workers. Current inactive permission filtering is not the approved Read-Only behavior. **Update (2026-10-16):** implemented for review under ADR-0049 (Proposed) — see OQ-45 implementation note; exact-head CI and PO acceptance pending, not an acceptance claim. |
| `license.ts` has no rollback reason/watermark; PDR-11/OQ-76 records no detection/persisted time-integrity mechanism. | Reliable meaningful-rollback evidence, trusted-time/license revalidation, controlled attributable audited rollback-only unlock, tamper/restart handling and secure recovery. No existing mechanism is claimed. |
| OQ-78/ADR-0046 record no revocation artifact/state or login-blocking implementation; current licensing import exemption avoids bootstrap deadlock but is not independent emergency recovery. | Define restriction reasons, authorization, session behavior, independent authenticated recovery interface, signed import/state transition and backup path, including explicit security-incident responses. |
| `domain/license-version.ts` and `application/license-import.service.ts` retain duplicate refusal behavior; legacy hash retry returns unchanged rather than a persisted original response. | Specify operation identity/content comparison, durable original result, authorized replay retrieval and atomic concurrent no-repeat effects (OQ-81); preserve formats/vectors. |
| Owner `migrations/001-foundation.sql`, `002-manual-operations.sql` and `backend/src/audit.ts` provide attributable stored events, not a separate permanent archive. | Archive boundary, durable retention/restore, least-privilege sensitive access and minimization; no purge or unproven tamper-proof claim (OQ-77). |
| Initial audit found Owner customer/operation/audit raw ISO primary fields and Gregorian audit inputs. | PR #164 was explicitly extended on 2026-10-16 with bounded code/regression fixes, exact-source independent Owner integration and versioned Tehran filter links preserving old UTC semantics. See `docs/tasks/global-date-contract-audit.md` for actual call sites, verification and unverified scope; no whole-module compliance claim. |
| `SUSPENDED` consumers in §20.3 and trust-list limitations in §20.4. | Compatibility audit/migration and compatible incident-response design respectively. |

Paths in the table's customer domain/application rows are relative to
`backend/src/modules/licensing/`; Owner paths are relative to `owner-licensing/`.
These are source-inspection findings, not executed feature tests or production audits.

### 20.6 Required acceptance criteria for follow-up implementation

These are **requirements to test**, not passing tests in this documentation PR:

- At natural signed expiry enter Grace with truthful reason/status; use the
  decided boundary `validUntil + 14×24h` in UTC and transition at `now >= boundary`.
  Test exact before/at/after Instants, intraday expiry, restart and signed-extension
  behavior. The 336-hour UTC rule is approved; local-calendar/DST arithmetic is
  not the source of the boundary. Signed expiry and canonical bytes stay unchanged.
  The independent contract-termination strictness question remains open.
- Test all existing users under normal auth: authorized reads/reports/print/Excel
  succeed, unauthorized ones remain denied; business writes/inventory/accounting
  fail at API and async paths. Users/data/permissions/history remain unchanged.
  Valid renewal + revalidation restores only previously authorized operation.
- Emergency restriction is immediate on applicable validated authority, never
  expiry Grace; invalid/foreign/stale/wrong-purpose artifacts cannot clear it.
  Ordinary renewal, clock repair and restart cannot clear independent reasons.
- With commercial login blocked, approved administrator authentication reaches
  recovery only, can inspect/import and use approved backup/recovery paths,
  and cannot perform commercial work. Record authorized/rejected recovery and
  state changes without leaking sensitive inputs.
- Technical outage alone does not suspend; security failures follow explicit
  deterministic policies and existing verification boundaries, not a universal
  fail-open/closed switch.
- Restrict only when reliable evidence establishes meaningful rollback; a small
  backward change alone is insufficient. After correction, revalidate trusted time
  and license/time evidence; only validated resolution permits a controlled,
  attributable, audited rollback-only unlock. Failed or uncertain validation
  requires secure authorized recovery. Test restarts, database/clock manipulation
  and coexisting restrictions; never clear unrelated reasons.
- Identical successful retries, including concurrent ones, return the persisted
  previous result without repeated quota/effects/transitions; conflicting reuse
  fails. Similar descriptions with distinct valid operation identities are not
  duplicates. Result retrieval preserves authorization/customer boundaries.
- Verify permanent separate archive retention and least-privilege sensitive access,
  manual-versus-verified evidence labels, staged legacy-state compatibility,
  continued license validity after key compromise under the approved policy,
  and Jalali-first Owner/customer presentation without storage/protocol drift.


## 21. Product Owner decisions and traceability update — 2026-10-16

**Authority and scope.** This is a documentation-only record of the explicit
Product Owner decisions for OQ-45 and OQ-74–OQ-85. It supersedes conflicting
older product wording only where stated below. It does not authorize application
code, protocol/schema changes, keys, or claim implementation. The concise status
matrix is [`docs/tasks/licensing-po-decision-traceability-2026-10-16.md`](../../tasks/licensing-po-decision-traceability-2026-10-16.md);
central OQ statuses remain in [`docs/open-questions.md`](../../open-questions.md).
Earlier dated notes in §§19–20 remain historical unless explicitly superseded
here. Decisions already recorded in PDR-11, PDR-15 and PDR-17 are preserved
except for explicit conflicts below.

### 21.1 Closed product decisions (implementation remains separate)

- **OQ-45 natural subscription expiry:** exact UTC boundary is recorded in
  [OQ-45](OQ-45-license-expiry-behavior.md): signed expiry Instant + 14×24
  hours; Grace ends at `now >= boundary`. Only natural subscription expiry receives the
  automatic Grace. Intentional subscription cancellation does not; event types
  remain distinct and cancellation/restriction transition details stay under
  OQ-78. The independent contract-termination strictness question remains open.
- **OQ-74 key incident policy:** signing keys remain under Owner custody/control;
  existing issued licenses are not automatically invalidated solely because a
  signing key is compromised. Key containment, controlled rotation, future-import
  trust, provenance and offline recovery remain security-design gaps. Custody is
  an Owner responsibility; no particular vault/HSM, operator procedure or safe
  rotation implementation is selected or claimed.
- **OQ-75 Owner roles:** the MVP has Owner Admin and License Operator only;
  PDR-17 records the boundary. Exact permission/API mapping and security review
  are not implemented by this decision.
- **OQ-76 rollback:** apply a restriction only when time-integrity evidence
  establishes meaningful rollback; a small backward change alone is insufficient.
  Do not invent a threshold. After correction, revalidate trustworthy time and
  license/time evidence. If resolved, only a controlled, attributable, audited
  rollback-only unlock is allowed; failed/uncertain evidence requires secure,
  authorized, attributable and audited recovery. Never clear unrelated restrictions.
  Detector, evidence model and recovery mechanism remain open.
- **OQ-77 audit:** audit history is append-only with a minimum three-year
  retention measured from each event's occurrence. Unresolved security incidents
  are excluded from automatic deletion. PDR-17's previously approved permanent
  separate archive remains in force; three years is not a purge date. Archive
  implementation, access/minimization and incident-resolution evidence remain open.
- **OQ-78 lifecycle/recovery:** natural subscription expiry, intentional
  subscription cancellation, signed offline license cancellation/revocation,
  replacement, reissuance and contract termination are distinct events, not
  interchangeable statuses or implicit transitions. Cancellation takes effect
  offline only on import of the approved signed artifact and is recorded in the
  Owner system. Restricted-admin access permits approved artifact/recovery work
  without itself restoring ordinary access. Reactivation of the same license
  keeps its original dates; a separately reissued license after recovery need not.
  No additional transition is defined. Session, authorization, evidence and
  API/state-machine details remain open.
- **OQ-79 legacy `SUSPENDED`:** use attributable evidence to classify history.
  Unclassifiable records remain restricted and reviewable; never auto-map them
  to CANCELLED, ACTIVE, EXPIRED, REVOKED or any other status. Data inventory and
  compatibility/migration are still open.
- **OQ-81 replay:** preserve the recorded operation-identity, fingerprint,
  authorization, current-versus-historical-result, legacy compatibility,
  concurrency and no-repeat-effect decisions in the existing OQ-81 technical
  record and registry. Keep the replay response DTO question open. Key
  compromise/replay interaction is not decided here and needs an explicit
  security design; no format/vector changes.
- **OQ-82 server replacement:** manual Owner-authorized process only. Set up and
  activate the replacement server before manually decommissioning the old one;
  retain a pending state until auditable manual decommission confirmation.
  Owner Admin configures the pending request/confirmation period from 1 hour–7
  days, default 24 hours. No remote shutdown/control is claimed. The approved
  records do not specify how new-server activation works while preserving §5.3/
  ADR-0045 installation binding, or how pending/finalization avoids inconsistent
  records. Evidence, period start/end, and timeout/failure recovery also remain
  technical gaps; OQ-82 implementation is blocked pending specification (PDR-17).
- **OQ-83 device replacement:** manual Owner Admin-managed MVP workflow, not
  customer self-service. Keep the old device active until the replacement
  activates; complete an atomic, quota-neutral one-for-one swap. PDR-15 records
  this superseding policy. Existing runtime behavior requires separate
  reconciliation; this decision is not an implementation claim.
- **OQ-84 ordinary activation:** no mandatory separate signed activation
  receipt; preserve the existing manual attributable history policy. This does
  not decide OQ-83 replacement evidence and is distinct from OQ-81's durable API
  replay receipts/response DTO; neither receipt question is generalized into the
  other.
- **OQ-85 trust boundary:** infrastructure and issuer trust are Owner-controlled;
  ordinary customer operation needs no continuous connection to the Owner, and
  the MVP does not use a federated issuer. Offline transfer does not remove the
  need for a local customer server to apply and verify licensing data.
  Deployment/security evidence remains open.

### 21.2 Traceability and remaining gates

| Topic | Product decision status | Remaining product/API question | Specification / evidence gap | MVP implementation status from inspected repository |
|---|---|---|---|---|
| OQ-45 | Natural subscription expiry and contract-termination Grace → Read-Only policy decided by PDR-18 | Cancellation/revocation operational outcome is inactive; audit reasons remain distinct | UTC enforcement/restoration acceptance | Implementation/evidence remains open; see matrix |
| OQ-74 | No automatic invalidation of already-issued licenses | None without a new explicit trade-off | Key custody, compromise/rotation trust transition, key-compromise/replay interaction | No production rotation/custody mechanism established |
| OQ-75 | Two roles decided | None for role count/purpose | Permission mapping, authentication and review | Existing four-role implementation/docs mismatch; no runtime change here |
| OQ-76 | Evidence-based rollback restriction/recovery | No threshold decided | Trusted-time evidence, controlled attributable audited unlock, and secure recovery criteria | Detector/watermark not implemented |
| OQ-77 | Append-only; at least three years from event occurrence; unresolved security incidents excluded from automatic deletion; permanent separate archive retained | None to the minimum/stronger archive policy | Archive, access/minimization and retention execution | Current tables are not proof of separate archive |
| OQ-78 | Lifecycle events distinct; signed offline cancellation and restricted-admin recovery policy decided | No additional transition semantics | Session/auth/API/state protocol, audit evidence and date/reissue handling | No full cancellation/revocation/recovery lifecycle established |
| OQ-79 | Evidence-only classification; ambiguous history restricted/reviewable; no blanket mapping to any status | None | Historical data audit, compatibility and migration plan | Existing `SUSPENDED` consumers remain |
| OQ-81 | Prior decisions preserved | Replay DTO after supersession remains open | Receipt persistence/retrieval; key compromise/replay interaction | Current duplicate rejection/no receipt; see design |
| OQ-82 | Manual replacement sequence and pending-period range/default decided | No remote shutdown authority | New-server activation under existing one-active/license-installation binding; pending/finalization consistency; decommission evidence; period start/end and timeout/failure recovery | Current operator observations do not prove decommission; implementation blocked pending specification |
| OQ-83 | Manual Owner Admin, quota-safe atomic swap decided | No new product question | Manual workflow/API/evidence and conflict reconciliation | Existing implementation requires review against new policy |
| OQ-84 | No separate signed ordinary activation receipt | Closed | Manual audit evidence remains non-cryptographic | Existing Owner manual record is not a signed receipt |
| OQ-85 | Owner-controlled, offline-capable, non-federated boundary decided | None for this boundary | Deployment/key/trust operational controls | No production Owner issuer or continuous-connectivity claim |

This matrix distinguishes decided policy from implementation; entries naming a
code gap are not feature tests. Separate product questions not answered above
remain open and must not be guessed.


## 22. Product Owner decisions — contract and activation policy (2026-10-17)

The later binding policy is recorded in [PDR-18](PDR-18-licensing-commercial-dates-and-lifecycle-decisions.md). It supersedes conflicting earlier text only on the topics it explicitly addresses:

- Commercial contract start/end dates and technical activation validity are independent fields and concepts. On issuance, activation `validFrom` is populated from the current issuance date and cannot be edited; past- or future-start activation is forbidden. The issuer selects `validUntil` independently. Owner UI/API must show both date pairs distinctly.
- A special C11/internal-gap/backdated-gap-fill path is not required for MVP. The accepted C10/OD-LIC-05/ADR-0050 reduction guard remains in force. Engineering must specify compatibility with existing version conflict/renewal rules before changing import behavior.
- WORM is not an MVP requirement. Previously approved append-only audit, minimum three-year retention, permanent separate archive, unresolved-security-incident hold, access/minimization, verification and recovery policy remain.
- Contract termination follows natural expiry: 14×24 hours UTC Grace, then Read-Only. Intentional subscription cancellation, license cancellation/revocation and emergency revocation share the operational outcome of an inactive license and do not automatically receive expiry Grace; audit reasons remain distinct.
- Successful API replay returns the original operation result separately from current license state, marks replay explicitly and does not reapply the operation.
- Server replacement may activate the new server before manual decommission of the old server under a limited one-time Owner authorization; record customer/authorized-representative approval and its details. No remote shutdown is claimed. Engineering must propose a binding-safe, failure-recoverable protocol.
- Customer Vardena System Administrators may manually deactivate client devices and atomically transfer quota; active-device limits and history remain enforced.

**Status discipline:** these are approved product policies, not claims that implementation, tests, CI, or operational readiness are complete. See PDR-18 and the registry/traceability records for follow-up.

## OQ-74 administrative implementation cross-reference — 2026-10-19

The [OQ-74 implementation record](../../tasks/licensing-oq-74-signing-key-compromise-response.md)
traces metadata registration/status/notes, nullable license-observation links,
derived administrative safety and attributable audit. Replacement generation and
trusted-key rollout remain separate Owner-controlled operations; none was executed
or claimed by the metadata feature. No automatic invalidation, production signer,
new role, cryptographic proof or OQ-78 artifact is introduced. U-1 custody,
provenance/containment and offline recovery design remain open. Exact-head CI and
Product Owner acceptance are distinct from policy approval and source presence.
