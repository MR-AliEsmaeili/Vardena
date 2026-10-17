# Owner API

Setup, migration/bootstrap, security, API and deployment instructions are in
[the independent Owner README](../README.md). This package never consumes the
customer database, runtime modules, migrations or credentials.

## Audit explorer contract

`GET /api/v1/audit-events` requires `audit.view` (granted to `Owner Admin` and
`License Operator`; denied without `audit.view` or while `mustChangePassword` is
true). It is read-only; no edit, delete or purge route exists.

Query parameters. Each filter is optional, and an empty filter value means "not
supplied". `page` is strict: when present it must match the table, so `page=` is
400.

| Parameter | Accepted value | Match |
| --- | --- | --- |
| `page` | `1`–`999999` | page number, 50 rows per page |
| `eventType` | `^[A-Z][A-Z0-9_]{0,119}$` | exact |
| `actorId` | ULID | exact |
| `targetType` | `Customer`, `OperationalRecord`, `User`, `AuditArchiveBatch` | exact |
| `targetId` | ULID | exact |
| `outcome` | `SUCCESS`, `DENIED` | exact |
| `occurredFrom` | `YYYY-MM-DDTHH:MM:SS` + optional 1–3 digit fraction + `Z` | inclusive lower bound |
| `occurredBefore` | same instant format | exclusive upper bound, later than `occurredFrom` |

Instants must be real calendar instants in years **1000 through 9999**. A year
below 1000 is rejected with 400 `ValidationFailed` ("must be a UTC instant in year
1000 or later."), checked explicitly before any `Date.UTC` call. `9999-12-31T23:59:59.999Z`
is the last instant the contract can express, so no exclusive `occurredBefore` can
follow `9999-12-31`; the UI rejects `to=9999-12-31` for that reason. Impossible dates
(for example 29 February 1000, which is not a leap year), leap seconds, and any
offset are also rejected.

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
  minimumRetainedUntil, securityIncident, incidentStatus, archived,
  archiveBatchId, outcome, reason, beforeState, afterState }`. The two state
  objects pass through an explicit allowlist, keeping scalars and string arrays
  only. Hashes, tokens and unknown keys are never returned.
- Indexes: `audit_target(target_type, target_id, sequence DESC)` serves exact
  target trails, and `004-audit-retention-archive.sql` adds
  `audit_events_retention_floor_idx(minimum_retained_until, sequence DESC)` and
  the separate `owner_audit_archive` schema (`archive_batches` and
  `archived_audit_events`). `001`, `002`, and `003` are not edited.
- Archive and retention management (`audit.archive`, `OWNER_ADMIN` only):
  `GET /api/v1/audit-archive/status` (optional `asOf` UTC instant; reports
  `durableStoreConfigured`, `durableStoreVerified`, `dbLedgerVerified`,
  `crossStoreConsistent`, `recoveryRequired`, and verified counts),
  `GET /api/v1/audit-archive/batches`,
  `GET /api/v1/audit-archive/batches/:id` (reads and verifies the bundle from the
  independent durable store `OWNER_AUDIT_ARCHIVE_DIR` and cross-checks the
  PostgreSQL ledger),
  `POST /api/v1/audit-archive/batches` (persists a write-once `0o444` `fsync`ed
  `batches/batch-XXXXXX-<id>.json` bundle and hash-chained `manifest.json` in
  `OWNER_AUDIT_ARCHIVE_DIR` together with the PostgreSQL `owner_audit_archive`
  ledger; reconciles pending durable batches on retry and rolls back both stores
  on failure; returns `503 ArchiveStorageUnavailable` if `OWNER_AUDIT_ARCHIVE_DIR`
  is unconfigured),
  `POST /api/v1/audit-archive/verify` (verifies on-disk `manifest.json` and
  `batch-*.json` files, PostgreSQL `owner_audit_archive` ledger, 1-to-1
  cross-store consistency, and `owner.audit_events` source records, and records
  `AUDIT_ARCHIVE_VERIFIED`), and
  `POST /api/v1/audit-archive/recover` (reconciles and restores missing
  `owner.audit_events` source records and `owner_audit_archive` ledger rows from
  the verified independent durable store after a PostgreSQL backup restore, or
  rehydrates missing untampered durable files from verified DB state, and records
  `AUDIT_ARCHIVE_RECOVERED`). Unauthorized attempts by `LICENSE_OPERATOR` record
  `AUDIT_ARCHIVE_ACCESS_DENIED` (`security_incident = true`, `incident_status =
  'UNRESOLVED'`) and return 403 `PermissionDenied`.

Implementation: `src/audit.ts` (parsing, projection, parameterized list gated by
verified durable batches), `src/archive.ts` (OQ-77 3-year retention evaluator,
incident hold validation, `FilesystemAuditArchiveStore` independent durable
persistence, separate archive batching, SHA-256 verification, and recovery), and
the routes in `src/app.ts`. Tests: `test/unit.test.ts` and
`test/audit-query.test.ts` (pure, in `npm test`) and the explorer/archive/recovery
cases in `test/api.test.ts` (PostgreSQL + filesystem store, `test:integration`).
