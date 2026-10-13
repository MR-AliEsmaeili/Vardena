# PDR-11: Vardena Licensing — Product Requirements Source of Truth

- **Type:** PDR (Product Decision Record) · decision IDs: **none assigned**. This record is traced by section (§); see §18. No OQ, C, or ADR identifier was created by this record.
- **Status:** **Decided — approved product-requirements reference** (Owner-approved, 2026-10-11). Documentation only. **This is not an implementation specification and not authorization to start coding.** Implementation requires a separate, explicit Product Owner instruction after technical design.
- **Status update (2026-10-11, later the same day):** the Product Owner gave the explicit follow-up instruction — resolve §19, reconcile affected records, produce the technical design, and begin implementation with a tested first vertical slice. That work is recorded in §19.4, `docs/tasks/pdr-11-conflict-reconciliation.md`, [ADR-0045](../../adr/0045-installation-identity-and-license-activation.md) and [ADR-0046](../../adr/0046-signed-license-documents-and-version-lifecycle.md). §15 stays authoritative for what is *not* decided: the items it lists are now registered as OQ-74…OQ-85 and **nothing in §15 was converted into an approved decision**.
- **Decided by:** Repository Owner / Product Owner, via the Owner-approved licensing brief of 2026-10-11. The brief itself is not stored in the repository; this record is its canonical transcription.
- **Date:** 2026-10-11
- **Language:** English, consistent with the other PDR and OQ records. Established technical terms are kept in English.
- **Scope of this record:** the Vardena licensing product requirements. It does not change any ADR, any implemented behavior, or any other record. Conflicts with existing records are listed in §19 and are **not** resolved here.
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
| Restricted mode | The state a server enters at subscription expiry (§9). It is not deletion and it is not full revocation. |
| Full revocation | A state that stops the application, including System Administrator login (§10). It is not expiry. |
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
- Must remain valid through ordinary signing-key rotation, subject to the emergency policy for a confirmed compromised signing key, which is **OPEN** (§15, U-1).

**3.2 Subscription license (Must).**

- Has explicit start and end dates.
- Is renewed by importing a new signed license file.
- The Owner manually specifies the start and end dates of each new version.
- A future-dated renewal does **not** immediately replace a still-valid current version. The current version remains valid until its own end date. The new version becomes effective according to its own start date.
- Reactivating a revoked subscription does **not** extend its original expiry date (§10.6).

**3.3 Commercial change versus installation replacement (Must).**

- A commercial license or version change represents a purchase, a contract change, a module change, or a capacity change. It is represented by a new signed LicenseVersion. Historical versions and audit events are retained.
- Installation replacement is a separate concept (§5.4).

**3.4 Version effectivity.** Which version governs at a given moment follows from the validity dates in §3.2. How overlapping or gapped versions are resolved is **OPEN** (§15, PQ-5).

**3.5 Conceptual lifecycle states.** The approved concepts are: *not yet effective* (a future-dated version before its start date), *effective* (within validity), *expired* (subscription end reached, restricted mode per §9), and *revoked* (full revocation per §10). The precise state machine is a design item (§16). The relationship between these concepts and the existing `SUSPENDED` status is **OPEN** (§15, PQ-4).

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
- **OPEN:** the emergency policy for a confirmed compromise of the Owner signing private key (§15, U-1). This record does **not** decide whether licenses are revoked, grandfathered, or handled through another emergency process.

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

1. A replacement request is created and tracked.
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
- Restore must never be blocked by license state (OQ-53; `docs/operations/backup-and-restore.md` §3). The interaction with full revocation is **OPEN** (§15, PQ-3; §19, CF-10).

## 7. Client-device licensing and lifecycle

**7.1 Counting (Must).** Client-device entitlement is counted by **registered devices**. It is not counted by concurrent sessions, and it is not the number of user accounts.

**7.2 Quota consumption (Must).** A registered device consumes quota until it is explicitly deactivated or replaced.

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

**7.8 Reinstallation (Must).** Reinstallation may destroy a device key. A recovery or replacement workflow is therefore required.

**7.9 Replacement without the old device (Must).** The customer's System Administrator may replace a lost or reinstalled device **without access to the old device**, even if its old key is unavailable.

**7.10 Replacement properties (Must).** Device replacement must be controlled, auditable, and atomic from the server's perspective. It must avoid leaving the customer locked out if activation fails.

**7.11 Offline replacement (Must).** In an offline replacement, final completion may remain **pending** until the signed response or receipt is imported.

**7.12 Activation paths (Must).**

- *Normal activation* may use the local server.
- *Alternate activation-code flow:* Vardena generates a code. The client sends it to the local server, which validates quota and registers the device.
- *True offline activation* must support manual transfer of a request and a response, using a file, a USB drive, or an equivalent method.
- **Signed files are the primary offline transfer method.** A text code may be supported as a fallback. A text representation is **only a transport mechanism**. It does not replace signature verification or operation binding.

**7.13 Quota reduction (Must).**

- If the entitled device count is reduced below the number of registered devices, the **administrator manually selects** the excess devices for deactivation.
- Until the conflict is resolved, **new device registration is blocked**.
- **Never silently auto-deactivate devices.**

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

**9.1 Expiry enters restricted mode (Must).** At subscription expiry, the customer server enters a **restricted mode**. It does not delete data, and it is not treated as full revocation (§10).

**9.2 Allowed operations in restricted mode (Must).**

- System Administrator login.
- Viewing license status.
- Viewing existing information.
- Creating or restoring backups, as supported by the defined recovery design.
- Exporting information.
- Importing a valid renewal file.

**9.3 Stopped operations (Must).** Normal new commercial operations are stopped.

**9.4 Module-level detail (Design item).** The exact module-by-module restrictions beyond this baseline may be specified during module design. They must **not** weaken the protections in §9.1–§9.3.

**9.5 Grace stage (OPEN).** Whether a Grace stage exists between the subscription end date and restricted mode is **not decided by this record**. The existing OQ-45 Owner decision (Grace → Read-Only) and the frontend UX contract in `docs/frontend/ux/document-editing-and-system-alerts.md` §4 describe a Grace stage. This is recorded as an open conflict (§15, PQ-1; §19, CF-9).

## 10. Full revocation and reactivation

**10.1 Full revocation is distinct from expiry (Must).** Full revocation **stops the application, including System Administrator login**.

**10.2 No automatic deletion (Must).** Customer data is **not** automatically deleted by revocation.

**10.3 Recovery (Must, with OPEN detail).** Recovery from full revocation requires an **external recovery process**. The process itself is not defined here (§15, PQ-3).

**10.4 Offline servers (Must).**

- For an offline server, revocation takes effect locally only **after the applicable signed revocation file is imported**.
- Instant remote revocation cannot be promised to a disconnected server.

**10.5 Binding (Must).** Revocation files must be cryptographically bound to the relevant license and operation.

**10.6 Reactivation (Must).**

- The Owner may reverse a previously recorded revocation.
- The complete revocation and reactivation history is preserved.
- Reactivation restores the **previous** license status.
- Reactivation does **not** change the original license dates.
- If a subscription has expired, reactivation alone does **not** renew it.
- A signed reactivation file must be imported on the customer server.
- An offline server remains in its previous local state until the valid file is imported.

**10.7 Operation identity (Must).** Every operation has a unique identifier and authenticity checks.

**10.8 Duplicates (Must).**

- If the same reactivation operation has already been applied, the duplicate is **rejected**, and a clear message is displayed, such as «This operation has already been completed.»
- A repeated operation must **not** change state a second time.
- The treatment of duplicate *activation* requests differs in the existing implementation (§19, CF-12). Whether this rule applies to every operation type is **OPEN** (§15, PQ-8).

**10.9 No false duplicates (Must).** A genuinely new valid operation must **not** be rejected merely because it resembles an older operation.

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

**12.6 Clock rollback (Must).**

- The last accepted time needed for rollback detection is persisted.
- Suspicious backward movement of system time is detected.
- A security or audit event is recorded.
- Commercial operations are restricted until the suspicious state is cleared.
- The customer's System Administrator may clear the suspicious state **after correcting the system clock**. Owner-signed recovery is **not** required for this case.
- If the time remains inconsistent, the restriction remains.
- Clearing the suspicious state does **not** modify license expiry.
- No absolute protection is claimed against a fully privileged local administrator.
- Thresholds, edge cases, and the precise definition of "commercial operations" for this restriction are **OPEN** (§15, U-6).

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

**12.8 Schema and retention (OPEN).** The exact audit schema, retention periods, and sensitive-data handling are **OPEN** (§15, U-7). The requirement to preserve history (§12.7) is approved.

**12.9 Non-destructive principle (Must).** Licensing actions never delete customer data as a side effect. Every destructive or capacity-changing consequence requires an explicit, auditable resolution (§7.13, §8.2, §8.4, §8.6).

## 13. Owner-side roles and responsibilities

The approved role categories are below. The purpose column is descriptive only: it is inferred from the role names and must be confirmed under U-5. **Exact operation-level permissions are OPEN (§15, U-5) and must not be treated as decided.**

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

## 15. Explicitly unresolved product and security policies

These items are **not decided**. They must be preserved as open. Nothing here may be implemented as decided. Items U-1…U-9 are the open items recorded by the Owner brief. Items PQ-1…PQ-9 were found while reconciling this record with existing records. They need an Owner decision, or a recorded technical design decision where the product intent is already clear.

### 15.1 Owner-brief open items

| ID | Open question | Handling |
|---|---|---|
| U-1 | **Emergency signing-key compromise policy.** What happens to existing licenses if the Owner signing private key is confirmed compromised? Whether all issued licenses are revoked, grandfathered, or handled by another emergency process is **not decided**. | Open security decision. Requires a separate Owner decision before implementation of signing-key handling. |
| U-2 | **Exact backup cryptographic design.** Algorithms, encryption-key handling, backup access controls, and recovery boundaries. | Technical design item (§6.6). Any loss-of-capability consequence stays as §6.3–§6.5. |
| U-3 | **Exact file formats and protocols** for signed licenses, renewals, revocations, reactivations, replacement requests and responses, and activation receipts. | Technical design item (§16). |
| U-4 | **Precise state machines** for license versions, server replacement, client-device replacement, pending requests, cancellation, and replay prevention. Including the Owner-side "unconfirmed" status. | Technical design item (§16). |
| U-5 | **Detailed Owner role permissions** for the four approved role categories (§13). | Owner decision required before the Owner-side permission matrix is built. |
| U-6 | **Clock rollback thresholds and edge cases**: acceptable drift, precise criteria for clearing the suspicious state, and which operations count as "commercial operations" under the restriction (§12.6). | Owner-approved behavior is in §12.6. Thresholds are a design item, with any business trade-off referred back to the Owner. |
| U-7 | **Audit schema and retention**: exact fields, retention periods, and sensitive-data treatment (§12.8). | Technical design item. History preservation itself is approved. |
| U-8 | **Backward compatibility**: versioning and migration rules for future signed-file formats. | Technical design item (§16). |
| U-9 | **Offline replacement failure recovery**: a detailed protocol that ensures a failed activation does not strand the customer, while canceled requests cannot be reused (§5.5 steps 13–14, §7.10). | Technical design item. If the protocol needs a business trade-off, the alternatives must be documented and returned to the Owner. |

### 15.2 Product clarifications found during reconciliation

| ID | Open question | Why it matters | Handling |
|---|---|---|---|
| PQ-1 | **Grace stage at subscription expiry.** Does a Grace stage exist between the subscription end date and restricted mode (§9.1)? The OQ-45 decision (Grace → Read-Only) and the frontend UX contract §4 include a Grace stage. The Owner brief does not mention one. | Determines the first behavior after expiry. Commercially sensitive (OQ-45; PB-BASELINE R-02). | Owner decision. OQ-45 stays Open. |
| PQ-2 | **Relationship between restricted mode and OQ-45 Read-Only**, and the module-by-module restriction list (§9.4). | Prevents two different "read-only" definitions. | Owner decision and design item. |
| PQ-3 | **Full revocation and recovery.** Full revocation stops System Administrator login (§10.1), but OQ-53 and `docs/operations/backup-and-restore.md` §3 say restore must never be blocked by license state. §10.3 says recovery requires an external process. Two sub-questions follow: (a) which process is the external recovery path, and does it preserve the restore rule? (b) If login is blocked, how is a signed reactivation file imported (§10.6)? | Without an answer, an administrator might be unable to recover a revoked installation, or the restore rule might be breached. | Owner decision. Conflict CF-4 and CF-10 (§19). |
| PQ-4 | **Existing `SUSPENDED` status.** Is `SUSPENDED` (implemented in ADR-0030 and ADR-0036) retained, renamed, or mapped to a distinct approved state such as revocation or restricted mode? | Two lifecycle vocabularies would otherwise coexist. | Owner decision. |
| PQ-5 | **Overlapping or gapped subscription versions.** The approved text says the current version stays valid until its end date and the new version takes effect at its start date (§3.2). It does not say what happens when the two periods overlap, or when a gap exists. | Determines which entitlements apply on a given day. | Owner decision. |
| PQ-6 | **Quota effect of device replacement.** The approved text implies that replacing a device does not increase quota consumption. This should be confirmed explicitly. | Affects whether a replacement can exceed quota. | Owner confirmation. |
| PQ-7 | **Owner-side system ownership and location.** Is the Owner-side licensing system part of Vardena or a separate tool? Existing records defer CRM and commercial providers (ADR-0030; `docs/licensing-architecture.md`), and OQ-61 is Open on CRM ownership and timing. | Determines where Owner-side requirements are built and who owns the data. | Owner decision. Linked to OQ-61. |
| PQ-8 | **Duplicate-operation rule scope.** §10.8 requires rejection with a clear message for a duplicate reactivation. The existing activation implementation treats a repeated activation as an idempotent success (§19, CF-12). Does the rule apply to every operation type? | Avoids two different behaviors for the same kind of event. | Owner decision. |
| PQ-9 | **Activation receipts for ordinary activation.** Receipts are specified for replacement (§5.5 step 6). It is not stated whether ordinary license activation and device activation also produce signed receipts. | Affects the offline evidence trail. | Owner decision. |

## 16. Technical design questions deferred to the next phase

These are design questions, not product decisions. Each needs technical design before implementation. Where a design changes architecture, an ADR is required first (AR-29; PB-BASELINE §11.2 states that the licensing enforcement mechanism requires an ADR). None of the following is decided here:

1. Identity key: algorithm, generation, storage, rotation, and the relation to the existing installation identifier.
2. Signed file container, canonical form, signature scheme, and trusted-key distribution and retirement (also U-3, U-8).
3. Server-side representation of current and future LicenseVersions, and the atomic application algorithm (§8.6).
4. Replay protection: operation identifier namespace, persistence, and comparison semantics (§10.7–§10.9; U-4).
5. Device key model, device enrollment proof, and atomic device replacement (§7.7–§7.10).
6. Activation receipt format and validation (§5.5 step 6; PQ-9).
7. Revocation and reactivation file content and import rules (§10.4–§10.6).
8. Offline transfer packaging for files, USB, and text fallback (§7.12, §11.3).
9. Backup encryption design and key handling (U-2).
10. Clock monitoring: time source, persisted last-accepted time, thresholds (U-6).
11. Audit persistence, retention, and sensitive-data handling (U-7).
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
| 44 | Device quota consumption | Consumes quota until deactivated or replaced | §7.2 | None | Approved · quota effect of replacement to confirm (PQ-6) |
| 45 | Device GUI | Admin GUI exposes devices, activation, deactivation, replacement, license info, quota | §7.3 | None | Approved · not implemented |
| 46 | Direct device activation | No approval stage | §7.4 | None | Approved |
| 47 | Deactivation vs replacement | Distinct operations; history retained; no deletion | §7.5, §7.6 | None | Approved |
| 48 | Device identity | Not IP or machine name alone; per-device key | §7.7 | None | Approved · design item (§16) |
| 49 | Reinstallation | Recovery or replacement workflow required | §7.8 | None | Approved |
| 50 | Replace without old device | Admin may replace without old device or old key | §7.9 | None | Approved |
| 51 | Device replacement properties | Controlled, auditable, atomic, no lockout | §7.10 | None | Approved · protocol OPEN (U-9) |
| 52 | Offline device replacement | Completion may await signed receipt | §7.11 | None | Approved |
| 53 | Activation paths | Local server; Vardena-generated code; offline file or USB transfer | §7.12, §11.4 | ADR-0036 (license code activation only) | Approved · device paths not implemented |
| 54 | Signed files primary | Text code is fallback transport only | §7.12, §11.3, G-8 | ADR-0036 Decision 4 | Approved · **conflict** (CF-3) |
| 55 | Device quota reduction | Admin manually selects excess devices; registration blocked; never auto-deactivate | §7.13, §8.5 | None | Approved |
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
withdrawn. §8.6 is unchanged: a reducing or changed version still requires the
check/explain/preserve/explicit-resolution flow, and the audit of the merged tree
records the one place that flow does not yet reach — a successor that retires
nothing (a contiguous renewal), for both a retained and a new identifier — in
[`docs/tasks/licensing-po-acceptance-audit-2026-10-13.md`](../../tasks/licensing-po-acceptance-audit-2026-10-13.md)
§4, pending the Owner's ruling on the control's scope. The superseding record
for Q3 itself is the decision brief §8.3.1; the earlier text stays as the record
of what was decided on 2026-10-12. Separately, the **F-12** requirement the
records carried as an open remediation path is now decided — the initial
password remains exactly `1`, and a forced first-login password change enforced
in the backend and the frontend is **outstanding implementation**, with its
acceptance tests in the same audit §5.

*End of PDR-11. This record is an approved product-requirements reference. It is not an implementation specification and does not authorize any implementation work.*
