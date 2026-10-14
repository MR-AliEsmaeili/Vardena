# ADR-0047: Atomic self-service credential transition (F-12 correction)

- **Status:** Proposed; implemented for review. Product Owner acceptance is not inferred.
- **Date:** 2026-10-14
- **Authority:** ADR-0007 session revocation, F-12's approved concurrency/failure
  acceptance cases, AR-07 module ownership, and `docs/security.md`.

## Defect

Password verification and the unconditional credential write were separated;
password/first-login-flag updates and session revocation also committed
separately. Concurrent changes could both succeed and a revocation failure
could upgrade another holder of the initial credential to an unrestricted
session. Login and request reads could race that transition.

## Design

1. Users owns a short transaction locking its user row (`SELECT … FOR UPDATE`),
   then re-reading active/deleted state and the exact verified password hash.
   Argon2 verification/hashing remains outside the lock. A stale snapshot is
   unauthorized, never a second successful change or overwrite.
2. Identity calls Users' public application contract with a callback. An opaque,
   callback-scoped `DatabaseTransaction` capability selects the same Prisma
   transaction in each owning repository. Users accesses only `users.users`;
   Identity accesses only `identity.sessions`. Application services never see
   Prisma delegates. There is no ambient transaction context, nested transaction,
   foreign-table access, or change to any existing unrelated transaction.
3. Password hash, `must_change_password=false`, and revocation of other sessions
   commit together. Identity locks/revalidates the initiating session inside
   that transaction; an absent, foreign, revoked or expired session aborts it.
   Ordering is **user → initiating session → other sessions**. Competing changes
   of the same user serialize at the user row; logout/touch only lock sessions
   and cannot introduce a reverse user-lock dependency. READ COMMITTED and
   Prisma's existing bounded interactive-transaction defaults apply.
4. Login creates its session under the same Users-owned credential lock with
   post-lock validation. An old-password login either commits before the change
   and is revoked by it, or loses the credential check and creates nothing.
5. Request authentication rechecks session validity *after* reading the user.
   It cannot combine an old live session with a newly cleared first-login flag.
   This does not promise cancellation of requests already authorized before a
   revocation commits.
6. Lifecycle events/logs are emitted after commit, without passwords, hashes or
   tokens. The existing in-memory event bus is not a durable audit store; this
   change makes no new durability claim or retention policy.

## Boundaries and verification

No migration, new persisted field, endpoint, DTO, generated-client change or
frontend flow is needed. All existing timestamps remain Instants. Bootstrap,
password policy, RBAC/licensing, session lifetimes and OQ-19 lockout policy are
unchanged. Administrator resets retain their existing event-driven revocation
mechanism; this design's atomic guarantee is for **self-service changes**.

Alternatives rejected: a process mutex (does not protect multiple API workers),
unconditional update plus compensating rollback (can overwrite another writer),
revoking sessions before a separate credential commit (partial logout on
failure), credential epochs (unnecessary schema and session migration), and a
broad ambient unit-of-work retrofit (unrelated architectural scope).

Hermetic tests reproduce the old races; CI-only PostgreSQL HTTP tests verify
locking, rollback after an actual session write, replay, and current-session
continuity. See [the task record](../tasks/f-12-credential-transition-correction.md).
