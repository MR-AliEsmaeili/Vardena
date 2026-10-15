# Owner API

Setup, migration/bootstrap, security, API and deployment instructions are in
[the independent Owner README](../README.md). This package never consumes the
customer database, runtime modules, migrations or credentials.

## Audit explorer contract

`GET /api/v1/audit-events` requires `audit.view` (Administrator, Issuance
Specialist and Observer; Support receives 403 `PermissionDenied`). It is
read-only; no edit, delete or purge route exists.

Query parameters. Each filter is optional, and an empty filter value means "not
supplied". `page` is strict: when present it must match the table, so `page=` is
400.

| Parameter | Accepted value | Match |
| --- | --- | --- |
| `page` | `1`–`999999` | page number, 50 rows per page |
| `eventType` | `^[A-Z][A-Z0-9_]{0,119}$` | exact |
| `actorId` | ULID | exact |
| `targetType` | `Customer`, `OperationalRecord`, `User` | exact |
| `targetId` | ULID | exact |
| `outcome` | `SUCCESS`, `DENIED` | exact |
| `occurredFrom` | `YYYY-MM-DDTHH:MM:SS` + optional 1–3 digit fraction + `Z` | inclusive lower bound |
| `occurredBefore` | same instant format | exclusive upper bound, later than `occurredFrom` |

- Filters combine with AND. No substring search exists, so there is no LIKE and
  no LIKE escaping.
- Unknown keys, repeated keys, values outside the rules above, impossible
  calendar instants, offsets, leap seconds, and out-of-range pages return 400
  `ValidationFailed`. Authorization is checked first.
- Rows are ordered by `sequence DESC`. `sequence` is unique, so it breaks ties
  between rows with the same `occurredAt`.
- The response is `{ items, page, pageSize: 50, hasNext }`. `hasNext` comes from
  fetching 51 rows. There is no total count.
- Each item is `{ id, actorId, eventType, targetType, targetId, occurredAt,
  outcome, reason, beforeState, afterState }`. The two state objects pass through
  a 22-key allowlist, keeping scalars and string arrays only. Hashes, tokens and
  unknown keys are never returned.
- Indexes: no new index. The existing `audit_target(target_type, target_id,
  sequence DESC)` serves exact target trails. Any future index needs a new
  additive migration; `001` and `002` are not edited.

Implementation: `src/audit.ts` (parsing, projection, parameterized list) and the
route in `src/app.ts`. Tests: `test/audit-query.test.ts` (pure, in `npm test`)
and the explorer cases in `test/api.test.ts` (PostgreSQL, `test:integration`).
