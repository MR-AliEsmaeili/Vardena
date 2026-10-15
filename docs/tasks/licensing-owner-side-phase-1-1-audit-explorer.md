# Owner Phase 1.1 — audit explorer and observation traceability

Date: 2026-10-15. Status: implementation submitted for exact-head CI and review.
This is not Product Owner acceptance, operational rollout, or permission to merge.
It does not close OQ-75, OQ-77, OQ-78, OQ-82, OQ-83, OQ-84, OQ-85 or U-1.
It does not change PDR-17's role matrix or ADR-0048's boundary.

## What this slice is

- `GET /api/v1/audit-events` gains bounded, exact-match filters, a deterministic
  page with an additive `hasNext` flag, and an explicit response projection.
- The Persian audit page gets a filter form with explicit apply and reset. The
  applied filters live in the URL, so refresh, deep links and browser history
  show the same result. Changing filters returns to page one.
- Operational records and customers link to their exact audit trail
  (`targetType` + `targetId`). The links are shown only to holders of
  `audit.view`.
- Audit event labels are Persian. Observation events carry the note that they
  record an operator observation. They are not cryptographic confirmation, and
  they do not show that the customer server was contacted.

## What this slice is not

No edit, delete, purge or export endpoint. No second audit log, no new state
machine, no new role or permission, no change to the authentication policy, no
substring/full-text search, no new migration, no new index, and no change to any
signer, protocol, customer-side or migration-history file. No retention rule is
invented (OQ-77 stays open). No cancellation, renewal, revocation or recovery
state is added.

## Query contract

All parameters are optional. An empty value is treated as absent. Unknown keys,
repeated keys, values outside the allowlists, and wildcard or SQL-like input
return 400 `ValidationFailed` before any SQL is built. An unauthorized caller gets
403 `PermissionDenied` before validation runs.

| Parameter | Rule | Semantics |
| --- | --- | --- |
| `page` | `^[1-9][0-9]{0,5}$` | 50 rows per page |
| `eventType` | `^[A-Z][A-Z0-9_]{0,119}$` | exact match on the stored event code |
| `actorId` | ULID | exact match |
| `targetType` | `Customer`, `OperationalRecord`, `User` | exact match |
| `targetId` | ULID | exact match |
| `outcome` | `SUCCESS`, `DENIED` | exact match |
| `occurredFrom` | canonical UTC instant ending in `Z` | inclusive lower bound |
| `occurredBefore` | canonical UTC instant ending in `Z` | exclusive upper bound; must be later than `occurredFrom` |

Filters combine with AND. Instants must be on the real calendar (no February 31,
no leap second) and in years 1000 through 9999, and must not carry an offset. The
backend checks the year-1000 minimum explicitly, before `Date.UTC`, because
`Date.UTC` maps years 0–99 onto 1900–1999. The frontend `isCalendarDay` and the
audit filter schema apply the same rule, so the UI and the API agree. Ordering is
`sequence DESC`. `sequence` is UNIQUE and monotonic, so it is a total order and
serves as the tie-breaker when several rows share `occurred_at`. The query fetches
51 rows: 50 are returned, and the 51st sets `hasNext`. The response has no `total`,
because a count over the append-only table is not computed.

Each value is passed as a positional parameter. Filter input is never concatenated
into SQL. No LIKE is used, so no LIKE escaping applies. Wildcard characters are
rejected as malformed values rather than escaped.

Response items contain exactly `id`, `actorId`, `eventType`, `targetType`,
`targetId`, `occurredAt`, `outcome`, `reason`, `beforeState`, and `afterState`.
The before and after state is passed through a 22-key allowlist. Only scalars and
string arrays are kept. Hashes, tokens, and unknown or nested keys are dropped on
read, even if a future writer stores them.

The UI converts the calendar-day range to UTC: `from` becomes `00:00:00Z`, and
`to` becomes the start of the following UTC day (exclusive). The UI labels the
dates as UTC.

## Authorization

| Action | Administrator | Issuance Specialist | Observer | Support |
| --- | --- | --- | --- | --- |
| Audit explorer, any filter | yes | yes | yes | no (403) |
| Operational trail link from a record or customer | yes | yes | yes | no |

Support gets 403 even when it supplies only the new parameters, and even for a
valid `actorId` or `targetId`. No identifier lookup exists for audit rows
(`/audit-events/:id` returns 404 for every role). A password-change-pending
credential is denied before the query runs. The client-supplied `actorId` is a
filter only and never becomes the caller's identity.

## Persistence and indexes

No migration is added. `001-foundation.sql` and `002-manual-operations.sql` are
unchanged. The only index is still `audit_target(target_type, target_id,
sequence DESC)`, which serves exact target trails. Other filters walk the UNIQUE
`sequence` index in reverse and apply the predicates. No index is added on
speculative evidence. If production volume shows that the actor or event-type
filter needs its own index, that must be a new additive migration. It must not
edit a migration that is already applied.

## Observation wording

Stored observations are `OPERATOR_OBSERVED`. The audit labels for the four
observation events say "مشاهده" (observation) and say that the event is not a
receipt or a signature. The tests check that the copy contains no proof wording,
such as "verified" or "proof", and no claim that a signature was produced or that the customer server was contacted.

## Acceptance evidence

| Requirement | Local result (2026-10-15) | Verification location |
| --- | --- | --- |
| Owner backend lint, format, typecheck | Passed: 0 warnings/errors, format clean, `tsc --noEmit` exit 0 | Existing backend job repeats these on the PR head |
| Backend pure unit files (`unit`, `domain-operations`, new `audit-query`) | 43 of 43 passed | Existing backend `npm test` |
| Filter reject table, UTC instant rules, parameter binding, projection, hasNext, allowlist | Included in the 42 passed | `test/audit-query.test.ts` in `npm test` |
| PostgreSQL explorer: AND semantics, half-open window, tie-break and paging, LIKE-free hostile inputs, secret-key projection, role matrix (all four roles), direct-ID denial, trail links | Not run locally (live PostgreSQL is CI-only) | `test/api.test.ts` in `test:integration` |
| Frontend lint, format, typecheck | Passed: 0 warnings/errors, format clean, `tsc --noEmit` exit 0 | Existing frontend job repeats these |
| Frontend pure tests (URL state and well-formedness, UTC mapping, schema, Persian copy) | 49 of 49 passed | `audit-filters.test.ts` in `npm test` |
| Audit page flow: forbidden, apply/reset, URL coherence, invalid input, repeated/unknown/malformed URL, empty/error, pagination, observation copy, customer link | Not run locally (jsdom flow; CI only) | `audit-page.test.tsx` in `npm test` |
| Migration rehearsal, Docker, E2E, customer suites | Not run locally | Existing CI jobs only |

No local result is carried to a later commit. Exact-head CI is the review gate.
`READY FOR REVIEW` is not claimed until the run on the final PR head is green.

## Open questions (unchanged)

OQ-75, OQ-77 (retention), OQ-78, OQ-82, OQ-83, OQ-84, OQ-85 and U-1 stay OPEN.
Retention, the external evidence source, and the cryptographic protocol are still
undecided. Nothing in this slice decides them.

## Review follow-up (PR #162)

An independent review of the PR diff found these items:

- **Repeated, unknown or malformed URL parameters were silently reinterpreted in
  the UI.** `?eventType=A&eventType=B` used `A`, `?actor=…` (a typo) was ignored,
  and `?page=abc` showed page one under the same URL. The backend rejects all three
  with 400, so the UI could show results that differed from what the URL states.
  Fixed: a URL the backend would reject is not queried, and the page shows the
  invalid-filters message. Regression tests: `audit-filters.test.ts` (run locally)
  and `audit-page.test.tsx` (CI).
- **Latent: the UTC day helper mis-computed years 0–99.** `Date.UTC` maps them onto
  1900–1999, so the exclusive end of `0099-12-31` came out as `2000-01-01`. The UI
  schema rejects those years first, so this was not reachable from the UI. Fixed
  with `setUTCFullYear`. Regression test in `audit-filters.test.ts`.
- **Documentation inaccuracy.** The backend README said every parameter treats an
  empty value as absent. That is true for filters but not for `page`, which the
  shared `page()` helper rejects with 400. The README is corrected, and a
  characterization test locks in `page=` → 400.
- **Date-validation contract mismatch.** The documented rule is "no year below
  1000", but neither side enforced it. The round-trip check only caught years 0–99
  (by accident, because `Date.UTC` remaps them), so year 0999 was accepted by the
  backend and the frontend. Fixed: an explicit minimum-year check in
  `utcInstant()` (backend, 400 `ValidationFailed`) and in `isCalendarDay()`
  (frontend, which the schema uses, with its own Persian message). Regression
  tests: backend `audit-query.test.ts` covers 0000, 0050, 0099 and 0999 (both
  bounds), a valid year-1000 boundary, and year-1000 leap rollover, and asserts
  the error message. Frontend `audit-filters.test.ts` covers the same, and
  `audit-page.test.tsx` covers a `from=0999-01-01` URL.
- **Test label accuracy.** The case previously labelled "year below 1000" was
  renamed to say what it tested, and the cases for years 0099 and 0999 were added.

Not changed, and recorded as limits for a decision:

- **Deep pagination cost.** `page` accepts up to 999999, so `OFFSET` can reach about
  49,999,950 rows. Any holder of `audit.view` can request such a page, and the
  database has to walk past every earlier row. The existing customer and operation
  lists use the same bounded-offset pattern. A page-depth cap or keyset pagination
  would change the contract, so this needs a Product Owner or technical decision.
- **Rare filters scan the table.** There is no index on `event_type`, `actor_id`,
  or `outcome`. A filter that matches little forces a backward walk of the
  `sequence` index over the whole append-only table. An index would have to be a
  new additive migration. No index is added until measured evidence shows the need.
- **External review status.** The Codex code review on the PR head reported a
  failure with a usage-limit message and published no findings. See the PR
  follow-up report for details.

## Known limits

- The audit trail is append-only to the application, but it is not tamper-proof
  against database owners. This was already documented and is unchanged.
- No count is shown. Paging is next/previous only.
- See "Review follow-up" above for the deep-pagination and rare-filter limits.
