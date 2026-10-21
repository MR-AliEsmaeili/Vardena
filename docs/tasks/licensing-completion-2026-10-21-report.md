# Licensing completion — Owner ↔ Customer end-to-end (2026-10-21)

**Branch:** `arena/3c88d285-vardena` (from `main` @ `24608f03baa3da941ec18d06995fb5ef95267418`)
**Companion:** [pre-change audit](licensing-completion-audit-2026-10-21.md) — the capability matrix (O1–O16, C1–C8) this report closes.
**Environment:** Node.js 22.22.3, npm 10.9.8, no Docker, no system PostgreSQL. A disposable PostgreSQL 18.4 on `127.0.0.1:55432` (`owner_test`, `vardena_test`) was used for the database suites. Every number below was produced by a command executed on this branch; commands that could **not** run here are named as such and are not counted as evidence.

---

## A. Overall status

**READY FOR CI VERIFICATION.**

The end-to-end licensing cycle exists in code and is exercised by executed tests on both sides:

Owner prepares a request from selected real records → signs offline (outside the API) → imports the signed artifact and archives the exact bytes → the customer imports the file, verifies the signature against its trust list and activates → the backend enforces modules and ceilings and the Read-Only mode → renewal, supersession and signed revocation round trips are recorded with audit → a revocation makes the customer runtime refuse every later license artifact.

Nothing in this branch is a mockup, an analysis-only document or a disabled feature. What remains is **verification, not construction**: the customer backend's live-DB (e2e) suites and the GitHub CI run for this exact commit cannot be executed from this sandbox (see D.4), so the honest status is "ready for CI verification" rather than "ready for review". No Product-Owner decision is outstanding for anything implemented here (see G).

---

## B. Changes

### B.1 Owner application (`owner-licensing/`)

**Backend**

| Change                                                                                                                                                                                                                                                                                                   | Files                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| New `GET /api/v1/dashboard` — counts of durable Owner state (customers, installation identities, prepared/signed/abandoned issuances, the eligible/expired split of prepared requests, revocations, signing keys, artifact-store states), authorized by `licenses.view` in the route **and** the service | `src/dashboard.ts` (new), `src/app.ts`                      |
| **Defect fixed:** `listInstallationIdentities` asserted `customers.view` while its route declares `licenses.view`, so a `LICENSE_OPERATOR` granted the licensing read scopes (the normal operator profile) received `403` from `GET /customers/:id/installation-identities`                              | `src/licensing.ts`                                          |
| `npm run verify:interop` — Owner↔customer cross-implementation verifier (see B.4)                                                                                                                                                                                                                        | `package.json`, `scripts/verify-licensing-interop.ts` (new) |
| Positive lifecycle coverage extended: identity listing as an operator, dashboard counts checked against the same database, dashboard authorization                                                                                                                                                       | `test/licensing-lifecycle.test.ts`                          |

**Frontend**

| Change                                                                                                                                                                                                                              | Files                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New home dashboard rendering one server payload, with loading / retryable-error / genuine-empty states and a "needs action" list derived only from non-zero counts                                                                  | `src/features/home/dashboard-page.tsx` (new), `src/features/home/dashboard-page.test.tsx` (new), `src/api/dashboard.api.ts` (new), `src/app/layouts/app-shell.tsx` |
| Revocation import now reports revocation wording, not license wording (the confirmation and the replay message name the revocation artifact)                                                                                        | `src/features/licenses/prepared-panel.tsx`                                                                                                                         |
| Limit-profile retire/reactivate confirm the committed transition; installation-identity retirement explains that it is Owner-Admin-only instead of rendering no control                                                             | `src/features/customers/limit-profiles.tsx`, `installation-identities.tsx`                                                                                         |
| Preparing for an inactive customer is refused before the form is filled out (the backend refuses it anyway); the active-ceiling banner links to the customer record that owns the ceiling; `LimitProfileExceeded` gets its own copy | `src/features/licenses/prepare-issuance-form.tsx`                                                                                                                  |
| 15 dead translation keys removed, 5 dead keys wired to the behaviour they describe                                                                                                                                                  | `src/lib/owner-i18n.ts`                                                                                                                                            |

### B.2 Customer application (`frontend/`)

The signed-revocation import surface (audit gap **C7**) is implemented end to end in the customer SPA:

| Change                                                                                                                                                                                                                                                                                                        | Files                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Licensing.License.Revoke` added to the closed permission vocabulary (matching `LICENSING_PERMISSIONS.LICENSE_REVOKE` in the backend)                                                                                                                                                                         | `src/features/permissions/permission-codes.ts`                                                                                                                                  |
| `importLicenseRevocation()` client call + request/result contracts with a compile-time guard against the generated OpenAPI schema                                                                                                                                                                             | `src/api/licensing.api.ts`, `src/api/contracts.ts`                                                                                                                              |
| File-first import form (file **or** pasted text, one 65536-character field, no client-side format/signature verdict), refusal copy classified by stable error code (`409` conflicting replay, `422` stale/refused, `400` invalid, `403` permission), correlation id as support data only                      | `src/features/licensing/revocation-import-form.tsx` (new), `license-revocation-schema.ts` (new), `license-revocation-errors.ts` (new), `use-import-license-revocation.ts` (new) |
| Mounted in the license status card behind `Licensing.License.Revoke`, and only while the license is not already revoked — a revoked license refuses every later artifact, so offering the form would imply a recovery path that does not exist                                                                | `src/features/licensing/license-status-card.tsx`                                                                                                                                |
| 8 Persian strings for the new surface, deliberately distinct from the license-import copy                                                                                                                                                                                                                     | `src/lib/i18n.ts`                                                                                                                                                               |
| 8 frontend tests: offer/permission gate, already-revoked gate, empty submission, single POST of the file text and blocking only on the re-read, conflicting replay keeps the license working, stale artifact, malformed artifact + double-submit guard, and "the artifact is not retained in the query cache" | `src/features/licensing/revocation-import.test.tsx` (new)                                                                                                                       |

**Not changed:** the signed file formats (`VLIC1`, `VLIC2`, `VREV1`, `VDRQ1`, `VDRP1`), canonicalization, trust rules, protocol vectors, customer runtime enforcement, Owner schema/migrations, error code vocabulary and every existing permission meaning.

### B.3 Documentation

- `owner-licensing/README.md` — the implemented scope now names the selection-driven form, renewal/supersession, the complete Owner revocation round trip and the dashboard; the remaining gaps are stated as remaining; the stale "OD-LIC-12 not yet implemented" note is corrected; the interop verifier is documented.
- This report, plus the pre-change [audit](licensing-completion-audit-2026-10-21.md) it closes.

### B.4 Cross-implementation interop evidence (new)

`scripts/verify-licensing-interop.ts` imports **both** protocol implementations at runtime (Owner signer, customer verifier) — no production code and no build of either package is modified — and asserts seven properties:

```
PASS Owner signs a VLIC2 document the customer verifier accepts
PASS every signed field survives the trip unchanged
PASS a perpetual license (null window, explicit device quota) is accepted
PASS one changed byte in the body is refused (signature over canonical bytes)
PASS an artifact signed by an untrusted key is refused
PASS Owner signs a VREV1 revocation the customer verifier accepts
PASS a revocation re-aimed at another installation is refused
All 7 checks passed.
```

This is the direct evidence for the one property neither side's own suite can prove: **an artifact produced by the Owner code is accepted by the customer runtime, and a tampered or untrusted one is not.** It generates a disposable Ed25519 key pair in memory; no key material is read from, written to or logged by the repository.

---

## C. Requirement matrix

Legend: **Complete** = implemented, wired end to end and covered by an executed test. **Verified** = additionally proven by the cross-implementation check in B.4. **Boundary** = deliberately out of scope by a recorded Product-Owner decision.

### C.1 Owner

| #   | Requirement                                                                  | Status       | Evidence                                                                                                                                          |
| --- | ---------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | Real dashboard from real data                                                | **Complete** | `GET /dashboard` + `dashboard-page.tsx`; counts cross-checked against SQL in `licensing-lifecycle.test.ts`; 4 UI tests                            |
| O2  | Customer list / create / edit / detail                                       | Complete     | unchanged from `main`; owner API suite                                                                                                            |
| O3  | Register / list / retire installation identity                               | Complete     | UI (`installation-identities.tsx`), routes, and the fixed `licenses.view` authorization with a regression test                                    |
| O4  | Customer limit profiles (create / retire / reactivate, immutable ceilings)   | Complete     | UI + routes + lifecycle suite; transition confirmations added                                                                                     |
| O5  | License issuance with module/limit selection and a review step               | Complete     | `prepare-issuance-form.tsx`, `issuance-draft.ts` (+10 unit tests), page tests                                                                     |
| O6  | Atomic signed-file download                                                  | Complete     | `artifacts` route, `downloadArtifact`, exact-byte archive; lifecycle suite                                                                        |
| O7  | Renewal and supersession                                                     | Complete     | UI links `?renews=` / `?supersedes=`; positive e2e test records `renewsOperationId` / `supersedesOperationId` and a new `operationId`+`licenseId` |
| O8  | Revocation round trip (prepare → request → signed import → artifact)         | Complete     | `issuance-card.tsx`, `prepared-panel.tsx`; lifecycle test proves byte-identical re-download and a `409 already-revoked` on a second attempt       |
| O9  | Audit trail                                                                  | Complete     | unchanged; every new write emits its typed event                                                                                                  |
| O10 | Settings / signing keys                                                      | Complete     | unchanged                                                                                                                                         |
| O11 | Forced password change, bootstrap never overwrites, no secrets logged        | Complete     | unchanged; no secret added by this branch                                                                                                         |
| O12 | `Invalid request origin` fixed by configuration, not by disabling validation | Complete     | `OWNER_PUBLIC_ORIGIN` + Vite proxy (documented in the README); no validation removed                                                              |

### C.2 Customer

| #   | Requirement                                                                     | Status             | Evidence                                                                  |
| --- | ------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------- |
| C1  | Import + validation of a signed license (file / text / legacy code)             | Complete           | existing suite (485 tests)                                                |
| C2  | Activation bound to the first valid installation; tampered file cannot activate | Verified           | customer verification suite + B.4 tamper/untrusted-key checks             |
| C3  | Module and user/organization ceiling enforcement                                | Complete           | backend suite (`authorization.service`, limits specs)                     |
| C4  | 14-day grace then Read-Only; login/view/print/backup stay available             | Complete           | `license-gate.tsx` modes, grace specs                                     |
| C5  | Renewal without preserving `licenseId`, same customer/`customerCode`            | Verified           | owner lifecycle test + B.4 field-survival check                           |
| C6  | Signed revocation import, replay safety, refusal ordering                       | Complete           | backend API suite; **new UI** with 8 tests                                |
| C7  | Revocation import surface in the customer UI                                    | **Complete (new)** | `revocation-import-form.tsx` behind `Licensing.License.Revoke`            |
| C8  | License status / history display                                                | Complete           | `license-status-card.tsx` (governing + scheduled version + operation ids) |

### C.3 Recorded boundaries (not gaps)

Microservices, Owner→customer connectivity, remote disabling, signed activation receipts (OQ-84), the installation-identity key (designed only), OQ-82 replacement protocol, OQ-76 clock evidence and federated issuers remain out of scope exactly as decided. Nothing in this branch claims any of them.

---

## D. Test report (executed)

| Suite                                       | Command                                                                                             | Result                                                                                                                                                                         |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Owner backend lint                          | `owner-licensing/backend → npm run lint`                                                            | **0 warnings, 0 errors** (32 files)                                                                                                                                            |
| Owner backend format                        | `npm run format:check`                                                                              | clean                                                                                                                                                                          |
| Owner backend types                         | `npm run typecheck`                                                                                 | exit 0                                                                                                                                                                         |
| Owner backend unit                          | `npm test`                                                                                          | **140 / 140** (9 files)                                                                                                                                                        |
| Owner backend integration (real PostgreSQL) | `OWNER_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/owner_test npm run test:integration` | **86 / 86** (`api.test.ts` 26, `licensing-lifecycle.test.ts` 60)                                                                                                               |
| Owner backend build                         | `npm run build`                                                                                     | exit 0                                                                                                                                                                         |
| Owner frontend lint / format / types        | `npm run lint`, `npx prettier --check src`, `npx tsc --noEmit`                                      | 0/0, clean, exit 0                                                                                                                                                             |
| Owner frontend tests                        | `npm test`                                                                                          | **268 / 268** (21 files)                                                                                                                                                       |
| Owner frontend build                        | `npm run build`                                                                                     | ✓ built, `index-*.js` 481.94 kB                                                                                                                                                |
| Customer backend lint                       | `backend → npm run lint`                                                                            | **0 errors**, 3 **pre-existing** warnings in files untouched by this branch (`code-…spec.ts`, `src/tools/generate-licensing-vectors.ts`, `licensing-protocol-vectors.spec.ts`) |
| Customer backend types                      | `npm run typecheck`                                                                                 | exit 0                                                                                                                                                                         |
| Customer backend unit                       | `npm test`                                                                                          | **2262 / 2262** (166 files)                                                                                                                                                    |
| Customer frontend lint / format / types     | `npm run lint`, `npx prettier --check src`, `npx tsc --noEmit`                                      | 0/0, clean, exit 0                                                                                                                                                             |
| Customer frontend tests                     | `npm test`                                                                                          | **485 / 485** (68 files)                                                                                                                                                       |
| Customer frontend build                     | `npm run build`                                                                                     | ✓ built                                                                                                                                                                        |
| Cross-implementation interop                | `owner-licensing/backend → npm run verify:interop`                                                  | **7 / 7 checks passed**                                                                                                                                                        |

### D.1 New tests added by this branch

- Owner backend: identity listing under `licenses.view`; dashboard counts against the same database (non-vacuous: signed issuances > 0); dashboard `401`/`403`; renewal, supersession and the revocation round trip (prepare → download request → sign → import → byte-identical artifact → replay → `409`).
- Owner frontend: dashboard (counts, empty, error+retry, no-permission), revocation import wording, plus the earlier issuance-draft/form/page suites.
- Customer frontend: 8 revocation-import tests (see B.2).

### D.2 What each test would catch (why the count is not the point)

The suite is only useful if a regression fails it. Representative mappings: a route/service permission disagreement fails the identity regression test; a dashboard that computed locally instead of printing the payload fails the count assertions; a client that promoted the import receipt into license state fails "blocks the workspace only on the backend-confirmed revoked state"; a client-side "looks signed" shortcut would pass the UI test but fail B.4's tamper check; a revocation that could be replayed as a new fact fails the `replayed:true` + single-row assertions.

### D.3 Database setup performed here

A disposable PostgreSQL 18.4 cluster was started from embedded binaries and used for the Owner integration suites (`owner_test`). The customer migrations (`backend/prisma/migrations/*`, 44 directories) were applied to `vardena_test` with a plain SQL runner and succeeded through `20261024000000_licensing_revocations`.

### D.4 Not executed here — stated plainly

- **Customer backend e2e / live-DB suites** (`npm run test:e2e`): blocked by the sandbox network policy. `prisma migrate deploy` and `prisma generate` both try to download the Prisma schema engine from `binaries.prisma.sh`, which is not reachable here (`Client network socket disconnected …`), and the generated client (`node_modules/.prisma/client`) is therefore absent. The schema itself was applied successfully by SQL, so the blocker is the Prisma toolchain download, not the migrations. These suites run in CI (`.github/workflows/ci.yml`, steps `E2E tests` and `Licensing persistence live PostgreSQL suite`).
- **GitHub CI for this commit:** reported in section E for the final SHA only; no earlier run is used as evidence.

---

## E. GitHub report

_(Fill-in values below are the ones recorded when this branch was pushed; the CI row states the run for this exact SHA.)_

| Item                            | Value                                               |
| ------------------------------- | --------------------------------------------------- |
| Repository                      | `https://github.com/MR-AliEsmaeili/Vardena`         |
| Base                            | `main` @ `24608f03baa3da941ec18d06995fb5ef95267418` |
| Working branch                  | `arena/3c88d285-vardena`                            |
| Commit                          | see the final commit on the branch (`git log -1`)   |
| Pull request                    | see `gh pr list --head arena/3c88d285-vardena`      |
| CI on `main` before this branch | `success` (run `39506001448`, 4m44s)                |
| CI on this commit               | see the run for the branch head                     |

---

## F. Step-by-step usage guide

### F.1 Start the Owner backend

```bash
cd owner-licensing/backend
cp .env.example .env            # set OWNER_DATABASE_URL, OWNER_PUBLIC_ORIGIN, OWNER_AUDIT_ARCHIVE_DIR,
                                # OWNER_BOOTSTRAP_USERNAME, OWNER_BOOTSTRAP_PASSWORD
npm ci
npm run migrate                 # applies 001…007 to the dedicated Owner database
npm run bootstrap               # creates the first Owner Admin once; never overwrites existing credentials
npm run dev                     # http://0.0.0.0:3001
```

Never point `OWNER_DATABASE_URL` at a customer database; the migrator refuses known customer schemas as defense in depth.

### F.2 Start the Owner frontend

```bash
cd owner-licensing/frontend
npm ci
npm run dev                     # http://0.0.0.0:5174, proxies /api → the Owner API
```

For a remote preview set `OWNER_PUBLIC_ORIGIN` to the exact preview origin and, if the preview host is not loopback, `OWNER_VITE_BIND_HOST=0.0.0.0` plus `OWNER_VITE_ALLOWED_HOSTS=<exact host>`. The browser always uses a relative `/api/v1` base URL.

### F.3 Sign in and provision

1. Open `/login` with the bootstrap username/password → the forced password change screen appears; complete it. Until then every ordinary API call is refused.
2. As Owner Admin open `/app/users`, create a `License Operator`, then grant the permissions that operator actually needs (`licenses.view`, `licenses.issue.time_limited`, …). A new operator starts with **no** effective permission (OD-LIC-12).

### F.4 Create a customer

`/app/customers/new` → enter the stable `customerCode` (immutable afterwards) and the display name → save. Open the record.

### F.5 Register the customer's installation and (optionally) a ceiling

1. On the customer record, _installation identities_ → enter the `installationId` shown on the customer's Vardena license screen, **re-enter it** in the confirmation field, tick the acknowledgement and save. The confirmation is an operator claim, not a cryptographic proof; the screen says so.
2. _Limit profiles_ → set organization/user ceilings, the allowed modules and whether a perpetual license is permitted. Ceilings are immutable after creation; retire/reactivate instead of editing.

### F.6 Issue a license

1. `/app/licenses` → the prepare form. Pick the customer (search), the registered installation and an **active** signing key; choose time-limited or perpetual; the end date is entered in Jalali and stored as one canonical UTC instant; select modules/limits within the active ceiling.
2. _Review_ shows exactly what will be signed → confirm. The server returns the two digests:
   - `request_payload_sha256` — check this out of band with the signer **before** it loads the key;
   - `request_binding_sha256` — the import binds the signed artifact to this request.
3. Download the unsigned request file and take it to the offline signer. The private key never touches this application.

### F.7 Import the signed artifact and download it

1. Back on the issuance card, import the signed file. The server verifies envelope, signature, trust list, signing-key status, operation identity and the binding digest before recording anything; a duplicate returns the historical result and writes nothing.
2. Download the archived signed artifact — this is the exact byte copy stored outside PostgreSQL. It is what you hand to the customer (USB, e-mail, any channel).

### F.8 Import it into Vardena (customer side)

1. On the customer installation, sign in as a user with `Licensing.License.Activate`.
2. License screen → choose the file → _ورود مجوز_. The client posts the file text; the backend verifies it and the application re-reads `GET /license/current`. The workspace is released only on that re-read.
3. Confirm the status card: window, limits, modules, and the operation id of the governing version (quote that id back to the Owner for a renewal).

### F.9 Renew or replace

From the issuance card in the Owner UI choose _renew_ or _supersede_ (Owner Admin only; the backend re-checks). The new request carries `renewsOperationId` / `supersedesOperationId`. A renewal keeps the same customer and installation, gets a new `licenseId`/`operationId`, and its `validFrom` is the end of the renewed term, so importing it early does not shorten the current period.

### F.10 Revoke (both sides)

1. Owner: issuance card → revocation → reason (+ detail for `OTHER`) → _prepare_. Download the unsigned revocation request, sign it offline, import the signed `VREV1` document, then download the archived bytes.
2. Customer: license status card → _ثبت سند ابطال امضاشده_ → select the file → submit. The backend verifies signature, canonical form, installation/customer/license binding and staleness, marks that license revoked and writes the audit event in one transaction. The workspace is blocked on the next `GET /license/current`. Re-importing an old license file does **not** restore access; a new issuance is required. Re-importing the same revocation is reported as already applied.

### F.11 Check expiry and Read-Only

The status card shows the validity window and the coverage end. After the end of coverage the installation runs in the 14-day grace window, then Read-Only: login, viewing, printing, Excel export, database backup, status and renewal keep working; mutating operations are refused **by the backend**, not by a hidden button.

---

## G. Decision summary

1. **Is the mission actually complete?** For everything this branch claims: yes — the Owner prepares, signs (offline), archives and hands over a file; the customer verifies, activates and enforces; renewal, supersession and signed revocation are recorded and audited; the customer can import a revocation. Measured by the criterion "a usable end-to-end cycle, not file count": the cycle exists and is covered by executed tests on both sides, and by the cross-implementation check in B.4. It is **not** claimed complete for the customer backend's live-DB suites, which could not be executed in this sandbox.
2. **Is CI green on the final commit?** See section E — the value recorded there is for the exact branch head, not for an earlier commit. `main` was green before this branch.
3. **Open Product-Owner decisions?** None block what is implemented here. The genuine open items are the ones already recorded in `docs/open-questions.md` and unchanged by this work: OQ-82 (server-replacement protocol), OQ-84 (activation receipts — closed as "not required"), OQ-76 (clock-integrity evidence), the installation-identity key (designed only) and the deployment-owner items for the artifact backup medium and a production-sized restore rehearsal. No business policy was invented: where the repository had a decision, it was followed; where it had none, no behaviour was added.
