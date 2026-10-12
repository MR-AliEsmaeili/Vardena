# PDR-12: License term change through explicit signed supersession (OD-LIC-01)

- **Type:** PDR (Product Decision Record) · decision id **OD-LIC-01**
- **Status:** **Decided — Final Owner Decision** (2026-10-12)
- **Decided by:** Product Owner (Ali Esmaeili)
- **Registry row:** [`docs/open-questions.md`](../../open-questions.md) — no OQ changes status; **OQ-87 stays OPEN** (this decision does not answer it)
- **Recording baseline:** PR [#141](https://github.com/MR-AliEsmaeili/Vardena/pull/141), branch `arena/ff87e27d-vardena` @ `0139756` (base `main` @ `cdf21e4`)
- **Related records:** [PDR-11](./PDR-11-vardena-licensing-product-requirements.md) §3.1/§3.2, §8.2–§8.6, §12.9, §19.4 · [ADR-0046](../../adr/0046-signed-license-documents-and-version-lifecycle.md) Decisions 3–5 and its 2026-10-12 addendum · [OQ-80/OQ-86 decision brief](../../tasks/licensing-oq-80-oq-86-decision-brief.md) §8.7 · [`docs/licensing/version-model-and-file-exchange.md`](../../licensing/version-model-and-file-exchange.md) §3.3

> This record transcribes a binding Owner decision. The behavior it fixes is
> implemented in the same change as this record; **L-04 (PDR-11 §8.6
> capacity-conflict detection against existing users/organizations/devices and
> its resolution flow) is NOT complete** and this decision does not complete it.

## 1. Question

May a new license version that **explicitly and validly supersedes** a previous
version through the existing signed, auditable supersession mechanism
(`supersedesOperationId`, ADR-0046 Decision 3) **convert a perpetual grant
(`validUntil = null`) into a time-limited grant** (a specific `validUntil`) —
and if so, under which invariants?

The question had been answered **ambiguously in the reviews**: the perpetual →
time-limited change is a reduction of the *retained grant* (it ends coverage
that was open), so the implicit hand-over and the legacy `VLIC1` replacement
refuse it (`reduction-requires-resolution`), while an explicit signed
supersession that names the version it retires had been left permissive and was
recorded, in the interim, as an implementation reading rather than a decision
(`docs/tasks/licensing-oq-80-oq-86-decision-brief.md` §8.7,
`docs/licensing/version-model-and-file-exchange.md` §3.3). This record replaces
that interim reading with the Owner's final decision.

## 2. Decision (OD-LIC-01) — binding

**When a new license version explicitly and validly supersedes a previous
version through the existing signed, auditable supersession mechanism:**

1. **A perpetual grant (`validUntil = null`) may be replaced by a time-limited
   grant** (`validUntil` is a specific date/time). The term change is the only
   difference the explicit-supersession exception authorizes.
2. **`organizationLimit` must not decrease.**
3. **`userLimit` must not decrease.**
4. **No previously granted entitlement/module may be removed.**
5. **All existing signature validation, license identity, customer-binding,
   precedence, audit, and conflict-validation requirements remain in force.**
6. **Explicit supersession is not a general authorization to reduce a grant.**
   It authorizes the term change of (1) only; capacity and entitlement
   reductions (2)–(4) must still be rejected.

### 2.1 Rationale (as decided)

- A signed supersession that names the version it retires is the Owner's own
  instruction for exactly that version: it is the explicit, auditable statement
  of *which* license version now runs and *until when* (PDR-11 §12.9 requires an
  explicit, auditable resolution for a destructive or capacity-changing
  consequence; changing the term of a named version is neither — it deletes no
  customer data and changes no capacity).
- A signed document **cannot** observe how many users or organizations exist, so
  no signature can resolve a capacity or entitlement conflict. Naming the
  version to retire therefore cannot switch PDR-11 §8.2/§8.4/§8.6 off — those
  conflicts are with *current usage*, and their check/explain/preserve/
  explicit-resolution flow is the L-04 slice.
- The distinction keeps the strongest guarantee in the product meaningful: a
  perpetual license is only shortened by a document that explicitly identifies
  the version it shortens, never by a later-starting document (implicit
  precedence) and never by a legacy text code.

## 3. Exact scope of the explicit-supersession exception

The exception applies **only** to the term dimension, **only** to an explicit,
valid, signed supersession:

| Supersession path | Perpetual → time-limited | Capacity reduction | Entitlement removal |
|---|---|---|---|
| **Explicit, valid, signed supersession** | **Allowed** | **Rejected** | **Rejected** |
| **Implicit precedence** (OQ-80 Option B hand-over) | **Rejected** as a reduction | **Rejected** | **Rejected** |
| **Legacy `VLIC1` code** | Existing safe behavior; **no bypass** (the open end stays guarded) | **Rejected** where applicable | **Rejected** where applicable |

- **Rate of change in the term:** the change may shorten the term (perpetual →
  time-limited). Extending or removing an end (`validUntil` set → `null`, or a
  later `validUntil`) is not a reduction and stays allowed on every path, as
  before.
- **Mixed changes:** the invariants are evaluated **per dimension**. A larger
  `organizationLimit` does not pay for a smaller `userLimit`, and a larger
  capacity does not pay for a removed entitlement. Any single reduction refuses
  the whole document.
- **Valid non-reducing hand-over** (explicit or implicit) is unchanged and stays
  accepted, with the documented hand-over, effective-window and audit behavior.
- **A document that retires nothing** (a first license, a gap-filling renewal, a
  new license identity) has no predecessor whose grant could be reduced and is
  unaffected by this decision. Whether a new license identity may cover a lapse
  stays **OQ-87, OPEN**.
- **Invalid or missing signatures cannot reach the exception:** authenticity is
  verified before the conflict evaluation runs, so an unsigned, tampered or
  foreign-key document is refused by the signature/format gates and never
  reaches the supersession logic.

## 4. Non-reduction invariants (the exact rules)

For the version being retired (`P`) and the candidate (`C`), where `null` means
*unlimited*:

- **Organization capacity:** refused when `C.organizationLimit` is smaller than
  `P.organizationLimit`; replacing an unlimited limit (`null`) with a number is
  a reduction; replacing a number with `null` (unlimited) is not.
- **User capacity:** the same rule for `userLimit`.
- **Entitlements:** refused when any `(kind, code)` granted by `P` is absent
  from `C`. Additional entitlements and unchanged entitlements are not
  reductions; the comparison is on the granted set, not its order.
- **Term (only where the version is NOT named by a signed document):** refused
  when `P.validUntil === null` and `C.validUntil !== null`.

Every refusal uses the existing conflict mechanism: the reason
`reduction-requires-resolution` (**HTTP 409**, nothing written — no version row,
no supersession stamp, no effective-window change, no misleading success audit
event; the refused `operationId` is not retained, so the document can be
re-issued correctly). The response contract is unchanged.

## 5. Explicit signed supersession vs. implicit precedence

- **Explicit signed supersession** (`supersedesOperationId` naming a retained,
  eligible version): decision 2.1 above — the term may change, capacity and
  entitlements may not decrease.
- **Implicit precedence** (OQ-80 **Option B**: a signed document that starts
  later takes over exactly one still-governing version it overlaps): the
  retirement itself is *not* named by the document. It therefore keeps the
  stricter guard — end an open end (`perpetual → time-limited`) is itself a
  reduction and is refused (`reduction-requires-resolution`), exactly like any
  capacity or entitlement reduction.
- **Legacy `VLIC1` code:** preserves its documented L-02 lifecycle and gains no
  new bypass. Where it replaces a version it keeps the stricter guard (an open
  end is treated as a reduction) and any capacity/entitlement reduction is
  refused.
- The precedence rule is **never** the mechanism that applies a reduction of any
  kind (PDR-11 §8.6; decision brief §8.7).

## 6. Implementation references (recorded, not acceptance)

| Element | Reference |
|---|---|
| Single conflict authority | `backend/src/modules/licensing/domain/license-version.ts` — `evaluateImportConflicts` (read-side pre-check and in-transaction pass) |
| Capacity/entitlement guard | `reducesCapacityOrEntitlements` — evaluated against the version actually retired on **every** path |
| Open-end guard | `closesOpenEnd` + `reducesRetainedGrant` — evaluated only where the document does not name the version it retires (implicit precedence, legacy `VLIC1`) |
| Refusal reason / class | `reduction-requires-resolution` (409, nothing written) — unchanged reason; the service wording now states that naming the version to retire does not resolve the reduction |
| Regression tests | `domain/license-version.spec.ts` (reduction matrix over both limits and an entitlement removal × all three retirement paths; non-reduction controls; mixed changes; term-change cases), `application/license-import.service.spec.ts` (pipeline refusals with unchanged state/audit; term-change applied; signature gate), `test/license-import.e2e-spec.ts` (HTTP), `test/licensing-persistence-live.e2e-spec.ts` (transaction pass on live PostgreSQL) |

**Status of this decision: recorded (Owner, 2026-10-12); implementation recorded
in the same PR; tests passed locally; CI verified on the exact PR head
`68d50517c2d2888f38f10ca1a615f05ce19b7fe0` (run
[`38239438399`](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/38239438399) —
`pull_request`, `completed / success`, the `backend`, `frontend` and
`generated-api-client` checks all pass); Product Owner acceptance
outstanding.** These states are kept separate — this record asserts CI only for
that SHA, and nothing here is a claim of acceptance. The documentation-only
status correction carrying this sentence changes no code, test or migration,
and is not covered by that run.

## 7. What this decision does NOT decide

- **OQ-87** — whether a **new** license identity may cover a lapse for the same
  customer + installation — stays **OPEN** and undecided here.
- **L-04** — PDR-11 §8.6 conflict detection against existing
  users/organizations/devices and its resolution flow (the check, the operator
  explanation, preserve, explicit resolution) — **remains outstanding**. Until
  it exists, a reduction is refused rather than resolved; this decision does
  **not** implement or complete L-04.
- No change to the approved customer-transfer policy or its audit requirements
  (Q4), to the OQ-80/OQ-86 decisions, to the `license-binding-conflict`
  ratification, to import tolerance, or to as-of-read semantics.
- No change to the legacy `VLIC1` lifecycle semantics, and no new bypass for
  any transport.
