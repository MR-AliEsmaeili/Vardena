# PDR-11: Vardena Licensing — Product Requirements Source of Truth

> **Owner Phase 1 update (2026-10-15):**
> [PDR-17](PDR-17-owner-web-application-phase-1.md) records the approved Owner
> web/PostgreSQL boundary, no dual control, durable audit, manual activation and
> server-replacement policy. It supersedes earlier undecided directions only to
> that extent. The historical option C wording is not reconstructed. The
> explicit 2026-10-15 decisions below now establish audit retention and the
> licensing restriction/recovery policies; no unknown permission is inferred.

> **Current decision reconciliation (2026-10-15, documentation only):** the
> Product Owner's explicit Grace/Read-Only, emergency/recovery, clock, audit,
> duplicate, key-compromise and conceptual-state decisions supersede contrary
> earlier wording in this record. §§9–10, 12 and 15 are updated in place;
> **§20** records assessment, compatibility constraints, acceptance criteria and
> evidence-backed follow-ups. §18 and §19 retain the dated original traceability
> and reconciliation history, **not current open-question statuses**. Consult
> §20 and the registry for current dispositions. Approval of behavior is not
> implementation, verification, acceptance of code, or authorization to merge.


- **Type:** PDR (Product Decision Record) · decision IDs: **none assigned**. This record is traced by section (§); see §18. No OQ, C, or ADR identifier was created by this record.
- **Status:** **Decided — approved product-requirements reference** (Owner-approved, 2026-10-11). Documentation only. **This is not an implementation specification and not authorization to start coding.** Implementation requires a separate, explicit Product Owner instruction after technical design.
- **Status update (2026-10-11, later the same day):** the Product Owner gave the explicit follow-up instruction — resolve §19, reconcile affected records, produce the technical design, and begin implementation with a tested first vertical slice. That work is recorded in §19.4, `docs/tasks/pdr-11-conflict-reconciliation.md`, [ADR-0045](../../adr/0045-installation-identity-and-license-activation.md) and [ADR-0046](../../adr/0046-signed-license-documents-and-version-lifecycle.md). At that date §15 registered OQ-74…OQ-85 without deciding them; subsequent dated decisions, including §20, supersede that historical status.
- **Decided by:** Repository Owner / Product Owner, via the Owner-approved licensing brief of 2026-10-11. The brief itself is not stored in the repository; this record is its canonical transcription.
- **Date:** 2026-10-11
- **Language:** English, consistent with the other PDR and OQ records. Established technical terms are kept in English.
- **Scope of this record:** the Vardena licensing product requirements. It does not change implemented behavior. §19 records original conflicts; §20 records the current scoped product reconciliation and required engineering follow-ups, without self-approving technical architecture.
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

**3.5 Conceptual lifecycle states.** The approved concepts are: *not yet effective* (a future-dated version before its start date), *effective* (within validity), *expired* (subscription end reached, restricted mode per §9), and *revoked* (full revocation per §10). The precise state machine is a design item (§16). `SUSPENDED` is removed as a separate product concept: use the approved condition with explicit reason/context, not another ambiguous state. The legacy enum remains a compatibility concern, not a new product state; safe removal/mapping requires §20.3 (PQ-4/OQ-79). Grace and Read-Only are approved behavioral phases, not an instruction to add wire enum values.

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
- **Product Owner decision (2026-10-15, U-1/OQ-74):** existing issued licenses remain valid and are not automatically invalidated solely because a signing key is compromised. This does not make a compromised key safe. Engineering must document the consequences and compatible key-rotation/incident-response design for new issuance, trust updates, key revocation and controlled recovery (§20.4); production custody and unresolved security trade-offs remain gated. No signed format or existing artifact is changed by recording this policy.

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

**5.2 Signed license file (Must).**

- The server license is delivered as a **digitally signed file**, not merely as a plain-text key.
- The customer server verifies signed license data using trusted public-key material.
- The Owner signing private key must **never** be present on the customer server.

**5.3 One active installation per license (Must).** One active server installation is allowed per license.

**5.4 Replacement versus commercial change (Must).** These concepts are distinct.

- *Installation replacement* covers hardware failure, reinstallation, or a necessary move to another server. It **must not** automatically require repurchasing the same commercial rights. It must have a dedicated, auditable replacement workflow.
- *Commercial change* is a new signed LicenseVersion (§3.3).

**5.5 Replacement workflow (Must).** The replacement process follows these steps:

1. A replacement request is created and tracked. Every new customer-server installation/replacement requires manual Owner approval, attributable to an authorized Owner user; no automatic unrestricted transfer is permitted. PDR-17 records the current manual-observation scope, not cryptographic completion.
2. The Owner can issue a replacement file bound to the relevant license and the replacement operation.
3. Issuing the file does **not** immediately revoke the old installation.
4. The new server imports the file and validates its authenticity, the customer/license relationship, and the replacement context.
5. The new server establishes its installation identity and completes activation.
6. Successful activation produces a signed activation receipt identifying the operation and its outcome.
7. The receipt can be transferred manually and imported into the Owner system when the customer is offline.
8. The Owner's replacement record is finalized when the required successful activation receipt is received and validated.
9. The old installation becomes recorded as replaced when the replacement is successfully completed according to the defined workflow.
10. Historical records are retained.
11. Only **one** valid pending replacement request may exist at a time.
12. The Owner may cancel a pending request and issue another request.
13. A canceled request must **not** be accepted as a valid new activation request.
14. The replacement workflow must **not** leave the customer unnecessarily locked out if new activation fails. (Detailed recovery is **OPEN**, §15, U-9.)

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

**7.1 Counting (Must).** Client-device entitlement is counted by **registered devices**. It is not counted by concurrent sessions, and it is not the number of user accounts.

**7.2 Quota consumption (Must).** A registered device consumes quota until it is explicitly deactivated or replaced. **Decision update (2026-10-15, PDR-15 / OD-LIC-04):** replacement is a one-for-one exchange and does not increase consumed quota. While replacement is pending, the old active device continues to consume one unit; only successful atomic completion changes the old device to replaced and activates the new device. Pending replacement requests do not consume a second unit.

**7.3 Administration in the GUI (Must).** The customer's System Administrator manages devices through Vardena's graphical interface. The licensing UI must expose:

- registered devices;
- registration and activation;
- deactivation;
- replacement;
- license information;
- consumed and available device quota.

**7.4 Direct activation (Must).** The administrator may activate a device directly when the request is valid and quota is available. There is **no** separate device-activation approval stage.

**7.5 Deactivation and replacement are distinct (Must).** They are separate operations with separate meanings and records.

**7.6 History retained (Must).** Device history is retained. Device records must not simply be deleted.

**7.7 Device identity (Must).**

- A device's identity must **not** rely solely on its IP address or machine name.
- The intended identity model is a **dedicated cryptographic key per device**. The device's private key stays on the client. The server associates the device's public key with its authorization.
- **Decision update (2026-10-15, PDR-15 / OD-LIC-04):** the private key remains client-side and is never sent to or persisted by the server; device enrollment and replacement use proof signed by that device's key.

**7.8 Reinstallation (Must).** Reinstallation may destroy a device key. A recovery or replacement workflow is therefore required.

**7.9 Replacement without the old device (Must).** The customer's System Administrator may replace a lost or reinstalled device **without access to the old device**, even if its old key is unavailable.

**7.10 Replacement properties (Must).** Device replacement must be controlled, auditable, and atomic from the server's perspective. It must avoid leaving the customer locked out if activation fails. **Decision update (2026-10-15, PDR-15 / OD-LIC-04):** the old device is retired only in the transaction that activates the new device and completes the correlated replacement; invalid, expired, cancelled, stale or replayed evidence leaves the old device active and does not partially create a new device. Replacement is allowed without the old device or key, and only one valid pending request is allowed per replacement scope.

**7.11 Offline replacement (Must).** In an offline replacement, final completion may remain **pending** until the signed response or receipt is imported. **Decision update (2026-10-15, PDR-15 / OD-LIC-04):** the client device signs a request, and the customer server completes only after importing a trusted, signed response that is correlated to that request and the current installation/customer/license binding. Signed files are primary; a text fallback must carry the same signed data and pass the same verification. This replacement-specific evidence does not decide general activation receipts (OQ-84).

**7.12 Activation paths (Must).**

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

**9.1 Product Owner decision — OQ-45/PQ-1/PQ-2 (2026-10-15).**
The expiry path is **Active → Grace (14 calendar days) → Read-Only**.
At subscription expiry enter Grace, clearly displaying the actual reason and
current license status; normal authorized operation continues during Grace.
At its end enter Read-Only. Use the authoritative license-time semantics:
existing validity bounds remain half-open Instants, not UI date strings; calendar
presentation does not change signed expiry. No silent rounding, undocumented
period or restart-based extension is allowed. The calendar deadline calculation
must be specified/tested against the existing date/time foundation before enforcement.

Grace beyond 14 calendar days requires Owner authorization and a valid
Owner-issued signed artifact through approved validation. Local settings,
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
mechanism, module/worker operation classification and acceptance tests, without
weakening §9.2. Grace/Read-Only enforcement is not implemented or verified by this
PR. Follow-ups and acceptance criteria are in §20.5–§20.6.

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
and is not an emergency bypass.

An import clears a restriction only if the artifact is valid, customer/installation
applicable, authorized for the intended operation, and accepted by the relevant
state-transition rules. Recovery access and license-state changes must be
auditable. Preserve the Owner/customer separation: no Owner keys, Owner runtime,
customer-database access from Owner, callback or dependency on online service.
This is a required behavior, **not an existing recovery implementation**; the
concrete authentication/session/protocol gaps are recorded in §20.5.

**10.4 Offline servers (Must).**

- For an offline server, revocation takes effect locally only **after the applicable signed revocation file is imported**.
- Instant remote revocation cannot be promised to a disconnected server.

**10.5 Binding (Must).** Revocation files must be cryptographically bound to the relevant license and operation.

**10.6 Reactivation (Must).**

- Restoration of normal commercial operation requires valid Owner authorization and a **new valid Owner-issued signed code or file**, according to the approved protocol. An ordinary renewal cannot silently clear an unrelated emergency restriction; neither restart nor clock correction bypasses it.
- The Owner may reverse a previously recorded revocation.
- The complete revocation and reactivation history is preserved.
- Reactivation restores the **previous** license status subject to revalidation of current validity and all independent restrictions; it is not unconditional permission for commercial operation.
- Reactivation does **not** change the original license dates.
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
| Contract expiry | §9: 14-calendar-day Grace then defined Read-Only; renewal path. |
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

**11.7 Effect only after import (Must).** Revocation, reactivation, and replacement completion take effect on an offline server only after the valid signed file is imported (§7.11, §10.4, §10.6).

**11.8 Formats (Design item).** The exact file formats and protocols for licenses, renewals, revocations, reactivations, replacement requests and responses, and activation receipts are **not** decided here (§15, U-3; §16). Backward compatibility and versioning are **OPEN** (§15, U-8).

## 12. Security and audit requirements

**12.1 Objective.** Practical protection against straightforward copying, forgery, and unauthorized operations (§1.5). No absolute protection against a full local administrator is claimed.

**12.2 Authenticity (Must).** Every signed licensing input is verified before it is accepted, using trusted public-key material only.

**12.3 Binding (Must).** Signed inputs are bound to the relevant license, installation, device, and operation as applicable.

**12.4 Replay and duplicates (Must).** Operation identifiers and authenticity checks prevent replay. Duplicate operations are rejected or handled as defined in §10.8 without changing state twice.

**12.5 Signing-key custody (Must).** The Owner signing private key is never present on a customer server (§4.4, §5.2).

**12.6 Product Owner decision — clock rollback (U-6/OQ-76).**

- Persist the last accepted time needed by the time-integrity mechanism.
- Detect backward system-clock movement according to that mechanism and
  **immediately** enter the prescribed restricted state; record a security/audit
  event. Do not introduce an arbitrary tolerance that delays restriction.
- After clock correction, revalidate trustworthy current time against the stored
  time-integrity state. If valid again, **automatically** remove only the
  restriction attributable solely to rollback; no manual clear is required for
  that case. This supersedes the former administrator-cleared requirement.
- If integrity cannot be re-established, require the approved recovery procedure;
  do not invent an unsigned local reset, watermark erasure or universal
  Owner-signature waiver. The exact recovery mechanism requires engineering design.
- Correction never clears an independent emergency or other unrelated restriction,
  and never changes license expiry. Restarts, database edits and clock manipulation
  must not bypass detection/persisted state (§1.5's practical security limit remains).
- Engineering must document/test detection, trusted-time revalidation, persistence,
  operation coverage and recovery. These mechanisms are **not implemented**;
  U-6/OQ-76 retains the technical follow-up, not an undecided product response.

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

The four approved role categories below are unchanged. Their original purpose/status descriptions are retained; [PDR-17](PDR-17-owner-web-application-phase-1.md) supplies the current approved operation matrix for the Owner slice. Broader operation authority remains OQ-75/U-5; no signing or recovery permission is inferred from a role name.

| Role category | Purpose (product level) | Status |
|---|---|---|
| Owner System Administrator | Administers the Owner-side system and its users and roles. | Approved category; operation-level permissions OPEN (U-5) |
| License Issuance Specialist | Carries out license issuance, versions, signed updates, renewals, revocations, reactivations, and replacement issuance, within the authorized issuance process. | Approved category; operation-level permissions OPEN (U-5) |
| Read-only Observer | Views Owner-side records without changing them. | Approved category; operation-level permissions OPEN (U-5) |
| Support Specialist with limited access | Performs support activities within a limited scope. Its scope is not defined here. | Approved category; scope and permissions OPEN (U-5) |

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
| U-5 | **Detailed Owner role permissions** for the four approved role categories (§13). | PDR-17 current approved matrix is preserved; OQ-75 remains open only for broader future operation/acceptance scope. No inferred signing or recovery grants. |
| U-6 | Clock rollback (OQ-76). | **Product behavior decided:** immediate restriction and automatic rollback-only clearance after trusted-time revalidation (§12.6). Exact detection, validation, persistence and recovery remain engineering work; no invented tolerance. |
| U-7 | Audit (OQ-77). | **Retention/access policy decided:** permanent separate archive, authorized sensitive access, minimization, no contradictory purge (§12.8). Schema/archive/security controls remain design and implementation follow-ups. |
| U-8 | **Backward compatibility**: versioning and migration rules for future signed-file formats. | Technical design item (§16). |
| U-9 | **Offline replacement failure recovery**: a detailed protocol that ensures a failed activation does not strand the customer, while canceled requests cannot be reused (§5.5 steps 13–14, §7.10). | Technical design item. If the protocol needs a business trade-off, the alternatives must be documented and returned to the Owner. |

### 15.2 Product clarifications found during reconciliation

| ID | Open question | Why it matters | Handling |
|---|---|---|---|
| PQ-1 | Grace at expiry (OQ-45). | Expiry timing and signed extension authority. | **Decided:** 14 calendar days, then Read-Only; Owner authorization + valid signed artifact for extension (§9). |
| PQ-2 | Read-Only meaning (OQ-45). | One observable contract. | **Decided:** all existing users under normal auth, existing read/report/print/Excel rights, backup/status/renewal; no business mutation; backend/async enforcement and reversible restoration (§9). |
| PQ-3 | Full revocation/recovery (OQ-78). | Recovery must not depend on commercial login. | **Product behavior decided:** restricted authenticated administrator recovery interface and backup path (§10.3), valid signed restoration (§10.6). Authentication/session/state/protocol design remains open. |
| PQ-4 | Legacy `SUSPENDED` (OQ-79). | Compatibility and historical meaning. | **Product decision:** remove separate concept; explicit actual condition/reason. Stage safe consumer/data compatibility work (§20.3), no enum/schema/signed-byte change here. |
| PQ-5 | Overlapping/gapped subscription versions (OQ-80/OQ-86). | Retained effective history and renewal. | **Previously decided, unchanged:** Option B overlap, G2 renewal gaps and full retained-history checks; PDR-12/PDR-13 and later Q3 clarification remain authoritative (§20.1). |
| PQ-6 | **Quota effect of device replacement.** The approved text implies that replacing a device does not increase quota consumption. This should be confirmed explicitly. | Affects whether a replacement can exceed quota. | **Decided 2026-10-15 by the Product Owner:** replacement exchanges one active device for one and does not increase consumed quota; pending requests keep the old device active. PDR-15 §2.15 also confirms that an over-quota device reduction may be resolved either by explicitly deactivating devices or through the existing authorized, audited licensing reduction flow; that flow never auto-deactivates, and new enrollment remains blocked while usage is at or above the finite limit. See [PDR-15 / OD-LIC-04](./PDR-15-client-device-licensing-and-replacement.md) and §7.13. OQ-83 remains OPEN for implementation review and exact-head CI. |
| PQ-7 | **Owner-side system ownership and location.** Is the Owner-side licensing system part of Vardena or a separate tool? Existing records defer CRM and commercial providers (ADR-0030; `docs/licensing-architecture.md`), and OQ-61 is Open on CRM ownership and timing. | Determines where Owner-side requirements are built and who owns the data. | Owner decision. Linked to OQ-61. |
| PQ-8 | Duplicate operations (OQ-81). | Safe retries and conflicts. | **Product behavior decided:** exact successful repeat returns persisted previous result, conflicting reuse rejected, no repeated side effects (§10.8). Technical identity/result retrieval remains open. |
| PQ-9 | Ordinary activation receipts (OQ-84). | Evidence is not a signature. | **Decided:** no signed receipt required for ordinary activation; manual attributable activation history suffices for approved scope (PDR-17). Does not remove operation-specific replacement evidence or decide OQ-82 protocols. |

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
10. Clock monitoring: time source, persisted last-accepted time, detection and trusted-time revalidation/recovery (U-6); no arbitrary tolerance or manual-only clearance contrary to §12.6.
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
> **PDR-15 design addendum (2026-10-15).** The Product Owner decision
> **OD-LIC-04** records the client-device product policy and resolves the
> replacement/quota ambiguity in OQ-83. The customer-side technical design for
> device identity proof, signed replacement exchange, state transitions,
> authorization, persistence, and verification is maintained in
> [`docs/licensing/client-device-lifecycle.md`](../../licensing/client-device-lifecycle.md).
> This answers the device-specific parts of item 5 and the device-specific
> portions of items 8, 11, 13 and 15 only. It does **not** decide the general
> activation receipt question (PQ-9/OQ-84), server replacement, revocation,
> Owner-side issuance, backup-key design, or any other open item. OQ-83 remains
> OPEN for implementation review and exact-head CI.

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
- **G-9 — Restore not license-blocked.** Restore is not blocked by license state, as recorded in OQ-53, until PQ-3 is decided (§6.7).
- **G-10 — Design gate.** No implementation starts from this record alone. Technical design (§16) and the explicit Product Owner instruction come first.

## 18. Decision traceability table

Rows are traced by section, because no Owner decision IDs were assigned. **Status** means documentation status unless marked otherwise. "Implemented" means verified in the repository's existing records or static code. It does not mean runtime-validated.

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
| 18 | Four role categories | Owner System Administrator, License Issuance Specialist, Read-only Observer, Support Specialist (limited) | §13 | None | Approved category · detail OPEN (U-5) |
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
| 44 | Device quota consumption | Consumes quota until deactivated or replaced; replacement is a one-for-one exchange | §7.2 | PDR-15 / OD-LIC-04 | Approved · policy decided; OQ-83 implementation in progress |
| 45 | Device GUI | Admin GUI exposes devices, activation, deactivation, replacement, license info, quota | §7.3 | PDR-15 / OD-LIC-04 | Approved · implementation in progress |
| 46 | Direct device activation | No approval stage | §7.4 | PDR-15 / OD-LIC-04 | Approved |
| 47 | Deactivation vs replacement | Distinct operations; history retained; no deletion | §7.5, §7.6 | PDR-15 / OD-LIC-04 | Approved · implementation in progress |
| 48 | Device identity | Not IP or machine name alone; per-device key; private key stays client-side | §7.7 | PDR-15 / OD-LIC-04 | Approved · implementation in progress |
| 49 | Reinstallation | Recovery or replacement workflow required | §7.8 | PDR-15 / OD-LIC-04 | Approved · replacement path in progress |
| 50 | Replace without old device | Admin may replace without old device or old key | §7.9 | PDR-15 / OD-LIC-04 | Approved · implementation in progress |
| 51 | Device replacement properties | Controlled, auditable, atomic, no lockout; old device retires only after successful completion | §7.10 | PDR-15 / OD-LIC-04 | Approved · implementation in progress |
| 52 | Offline device replacement | Completion may await a correlated, trusted signed response | §7.11 | PDR-15 / OD-LIC-04 | Approved · implementation in progress; OQ-84 remains separate |
| 53 | Activation paths | Local server; Vardena-generated code; offline file or USB transfer | §7.12, §11.4 | ADR-0036 (license code activation only); PDR-15 / OD-LIC-04 | Approved · customer-side device exchange in progress; Owner issuer out of scope |
| 54 | Signed files primary | Text code is fallback transport only | §7.12, §11.3, G-8 | ADR-0036 Decision 4 | Approved · **conflict** (CF-3) |
| 55 | Device quota reduction | Admin explicitly selects excess devices; registration blocked until resolved; never auto-deactivate/delete | §7.13, §8.5 | PDR-15 / OD-LIC-04 | Approved · implementation in progress |
| 56 | User capacity at limit | Existing users continue; new users blocked; no silent increase | §8.3 | ADR-0030 Decision 3; `docs/licensing-architecture.md` (advisory-locked limit) | Approved · partially implemented |
| 57 | User capacity reduced | Admin manually deactivates excess users; no deletion | §8.4 | `docs/licensing-architecture.md` (active-user limit) | Approved · reduction flow not implemented |
| 58 | Module entitlement removed | Use stops; data kept; backup and export remain; no destructive correction | §8.2 | ADR-0030 Decision 5 (grants stored but ineffective) | Approved · partially implemented (export exception not implemented) |
| 59 | Downgrade application | Conflict check, explanation, preservation, explicit resolution, no destruction | §8.6 | None | Approved · algorithm is design item (§16) |
| 60 | Expiry → restricted mode | Restricted mode; allowed and stopped operations defined | §9.1–§9.3 | OQ-45; `docs/frontend/ux/document-editing-and-system-alerts.md` §4 | Approved · **conflict** (CF-9) |
| 61 | Grace before restricted mode | Not stated in the brief | §9.5, §15 PQ-1 | OQ-45 (Grace duration OPEN) | **OPEN** |
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
| 72 | Clock rollback detection | Persist last time; detect; audit; restrict; admin clears after correction; no expiry change | §12.6 | None | Approved · thresholds OPEN (U-6) |
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
| CF-9 | OQ-45 (Owner decision 2026-10-05: Grace → Read-Only; durations OPEN); `docs/frontend/ux/document-editing-and-system-alerts.md` §4 (Grace warning on expiry) | This record's restricted mode at expiry (§9) does not mention Grace. The relation between restricted mode and Read-Only is unclear. | **Open** (PQ-1, PQ-2). OQ-45 stays Open. |
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

*End of PDR-11. This record is an approved product-requirements reference. Except for the narrowly scoped OQ-83 slice authorized by PDR-15 / OD-LIC-04, it is not an implementation specification and does not authorize other implementation work.*

**OQ-83 implementation addendum (2026-10-15; limited scope).** The Product Owner's final decision is recorded in [PDR-15](./PDR-15-client-device-licensing-and-replacement.md) and the registry row remains OPEN while implementation, review and exact-head CI are in progress. This addendum authorizes only the customer-side device enrollment, quota, lifecycle, explicit deactivation, signed offline replacement, authorization, REST/OpenAPI/client/UI, migration and tests described by PDR-15 and the linked technical design. It does not close OQ-84, OQ-78, OQ-82 or OQ-85, and it does not authorize general activation receipts, server replacement, revocation/recovery, Owner-side issuance, or offline operation of Vardena.

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
- Four Owner roles: Administrator, Issuance Specialist, Observer and Support,
  with the PDR-17 matrix, no mandatory second approver, and no inferred recovery
  or signing permissions. Owner/customer separation and backup/restore security
  boundaries remain in force (ADR-0048, OQ-53).

### 20.2 Current product dispositions (not implementation completion)

| Prompt decision | Existing identifier | Authoritative location / disposition |
|---|---|---|
| A–B | OQ-45; PQ-1/PQ-2 | §9 and OQ-45 record: expiry product policy **Decided**. OQ-45 stays OPEN only for the original distinct termination-trigger/strictness question; enforcement/deadline validation remains follow-up. |
| C–E | OQ-78; PQ-3; CF-4/CF-10 | §§10.1–10.6, 10.10: product behavior decided; OQ-78 stays OPEN only for security/session/recovery protocol design and implementation. |
| F | OQ-76; U-6 | §12.6: product response decided; row stays OPEN for time-integrity mechanism/recovery and tests. |
| G | OQ-77; U-7 | §12.8/PDR-17: permanent separate archive/access policy decided; row stays OPEN for schema, minimization, archive design and implementation evidence. |
| H | OQ-81; PQ-8; CF-12 | §10.8: product behavior decided; row stays OPEN for identity/content/result persistence, secure retrieval and conflict protocol. |
| I | OQ-74; U-1 | §4.4 and §20.4: non-automatic-invalidation policy approved; row stays OPEN for compatible incident-response/key lifecycle design and security consequences. |
| J | OQ-82; U-9 | §5.5/PDR-17 manual approval preserved; row stays OPEN for failure/cancellation/protocol and abandoned-observation handling. No new transfer policy. |
| K | OQ-84; PQ-9 | **Decided**, product question closed: no ordinary activation signed receipt; manual attributable history sufficient for approved scope. OQ-83 operation-specific evidence and OQ-82 design untouched. |
| L | OQ-79; PQ-4; CF-11 | §3.5 and §20.3: concept removed; row stays OPEN for compatibility/data audit and staged technical removal/mapping. |
| Global dates | OQ-02 remains separate | `docs/datetime.md` §0 and ADR-0044: project-wide Jalali-first; existing numeral convention retained, not an invented resolution of OQ-02. |

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
   evidence. Do **not** automatically map all historical rows to expiry, active
   or revocation. Unexplained legacy restrictions must not become active;
   preserve their original value/history pending authorized reconciliation.
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
| `domain/license.ts` evaluates expiry directly; `application/licensing.service.ts` filters all non-platform permissions when inactive. No Grace/Read-Only operation classification. | Design deadline/enforcement; preserve authorized read/print/Excel, accounts/permissions and renewal restoration; gate business writes across APIs and workers. Current inactive permission filtering is not the approved Read-Only behavior. |
| `license.ts` has no rollback reason/watermark; PDR-11/OQ-76 records no detection/persisted time-integrity mechanism. | Durable anti-rollback detection, trusted-time revalidation, automatic rollback-only clearance, tamper/restart handling and approved recovery. No existing mechanism is claimed. |
| OQ-78/ADR-0046 record no revocation artifact/state or login-blocking implementation; current licensing import exemption avoids bootstrap deadlock but is not independent emergency recovery. | Define restriction reasons, authorization, session behavior, independent authenticated recovery interface, signed import/state transition and backup path, including explicit security-incident responses. |
| `domain/license-version.ts` and `application/license-import.service.ts` retain duplicate refusal behavior; legacy hash retry returns unchanged rather than a persisted original response. | Specify operation identity/content comparison, durable original result, authorized replay retrieval and atomic concurrent no-repeat effects (OQ-81); preserve formats/vectors. |
| Owner `migrations/001-foundation.sql`, `002-manual-operations.sql` and `backend/src/audit.ts` provide attributable stored events, not a separate permanent archive. | Archive boundary, durable retention/restore, least-privilege sensitive access and minimization; no purge or unproven tamper-proof claim (OQ-77). |
| Owner `frontend/src/features/customers/customer-page.tsx` renders `createdAt` raw; `operations/operation-page.tsx` renders `createdAt`/`occurredAt`; `audit/audit-page.tsx` passes raw `occurredAt` into detail rows. | Apply centralized Jalali-first date presentation to Owner lists/detail/history/audit and filters under `docs/datetime.md` §0 while preserving independent builds. This is an evidenced gap, not project-wide compliance verification. |
| `SUSPENDED` consumers in §20.3 and trust-list limitations in §20.4. | Compatibility audit/migration and compatible incident-response design respectively. |

Paths in the table's customer domain/application rows are relative to
`backend/src/modules/licensing/`; Owner paths are relative to `owner-licensing/`.
These are source-inspection findings, not executed feature tests or production audits.

### 20.6 Required acceptance criteria for follow-up implementation

These are **requirements to test**, not passing tests in this documentation PR:

- At signed expiry enter Grace with truthful reason/status; at the exact approved
  14-calendar-day deadline enter Read-Only. Test before/at/after boundaries,
  applicable timezone/calendar behavior, restarts and signed extension validation.
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
- Rollback detection immediately restricts; trustworthy clock correction clears
  only rollback automatically; failed integrity revalidation requires approved
  recovery. Test repeated restarts, database/clock manipulation and coexisting
  emergency restrictions.
- Identical successful retries, including concurrent ones, return the persisted
  previous result without repeated quota/effects/transitions; conflicting reuse
  fails. Similar descriptions with distinct valid operation identities are not
  duplicates. Result retrieval preserves authorization/customer boundaries.
- Verify permanent separate archive retention and least-privilege sensitive access,
  manual-versus-verified evidence labels, staged legacy-state compatibility,
  continued license validity after key compromise under the approved policy,
  and Jalali-first Owner/customer presentation without storage/protocol drift.
