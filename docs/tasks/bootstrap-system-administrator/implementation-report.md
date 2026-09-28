# Bootstrap System Administrator — Implementation Report

Status: **READY FOR REVIEW — NOT ACCEPTED**
Date: 2026-09-26

## Task

Provision a real initial Vardena administrator through the existing Users,
Identity, RBAC, permission-registry, and Organization authorization paths. No
hardcoded login, password check, wildcard, hidden endpoint, permission bypass,
or organization bypass is introduced.

## Repository inspection and decision

The repository already supplied every required architectural mechanism:

- Users-domain account and Argon2id `PasswordService`;
- Identity username/password authentication and opaque sessions;
- code-owned `PermissionRegistry` plus the startup database mirror;
- ordinary Role → Permission → UserRole RBAC evaluation with no wildcard;
- Organization membership and the ODR-3 first-member grant for an empty
  organization;
- post-migration Docker initialization and live-PostgreSQL CI.

There was no seed/bootstrap script, forced-password-change field/contract, or
bootstrap Organization concept. The implementation extends the existing
system-context bootstrap posture and post-migration initialization without
changing runtime authorization architecture. This report records implementation
behavior only: it does not establish the bootstrap role as a product-level role
policy, create an Owner Decision, or resolve OQ-14/OQ-19. It does not invent an
organization. A fresh administrator creates the initial organization and uses
the already accepted first-member grant to obtain an ordinary membership.

## Implementation

`bootstrap:system-admin` loads the same application graph as the API so every
owning module registers its official permission definitions. It then:

1. synchronizes the code registry into `rbac.permissions`;
2. creates the ordinary Users record if absent, hashing the initial password
   with the existing Argon2id service;
3. creates/uses `System Administrator`;
4. inserts missing `role_permissions` for every current registry code;
5. inserts the ordinary `user_roles` assignment.

Steps 3–5 reconcile inside one RBAC transaction and rely on existing unique and
composite-primary-key constraints. Re-running the command does not duplicate
records. It deliberately does not reset an existing password or lifecycle
state; therefore a password changed after installation stays changed. A future
permission becomes part of the role when the post-migration bootstrap runs for
the release that registers it.

Docker Compose runs this command after `prisma migrate deploy` and before API or
worker startup. CI runs the same built command after migrating PostgreSQL.
There is no bootstrap API route.

## Required report

```text
Task: Bootstrap System Administrator
Branch: arena/01a0df57-vardena
Commit: 96e6b622c33db57e9289e6caf8b2cbb0a35af2c0 (implementation head)
Pull request: #64 — https://github.com/MR-AliEsmaeili/Vardena/pull/64

Bootstrap username: مدیر
Bootstrap password: 1 (initial installation credential; never emitted by CI/bootstrap logs)
Admin role: System Administrator

Permission count: 131 currently registered codes (derived from the runtime registry, not hardcoded)
Organization binding: no hardcoded/bootstrap organization; create the initial organization, then grant مدیر the ordinary first membership through ODR-3

Files changed: application bootstrap command/orchestrator; RBAC reconciliation service/repository; Docker/CI initialization; unit/live-DB tests; security/operations documentation
Migrations: none (existing tables and constraints are sufficient)
Seed/bootstrap mechanism: idempotent post-migration `npm run bootstrap:system-admin`; Docker Compose and CI invoke the same built command

Authentication verification: live-DB test covers exact credential success and wrong-password 401; safe response assertions included
Authorization verification: live-DB test covers complete effective registry plus Users, RBAC, Organization, Inventory, Documents, Workflow, and Accounting representative paths
Idempotency verification: unit tests plus repeated live-DB reconciliation assert 1 user, 1 role assignment, and the registry-sized permission set
Security verification: Argon2id hash verified; plaintext excluded from DB/API/error; no endpoint, wildcard, role-name runtime check, permission bypass, or organization bypass

Local tests: targeted 5/5; full backend unit 1,153/1,153; typecheck, lint (0 errors), format and build PASS
CI tests: PASS — run 36269856402; backend and frontend jobs green, including Prisma validate/generate, migration, built bootstrap command, migration rehearsal, and full E2E/live PostgreSQL

Known limitations: no forced-password-change infrastructure; operator must immediately use the existing password-reset API. OQ-19 self-disable/self-role-removal/last-admin lockout safety remains OPEN. A deployment pin whose organization does not yet exist still requires the existing out-of-band organization provisioning posture of ADR-0025.
Open decisions: OQ-14 remains OPEN for occupational roles, Accountant/Warehouse/Sales/Auditor baselines, auditor/administrator separation, and future role permission baselines. OQ-19 remains OPEN for administrator safety. The implemented role and provisioning procedure are implementation facts, not Owner Decisions; no bootstrap Organization decision was invented.

Status:
READY FOR REVIEW
```

## Test execution matrix

| Gate                                                 | Environment           | Result                                                                                                                                                    |
| ---------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Targeted bootstrap unit tests                        | Local FAST-LOCAL      | PASS — 2 files / 5 tests                                                                                                                                  |
| Full backend unit tests                              | Local FAST-LOCAL      | PASS — 103 files / 1,153 tests                                                                                                                            |
| Typecheck                                            | Local FAST-LOCAL      | PASS                                                                                                                                                      |
| Lint                                                 | Local FAST-LOCAL      | PASS — 0 errors; 6 pre-existing unrelated warnings                                                                                                        |
| Format check                                         | Local FAST-LOCAL      | PASS                                                                                                                                                      |
| Build                                                | Local FAST-LOCAL      | PASS                                                                                                                                                      |
| Prisma validate/generate                             | CI                    | PASS — run `36269856402` (local schema-engine download had failed because the sandbox could not establish TLS to `binaries.prisma.sh`; no schema changed) |
| Database migration and populated migration rehearsal | CI-LIVE-DB            | PASS — run `36269856402`                                                                                                                                  |
| Built bootstrap command against PostgreSQL           | CI-LIVE-DB            | PASS — run `36269856402`                                                                                                                                  |
| Full E2E including live bootstrap suite              | CI-HEAVY / CI-LIVE-DB | PASS — run `36269856402`                                                                                                                                  |
| Frontend lint/typecheck/format/tests/build           | CI                    | PASS — run `36269856402`                                                                                                                                  |

No heavy E2E/live-DB test was executed locally. CI is the authoritative
execution environment for those suites under `docs/testing/test-execution-policy.md`.
The final implementation-head run is
<https://github.com/MR-AliEsmaeili/Vardena/actions/runs/36269856402>. An earlier
run exposed two acceptance-test assertion defects (ordering a permission set and
selecting an Inventory list route that does not itself apply the ODR-3
chokepoint); both test assertions were corrected without changing production
authorization, and the final run passed.

## Acceptance boundary

This report records implementation evidence only. It does not ACCEPT the task.
Final acceptance remains with the Repository Owner.
