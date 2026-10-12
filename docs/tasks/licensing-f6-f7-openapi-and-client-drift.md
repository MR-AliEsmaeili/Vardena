# F-6 / F-7 — OpenAPI success schemas and generated-client drift check

Date: 2026-10-12.
Base: `main` at `9ac2cc58d3fef2659feaa867a2565a99e8e77102` (merge of PR #139).
This is an engineering follow-up. It does **not** start L-04, does **not**
change licensing policy, and does **not** close OQ-80 or OQ-86.

## F-6 — success-response schemas

Runtime shapes (unchanged):

- `GET /api/v1/license/current` returns `LicenseStateView` (`toLicenseStateView`).
- `POST /api/v1/license/activate` returns that view plus `changed` and
  `outcome` (`APPLIED` | `UNCHANGED`) — the same receipt as import.

OpenAPI:

- New `LicenseStateDto` implements `LicenseStateView` (existing
  `@ApiProperty` field set, including nullable date-times and nested
  `LicenseVersionSummaryDto`).
- Existing `LicenseImportResultDto` now **extends** `LicenseStateDto` and
  keeps `changed` / `outcome`. No second mutation DTO: activate reuses this
  class because the runtime receipt is the same.
- Controllers: `@ApiOkResponse({ type: LicenseStateDto })` and
  `{ type: LicenseImportResultDto }` respectively.

Verification:

- Unit: `backend/src/modules/licensing/api/license-openapi.contract.spec.ts`
  builds a Swagger document from the three licensing controllers and asserts
  the 200 `$ref`s and property sets (including that current-state has no
  `outcome`).
- E2E (GitHub CI): `license-import.e2e-spec.ts` and
  `license-state-route.e2e-spec.ts` assert `/api/docs-json` against a real
  response / documented property names.
- Generated client: `LicenseStateController_current_v1` 200 content is
  `LicenseStateDto`; activate 200 is `LicenseImportResultDto` (no longer
  `content?: never`).
- Frontend `contracts.ts` keeps narrower literal unions and compile-time
  assignability to both schemas.

## F-7 — CI drift check

Mechanism:

1. Build the backend (`npm run build`).
2. `npm run openapi:dump -- <file>` (`backend/src/tools/dump-openapi.ts`)
   boots Nest without listening, calls `buildOpenApiDocument` (same builder
   as `/api/docs`), writes JSON. `DATABASE_URL` is required by config
   validation; Prisma is lazy. Permission registry sync may warn if the
   Prisma client was not generated; the dump still completes.
3. `VARDENA_OPENAPI_SOURCE=<file> npm run api:types` in `frontend/`
   (pinned `openapi-typescript@7.13.0`).
4. `git diff --exit-code HEAD -- frontend/src/api/generated/vardena-api.d.ts`.

Wired as GitHub Actions job `generated-api-client` in `.github/workflows/ci.yml`
and as `scripts/check-generated-api-client.sh`.

Local proof (this checkout, before the generated file was committed): the
script failed with a diff adding `LicenseStateDto` and replacing
`content?: never` — the stale-client case. After committing the regenerated
file, the same script is expected to pass in CI.

Developer commands: `backend/README.md` (Swagger) and `frontend/README.md`
(`api:types`).

## Not in this PR

- L-04 capacity enforcement.
- Graphical Jalali calendar.
- OQ-80 / OQ-86, `license-binding-conflict` ratification, renewal identity,
  customer-transfer, deactivation.
- Migrations.
