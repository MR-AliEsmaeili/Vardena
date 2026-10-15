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
no leap second, no year below 1000) and must not carry an offset. Ordering is
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
| Backend pure unit files (`unit`, `domain-operations`, new `audit-query`) | 42 of 42 passed | Existing backend `npm test` |
| Filter reject table, UTC instant rules, parameter binding, projection, hasNext, allowlist | Included in the 42 passed | `test/audit-query.test.ts` in `npm test` |
| PostgreSQL explorer: AND semantics, half-open window, tie-break and paging, LIKE-free hostile inputs, secret-key projection, role matrix (all four roles), direct-ID denial, trail links | Not run locally (live PostgreSQL is CI-only) | `test/api.test.ts` in `test:integration` |
| Frontend lint, format, typecheck | Passed: 0 warnings/errors, format clean, `tsc --noEmit` exit 0 | Existing frontend job repeats these |
| Frontend pure tests (URL state, UTC mapping, schema, Persian copy) | 39 of 39 passed | `audit-filters.test.ts` in `npm test` |
| Audit page flow: forbidden, apply/reset, URL coherence, invalid input, empty/error, pagination, observation copy, customer link | Not run locally (jsdom flow; CI only) | `audit-page.test.tsx` in `npm test` |
| Migration rehearsal, Docker, E2E, customer suites | Not run locally | Existing CI jobs only |

No local result is carried to a later commit. Exact-head CI is the review gate.
`READY FOR REVIEW` is not claimed until the run on the final PR head is green.

## Open questions (unchanged)

OQ-75, OQ-77 (retention), OQ-78, OQ-82, OQ-83, OQ-84, OQ-85 and U-1 stay OPEN.
Retention, the external evidence source, and the cryptographic protocol are still
undecided. Nothing in this slice decides them.

## Known limits

- The audit trail is append-only to the application, but it is not tamper-proof
  against database owners. This was already documented and is unchanged.
- No count is shown. Paging is next/previous only.
- Filter by actor or event type over a very large table may need an index. None
  is added now, and the need is not yet demonstrated.
