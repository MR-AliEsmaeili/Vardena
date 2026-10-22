# Licensing completion — Owner ↔ Customer end-to-end (2026-10-21)

> **Historical report, not current Option C acceptance.** This records the earlier
> PR #191 work and its test/CI evidence. Its component suites and protocol-level
> interop check are not a combined Owner + customer dual-PostgreSQL acceptance run.
> The current-head audit (2026-10-22), explicit gap matrix, command record, manual
> checklist, and final status are in
> [`licensing-e2e-acceptance-2026-10-22.md`](licensing-e2e-acceptance-2026-10-22.md).
> The strict Option C status is **BLOCKED** until that audit's cross-app and manual
> acceptance evidence is supplied.

**Branch:** `arena/3c88d285-vardena` (from `main` @ `24608f03baa3da941ec18d06995fb5ef95267418`)
**Commits:** one code commit `52661f2b4a2ec6801ec8b6bed130bec2971d91d0`; every later commit is documentation only — see [section E](#e-github-report) for the commit list, the run that belongs to each SHA and the six CI jobs.
**Companion:** [pre-change audit](licensing-completion-audit-2026-10-21.md) — the capability matrix (O1–O16, C1–C8) this report closes.
**Environment:** Node.js 22.22.3, npm 10.9.8, no Docker, no system PostgreSQL. A disposable PostgreSQL 18.4 on `127.0.0.1:55432` (`owner_test`, `vardena_test`) was used for the database suites. Every number below was produced by a command executed on this branch; commands that could **not** run here are named as such and are not counted as evidence.

---

## A. Historical disposition for PR #191 (not strict Option C acceptance)

**The PR #191 implementation was reviewed on its then-current branch; this
historical status does not mean the current Option C acceptance flow is complete.**

The code contains the lifecycle components on both sides: Owner prepares a request
from persisted records, signs offline, imports and archives exact bytes; the customer
runtime imports, verifies and activates; customer services enforce limits and
Read-Only; Owner renewal/supersession and signed revocation workflows are recorded;
the customer can apply a signed revocation. The tests, however, are principally
Owner-side lifecycle tests, customer-side lifecycle tests, and a separate
protocol/domain interop script. They do **not** establish that one Owner-produced,
archived artifact was carried through both applications' real HTTP/service paths
while both disposable PostgreSQL databases were inspected in a single acceptance
run.

The former PR #191 CI results remain historical evidence for the tested PR head.
For current repository state, exact base CI evidence, local commands, the requirement
matrix, manual checklist, and outstanding gaps, see
[`licensing-e2e-acceptance-2026-10-22.md`](licensing-e2e-acceptance-2026-10-22.md).
No Product-Owner decision is outstanding for the product behavior already
implemented; the missing work is executable combined-flow evidence and human UI
acceptance, not a reopening of accepted decisions.

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

| Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Files                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New home dashboard rendering one server payload, with loading / retryable-error / genuine-empty states and a "needs action" list derived only from non-zero counts                                                                                                                                                                                                                                                                                                                                                                                          | `src/features/home/dashboard-page.tsx` (new), `src/features/home/dashboard-page.test.tsx` (new), `src/api/dashboard.api.ts` (new), `src/app/layouts/app-shell.tsx` |
| Revocation import now reports revocation wording, not license wording (the confirmation and the replay message name the revocation artifact)                                                                                                                                                                                                                                                                                                                                                                                                                | `src/features/licenses/prepared-panel.tsx`                                                                                                                         |
| Limit-profile retire/reactivate confirm the committed transition; installation-identity retirement explains that it is Owner-Admin-only instead of rendering no control                                                                                                                                                                                                                                                                                                                                                                                     | `src/features/customers/limit-profiles.tsx`, `installation-identities.tsx`                                                                                         |
| Preparing for an inactive customer is refused before the form is filled out (the backend refuses it anyway); the active-ceiling banner links to the customer record that owns the ceiling; `LimitProfileExceeded` gets its own copy                                                                                                                                                                                                                                                                                                                         | `src/features/licenses/prepare-issuance-form.tsx`                                                                                                                  |
| Translation cleanup: 4 keys that no longer had any caller removed (`o.licenses.customerId`, `installationIdentity`, `installationIdentityHelp`, `prepare` — left over from the pre-rewrite identifier form, whose `prepareHelp` copy is also replaced), and 9 keys that were dead but described a real behaviour wired to it: `o.licenses.revokeImportHint`, `revocationImportSuccess`, `revocationImportReplayed`, `customerInactive`, `profileManageLink`, `profileExceeded`, `o.installations.adminOnly`, `o.limitProfiles.retiredAction`, `reactivated` | `src/lib/owner-i18n.ts` plus the components in the rows above                                                                                                      |

### B.2 Customer application (`frontend/`)

The signed-revocation import surface (audit gap **C7**) is implemented end to end in the customer SPA:

| Change                                                                                                                                                                                                                                                                                                        | Files                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Licensing.License.Revoke` added to the closed permission vocabulary (matching `LICENSING_PERMISSIONS.LICENSE_REVOKE` in the backend)                                                                                                                                                                         | `src/features/permissions/permission-codes.ts`                                                                                                                                  |
| `importLicenseRevocation()` client call + request/result contracts with a compile-time guard against the generated OpenAPI schema                                                                                                                                                                             | `src/api/licensing.api.ts`, `src/api/contracts.ts`                                                                                                                              |
| File-first import form (file **or** pasted text, one 65536-character field, no client-side format/signature verdict), refusal copy classified by stable error code (`409` conflicting replay, `422` stale/refused, `400` invalid, `403` permission), correlation id as support data only                      | `src/features/licensing/revocation-import-form.tsx` (new), `license-revocation-schema.ts` (new), `license-revocation-errors.ts` (new), `use-import-license-revocation.ts` (new) |
| Mounted in the license status card behind `Licensing.License.Revoke`, and only while the license is not already revoked — a revoked license refuses every later artifact, so offering the form would imply a recovery path that does not exist                                                                | `src/features/licensing/license-status-card.tsx`                                                                                                                                |
| 19 Persian strings for the new surface (title, body, file/paste labels and hints, required/too-long, submit/submitting, success, already-applied, rejected, conflict, stale, forbidden, failed, invalid), deliberately distinct from the license-import copy                                                  | `src/lib/i18n.ts`                                                                                                                                                               |
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
- **GitHub CI:** section E lists, for every commit on the branch, the run that belongs to that SHA. A run is never used as evidence for a different commit.

---

## E. GitHub report

Every value below was read from GitHub for this branch (`gh pr view 191`,
`gh run list --branch arena/3c88d285-vardena`, `gh run view <id>`), not recalled
from an earlier session.

**One code commit.** `52661f2` carries every production change described in this
report — code, tests, migrations read-only, contracts. Everything committed on
this branch after it changes **only this file**, so the code that CI exercises is
byte-identical in all runs below (`git diff 52661f2 <any later commit>` touches
one Markdown file).

| Item                                                     | Value                                                                        |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Repository                                               | `https://github.com/MR-AliEsmaeili/Vardena`                                  |
| Base                                                     | `main` @ `24608f03baa3da941ec18d06995fb5ef95267418`                          |
| Working branch                                           | `arena/3c88d285-vardena`                                                     |
| Pull request                                             | [#191](https://github.com/MR-AliEsmaeili/Vardena/pull/191) — open, mergeable |
| **Code commit** — every production change in this report | `52661f2b4a2ec6801ec8b6bed130bec2971d91d0`                                   |
| CI on `main` before this branch                          | `success` — run `39506001448`, 4m44s                                         |

### E.1 Commits on the branch, oldest to newest

Each row names **its own** SHA and **its own** run. `docs` = documentation only.

| #   | SHA                                        | Kind     | CI run (workflow `CI`, event `pull_request`)                                        | Result      | Jobs                                                                                      |
| --- | ------------------------------------------ | -------- | ----------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| 1   | `52661f2b4a2ec6801ec8b6bed130bec2971d91d0` | **code** | [`39645730522`](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39645730522) | **success** | `classify`, `generated-api-client`, `docs`, `frontend`, `backend`, `ci-gate` — six of six |
| 2   | `784a1e3e734a47ec262cab00215841e3952c5cfd` | docs     | [`39646710255`](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39646710255) | **success** | the same six jobs                                                                         |
| 3   | `605446849c9e2bc1012d362774c28776942f91da` | docs     | [`39647746919`](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39647746919) | **success** | the same six jobs                                                                         |
| 4   | `dc8a1ab1349a71945112beb3ef65e27f53a73f5b` | docs     | [`39651435273`](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39651435273) | **success** | the same six jobs                                                                         |

Row 4 was the head when this table was last filled in. The commit that publishes
this revision is itself row 5 — a documentation-only commit, identical in code to
row 1 — and its run appears on the pull request's checks list next to the branch
head.

### E.2 How to read the head without trusting this file

A commit cannot contain its own SHA, so any table written inside the repository
is one documentation-only commit behind the branch head. The binding rule that
makes the table sufficient anyway:

- the **only** commit that changes code is row 1, and every later commit is
  verified to touch no file other than this report;
- therefore the code under test never changes after row 1, and each row's green
  run is a green run of that same code;
- the authoritative head is whatever GitHub reports, together with the checks
  rendered on the pull request page.

Reproduce those two facts with:

```bash
git diff --stat 52661f2 HEAD     # one file: this report
gh pr view 191 --json headRefOid # the current head
```

No SHA is described in this report as "the final commit" while a later commit
exists, and no run is attributed to a commit other than the one it ran on.

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

## G. Historical decision summary (PR #191 scope only)

1. **Does this report establish strict Option C acceptance?** No. It records separate Owner and customer test evidence plus a domain-level protocol interop check. It does not prove one persisted Owner issuance artifact passed through both applications' real endpoints while both disposable PostgreSQL databases were checked. The current strict status is **BLOCKED**; see [`licensing-e2e-acceptance-2026-10-22.md`](licensing-e2e-acceptance-2026-10-22.md).
2. **Were checks green for the earlier PR #191 code?** The historical run list in section E belongs to the prior PR branch. Current base CI evidence is recorded by exact SHA and run URL in the 2026-10-22 acceptance audit; those checks do not supply a combined cross-app test.
3. **Are product decisions reopened?** No. Existing PDR-19, PDR-14, PDR-16, PDR-18 and the revocation protocol remain controlling. The remaining work is combined integration evidence and a human Persian RTL acceptance record, not new product policy.
