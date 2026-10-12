# PDR-13: Post-gap recovery through a dedicated audited operation (OQ-87 Option B)

- **Type:** PDR (Product Decision Record) · decision id **OD-LIC-02**
- **Status:** **Decided — Final Owner Decision** (2026-10-12)
- **Decided by:** Product Owner (Ali Esmaeili)
- **Registry row:** [`docs/open-questions.md`](../../open-questions.md) — **OQ-87** (decision recorded in the registry row; status per the registry's own convention)
- **Recording baseline:** branch `arena/8904ef31-vardena` (base `main` @ `f4c2e84f7af734c356e035dabc69bb8acfa81a05`, the merge commit of PR #141)
- **Related records:** [PDR-11](./PDR-11-vardena-licensing-product-requirements.md) §3.4, §8.2–§8.6, §12.9, §16 (deferred items citing this record) · [PDR-12](./PDR-12-license-term-supersession.md) (term change; its non-reduction invariants stay in force here) · [OQ-80/OQ-86 decision brief](../../tasks/licensing-oq-80-oq-86-decision-brief.md) §8.6 (the dependency this decision unblocks) · [ADR-0046](../../adr/0046-signed-license-documents-and-version-lifecycle.md) (signature, identity, precedence, audit) · [`docs/licensing/version-model-and-file-exchange.md`](../../licensing/version-model-and-file-exchange.md) §3.3

> This record transcribes a binding Owner decision and the implementation that
> carries it in the same change. It also completes the **L-04** slice (PDR-11
> §8.6: check/explain/preserve/require-explicit-resolution for capacity and
> entitlement reductions), which was registered as blocked on this decision —
> the blocking dependency is hereby answered and L-04's flow is implemented in
> the same change (§5).

## 1. Question

May a **NEW license identity** (a fresh `licenseId`) be issued for the **same
customer + installation** to cover a **lapse** — a period after the
installation's retained license coverage has ended — and if so, by which
operation?

OQ-80's G2 decision refuses a *renewal* that leaves a gap (a candidate carrying
a retained `licenseId` may not start after that license's retained coverage
end), and the Q3 decision keeps every renewal on the same `licenseId`. Between
them, post-gap recovery was undefined: the implementation neither granted nor
refused a new-identity candidate that follows a lapse, and no workflow was
allowed to claim recoverability ([decision brief §8.6](../../tasks/licensing-oq-80-oq-86-decision-brief.md)).

## 2. Decision (OD-LIC-02) — binding

**Post-gap recovery for the same customer + installation is permitted ONLY
through a dedicated, explicitly authorized, audited recovery operation that
captures a reason with a traceable history. The ordinary license import is NOT
a permitted post-gap recovery path.**

1. **Dedicated operation.** The recovery is its own operation
   (`POST /api/v1/license/gap-recovery`) with its own permission
   (`Licensing.Installation.RecoverAfterGap`, always required **together with**
   `Licensing.License.Activate`), enforced server-side in both the route guard
   and the application service. It is not a flag, not a document field, and not
   a mode of the existing import route.
2. **Required, validated reason.** The operator must supply a reason
   (3–500 characters) at the operation boundary. An unexplained recovery is
   not auditable and is refused (400) before anything is written.
3. **Durable, traceable history.** The recovery writes a typed audit event
   (`license.import.recovered`) in the SAME transaction as the new version,
   carrying the machine-readable `previous_license_id` (the license whose
   retained coverage had ended, new nullable column on
   `license_audit_events`), the lapsed coverage end, the operation, the actor,
   the source, the instant and the reason. Ordinary import never writes this
   event, and an ordinary import attempt of a post-gap candidate is refused
   with a stable 409
   (`post-gap-recovery-requires-dedicated-operation`, nothing written) that
   points at the dedicated operation.
4. **Transactional.** The recovery applies the version, stamps the retained
   history and writes the audit event in ONE transaction; a failure leaves the
   retained state and the audit trail untouched (no partial license, no
   partial window, no partial recovery state).
5. **Deterministic.** A duplicate recovery (the same document twice) is a
   stable 409 (`duplicate-operation`); a recovery attempt whose coverage has
   not lapsed is refused (409, `recovery-not-applicable`); concurrency is
   arbitrated by the existing per-installation lock and unique indexes.
6. **No silent emulation.** The ordinary import must never silently perform or
   emulate a recovery. The refusal is a documented, tested public contract.
7. **Everything else is unchanged.** Signature, binding (the recovery document
   must be issued for THIS installation and its current customer — a recovery
   never transfers), identity, overlap/precedence rules (OQ-80 Option B, G2,
   OQ-86 Option C), the §8.6 reduction guard, retained-history preservation
   and audit requirements all remain in force on the recovery path, and the
   legacy `VLIC1` text code cannot carry a recovery (422,
   `recovery-requires-signed-document`).

### 2.1 Rationale (as decided)

- A lapse is a **commercial event**: coverage ended and the deployment continued
  unlicensed. Bringing it back is materially different from applying a renewal
  on time — it is exactly the situation G2 and Q3 refuse to let an ordinary
  document paper over, because a gap-filling new identity would rewrite which
  license "was responsible" for the deployment without anyone deciding that.
  The Owner decides it, per recovery, with a name on it (the operator) and a
  reason in the trail.
- The import pipeline is and stays the ONLY way a document is applied: the
  recovery is an *intent* carried into the same verified, locked, atomic
  pipeline, accepted by the one conflict authority only on the recovery
  operation's behalf. There is no second pipeline to secure.
- A machine-readable `previous_license_id` (in addition to the bounded event
  text) keeps the history queryable: an installation's recovery story can be
  answered from the trail without parsing text, the same treatment the
  customer-transfer columns received (Q4).

## 3. Exact scope of the recovery operation

- **Candidate shape:** a signed license document (file envelope or bare
  `VLIC2` artifact) carrying a NEW `licenseId`, issued for the installation's
  current customer, whose window starts strictly after the installation's
  retained coverage end. The same document through `POST /license/import` is
  refused with the 409 above; through `POST /license/gap-recovery` without the
  lapse it is refused (`recovery-not-applicable`); carrying a retained
  `licenseId` it is a renewal and stays subject to G2, never a recovery.
- **Authorization:** route guard + application-service re-check of BOTH
  permission codes (AR-21). No frontend or flag can substitute.
- **Audit:** typed `license.import.recovered` event, `previous_license_id`
  column, additive migration `20261017000000_license_audit_previous_license_id`.
- **Explain contract:** the ordinary import's 409 carries the stable reason
  `post-gap-recovery-requires-dedicated-operation` and nothing is written.

## 4. Invariants (what recovery must NOT do)

1. Recovery must not bypass, weaken or re-interpret signature verification,
   installation binding, customer binding, identity/precedence rules or
   retained-history preservation (PDR-11 §3, ADR-0046).
2. Recovery must not reduce capacity or entitlements relative to what the §8.6
   guard requires of ANY applied version: the reduction guard runs on the
   recovery path exactly as on every other path.
3. Recovery must not change the installation's customer (that is Q4's
   transfer operation, separately authorized and audited).
4. Recovery must not be expressible as an ordinary import, a legacy code, a
   retry, or any document field: none of these carries the authority.
5. Recovery must not write partial state: the transaction either applies the
   version, stamps the history and writes the typed event, or writes nothing.
6. Recovery must not close an open end by operator decision (PDR-12's rule is
   untouched); an open end never lapses into a recovery candidate anyway, and
   PDR-12's term rule continues to govern term changes.

## 5. L-04 in the same change (the unblocked dependency)

The decision brief §8.6 recorded L-04 (PDR-11 §8.6: detect reductions that
conflict with **current usage or the retained grant**, explain them, preserve
the retained state, and require an explicit resolution) as blocked on this
decision. This change implements that flow:

- The import conflict authority compares a shrinking version against the
  **counted current usage** (organizations, active users — read inside the
  import transaction under the same advisory locks the allocation guards hold)
  and against the **retained grant** (removed entitlements). A shrink whose
  usage stays within the new finite limits is NOT a conflict; an unavailable
  count fails closed (`usage-unavailable`).
- A conflicting reduction is refused with 409
  `reduction-requires-resolution` and a structured explain payload
  (`reduction.predecessorVersionId` + per-conflict kind/limit/usage/
  entitlement) — nothing is written.
- The ONLY way to apply such a version is the dedicated
  `POST /api/v1/license/reduction-resolution` operation under
  `Licensing.License.ResolveReduction` (+ `Licensing.License.Activate`) with a
  required reason, which applies the import AND the audited resolution in ONE
  transaction, recording the conflicts it actually authorized (recomputed
  under the locks) as the typed `license.import.reduction-resolved` event with
  a receipt carrying the same facts. A resolution whose document does not
  conflict is refused (`resolution-not-applicable`); retrying a document or
  naming a version is never a resolution (PDR-12 unchanged: an open end is
  closable ONLY by an explicit signed supersession and is never
  operator-resolvable).

## 6. Implementation references (recorded, not acceptance)

- Domain: `backend/src/modules/licensing/domain/license-version.ts`
  (`isPostGapRecoveryCandidate`, `postGapGuard`, `lapsedLicenseContext`,
  `reductionConflicts`, `evaluateReductionHandOver`), the single conflict
  authority `evaluateImportConflicts` on every path that applies a version.
- Application: `license-import.service.ts` (`recoverAfterGap`,
  `resolveReduction`, `importDocument` stays intent-less),
  `application/license-usage.ts` (usage port + allocation-lock keys,
  `CrossModuleLicenseUsage` through the published
  `OrganizationsService`/`UsersService` contracts, AR-07).
- Data: `licenses.repository.ts` (in-transaction usage read under
  `pg_advisory_xact_lock`, dedicated typed events, `previousLicenseId`),
  additive migration `20261017000000_license_audit_previous_license_id`.
- API: `POST /api/v1/license/gap-recovery` and
  `POST /api/v1/license/reduction-resolution` (OpenAPI-documented DTOs),
  permissions `Licensing.Installation.RecoverAfterGap` and
  `Licensing.License.ResolveReduction` registered in the existing registry.
- Tests: domain matrix (`license-version.spec.ts`), application pipeline
  (`license-import.service.spec.ts`), in-memory repositories
  (`test/support/licensing-repositories.ts` mirrors the transaction), HTTP
  e2e (`test/license-recovery-resolution.e2e-spec.ts`), live-PostgreSQL
  persistence suite (CI) for the real locks and rollbacks.

## 7. What this decision does NOT decide

- **Replacement workflow** (OQ-82), **device licensing** (OQ-83), **signed
  receipts** (OQ-84) — untouched.
- **`SUSPENDED` lifecycle vocabulary** (OQ-79) — untouched.
- **Recovery pricing/commercial terms** — the Owner's issuance process decides
  who may request a recovery; this record fixes only the product behaviour
  once it happens.
- **A self-service recovery UI.** The API contract (OpenAPI) is the surface;
  any frontend for the dedicated operations is a separate slice and its
  absence does not make the API less authoritative.
- **Retention of audit events** (OQ-77) — the recovery event follows the
  existing audit retention regime.
- The decision does **not** authorize: importing around the recovery controls;
  reducing capacity/entitlements by recovery; bypassing signature, binding,
  identity, precedence, retained-history or audit rules; weakening VLIC1's
  restrictions; or changing OQ-80/OQ-86/Q3/Q4/PDR-12.
