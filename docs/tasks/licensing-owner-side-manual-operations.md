# Owner manual licensing observations

> **Policy correction and Phase 1.3 RBAC update (2026-10-16):** this is evidence
> of the operator-observation slice only. PDR-17 now requires the replacement
> server be activated before manual old-server decommission, pending auditable
> confirmation, with configurable 1h–7d confirmation expiry (24h default); the
> row/API here does not prove decommission or implement that expiry. OQ-75's two
> roles (`OWNER_ADMIN` and `LICENSE_OPERATOR`) supersede the historical four-role
> table and are now enforced in `003-two-role-authorization.sql`, API, and UI;
> OQ-77 requires append-only retention for at least three years from each event's
> occurrence (not an automatic purge deadline), excludes unresolved security
> incidents from automatic deletion, and retains the previously approved
> permanent separate archive. These policies supersede the historical
> no-retention-decision text. See PDR-11 §21 and the current OQ registry. No
> remote customer-server contact or shutdown is implied.

Date: 2026-10-15 (updated 2026-10-16 for Phase 1.3 two-role authorization).
Status: implementation submitted for exact-head CI and review.
This is not Product Owner acceptance, operational rollout, or permission to merge.
Phase 1.3 implements the OQ-75 two-role authorization (`OWNER_ADMIN` and
`LICENSE_OPERATOR`, with `replacements.authorize` restricting server-replacement
and emergency old-server-lost authorization to `OWNER_ADMIN`). This code
snapshot does not implement automatic OQ-77 archive/purge execution, the OQ-82
new-server-first sequence/confirmation window, or the OQ-83 manual Owner Admin
device workflow. OQ-84 is product-closed; ordinary activation has no mandatory
separate signed receipt. OQ-78/OQ-85 protocol/deployment evidence and OQ-74 key
security remain separate open implementation/design follow-ups.

## What this slice is

An Owner operator can record two facts about an existing customer:

- An externally observed license issuance, then an operator-confirmed activation.
  The only transition is `ISSUED` → `ACTIVATED`.
- A same-customer server replacement: authorization, an observed old-server
  state, then an observed replacement installation. Emergency old-server loss
  records the authorization and the unavailable state together. It does not
  require a response from the old server.

Every stored confirmation is `OPERATOR_OBSERVED`. API responses also say
`cryptographicVerification=NOT_IMPLEMENTED`, `signedArtifactProduced=false` and
`customerServerContacted=false`. The UI repeats that this is not a receipt,
not cryptographic proof, and not client-device replacement.

## What this slice is not

No production signing key or signer. No VLIC1, VLIC2, VDEA1, VDRQ1 or VDRP1
artifact. No signed receipt or signed refusal. No customer contact, callback,
synchronization, database change or runtime change. No client-device
replacement. No offline revocation or recovery artifact. This code snapshot has
no second-person approval mechanism; that is implementation evidence, not a
current role-policy decision. This code snapshot has no audit purge/retention enforcement; current OQ-77
retention policy is stated above. No cancellation, renewal, revocation or recovery
state is implemented in this observation slice; those transitions are not
specified here, so none is invented. An abandoned non-terminal replacement
therefore keeps its installation slot in this implementation snapshot.

## Authorization

Deny by default. No wildcard. Enforced under the two-role MVP model (`OWNER_ADMIN`
and `LICENSE_OPERATOR`, superseding the historical four-role table):

| Action | `OWNER_ADMIN` (Owner Admin) | `LICENSE_OPERATOR` (License Operator) |
| --- | --- | --- |
| Inspect records and history (`operations.view`) | yes | yes |
| Record a license observation or follow-up observation (`operations.record`) | yes | yes |
| Authorize a server replacement or emergency old-server loss (`replacements.authorize`) | yes | no (`403 PermissionDenied`, audited as `OPERATION_MUTATION_DENIED`) |

Missing `operations.record` or `replacements.authorize` on a mutation route writes
`OPERATION_MUTATION_DENIED` and commits 403. Hiding a button is not
authorization. First-login restriction still blocks ordinary work before that
check. Superseded four-role identifiers are rejected in API and SQL.

## Persistence

`owner-licensing/backend/migrations/002-manual-operations.sql` extends the
foundation tables when empty, and `003-two-role-authorization.sql` replaces the
historical `users_role_check` constraint with `CHECK (role IN ('OWNER_ADMIN',
'LICENSE_OPERATOR'))` after failing closed (`ERRCODE = '23514'`, listing the
legacy roles present) if any superseded role row exists. On a populated pre-003
database, automatic `npm run migrate` rolls back cleanly without modifying
`public.owner_migrations` or `users_role_check`; operators inspect affected
accounts with `npm run migrate:preflight` and apply an explicitly authorized
disposition plan with `npm run migrate:remediate-roles -- <dispositions.json>`,
which updates `owner.users`, revokes pre-upgrade sessions, appends
`USER_LEGACY_ROLE_REMEDIATED` audit rows, and applies `003` in one PostgreSQL
transaction. `001-foundation.sql` and `002-manual-operations.sql` are
unchanged to preserve applied migration checksums. Runtime needs
SELECT/INSERT/UPDATE on
`owner.operational_records` and SELECT/INSERT on
`owner.operational_transitions`. It must not receive DELETE, TRUNCATE, or
transition UPDATE/DELETE. No SQL role name is invented.

Uniqueness is per customer installation for a license observation, and per old
and new installation for a replacement. An unfinished replacement also blocks
reuse of either installation on the other side; the database trigger and the
service use the same rule, and the customer row is locked so two conflicting
inserts cannot both succeed. A completed A→B may be followed by B→C. PDR-17
does not decide whether a replaced reference may later be used as a replacement
target, so that ban is not invented. Direct inserts cannot skip the initial
issuance, authorization, or emergency state. `updated_by` cannot change unless
the observed status changes. History must start at `UNRECORDED`; each later
`prior_status` must equal the previous `new_status`; and the stored sequence
must be exactly the legal path to the current state. A direct write cannot
forge a prior status, skip a step, reorder history, or append after that path
is complete. The completing transition's actor must match `updated_by`. An
emergency row may be inserted already at `OLD_SERVER_STATE_RECORDED`, but both
ordered transitions must still be written in that transaction. History remains
append-only. A failed audit write rolls back the mutation.

## API

All paths are under `/api/v1`.

- `GET /operational-records`
- `GET /operational-records/:id`
- `POST /operational-records/license-observations`
- `POST /operational-records/:id/activation-observations`
- `POST /operational-records/server-replacements`
- `POST /operational-records/:id/old-server-observations`
- `POST /operational-records/:id/replacement-observations`

Stable codes include `InvalidTransition`, `DuplicateOperation`,
`PermissionDenied` and `EntityNotFound`. Signed protocol paths stay 404.

## Acceptance evidence

| Requirement | Local result | Verification location |
| --- | --- | --- |
| Transition rules and duplicate-constraint mapping | `owner-licensing/backend` unit file passed | Existing backend job |
| Role grants, first-login denial, license/replacement/concurrency/audit rollback and all four roles | Not run locally; live PostgreSQL is CI-only | `owner-licensing/backend/test/api.test.ts` in the existing backend job |
| Direct SQL history continuity, emergency pair, forged prior, and rollback | Not run locally; live PostgreSQL is CI-only | `owner-licensing/backend/test/api.test.ts` in the existing backend job |
| Persian form contract and confirmation checkbox | Focused frontend Vitest passed | Existing frontend job |
| Observer hides mutation controls; Support cannot open records; submit uses selected customer id | Focused frontend flow file passed | Existing frontend job |
| Owner backend lint, format, typecheck and 10 unit tests | Passed locally on 2026-10-15; no warnings. PostgreSQL suite not run locally | Existing backend job repeats lint/typecheck/unit and runs `api.test.ts` |
| Owner frontend lint, format, typecheck, schema test, operations flow and existing owner flow | Not re-run for this history correction | Existing frontend job |
| Migration rehearsal, Docker and customer suites | Not run locally | Existing CI jobs only |

No local result is transferred to a later commit. Exact-head CI is the review
gate. `READY FOR REVIEW` is not claimed until that run is green on the final
PR head.
