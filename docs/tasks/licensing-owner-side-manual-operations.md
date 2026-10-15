# Owner manual licensing observations

Date: 2026-10-15. Status: implementation submitted for exact-head CI and review.
This is not Product Owner acceptance, operational rollout, or permission to merge.
It does not close OQ-75, OQ-77, OQ-78, OQ-82, OQ-83, OQ-84, OQ-85 or U-1.

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
replacement. No offline revocation or recovery artifact. No second-person
approval. No audit purge or invented retention period. No cancellation,
renewal, revocation or recovery state: those transitions are not defined, so
they are not invented. An abandoned non-terminal replacement therefore keeps
its installation slot.

## Authorization

Deny by default. No wildcard.

| Action | Administrator | Issuance Specialist | Observer | Support |
| --- | --- | --- | --- | --- |
| Inspect records and history | yes | yes | yes | no |
| Record an observation | yes | yes | no | no |

Missing `operations.record` on a mutation route writes
`OPERATION_MUTATION_DENIED` and commits 403. Hiding a button is not
authorization. First-login restriction still blocks ordinary work before that
check. Support keeps identity/status customer reads only.

## Persistence

`owner-licensing/backend/migrations/002-manual-operations.sql` is additive.
`001-foundation.sql` is unchanged. The migration refuses to extend a table that
already contains rows. Runtime needs SELECT/INSERT/UPDATE on
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
the observed status changes. The latest transition must match the current
state and updater, and another transition for that state is rejected. History
remains append-only. A failed audit write rolls back the mutation.

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
| Persian form contract and confirmation checkbox | Focused frontend Vitest passed | Existing frontend job |
| Observer hides mutation controls; Support cannot open records; submit uses selected customer id | Focused frontend flow file passed | Existing frontend job |
| Owner backend lint, format, typecheck and 9 unit tests | Passed locally on 2026-10-15; no warnings | Existing backend job repeats them |
| Owner frontend lint, format, typecheck, schema test, operations flow and existing owner flow | Passed locally: 15 focused tests | Existing frontend job also runs the full Owner UI suite and build |
| Migration rehearsal, Docker and customer suites | Not run locally | Existing CI jobs only |

No local result is transferred to a later commit. Exact-head CI is the review
gate. `READY FOR REVIEW` is not claimed until that run is green on the final
PR head.
