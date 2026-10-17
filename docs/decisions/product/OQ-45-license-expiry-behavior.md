# OQ-45: License expiry — 14-day UTC Grace then Read-Only

- **Type:** OQ (product/business + operational policy)
- **Status:** **Product policy decided (2026-10-17); OQ remains OPEN** for implementation/verification and lifecycle protocol evidence. Natural-subscription-expiry Grace boundary is decided; cancellation transition details remain under OQ-78.
- **Owner / authority:** Product Owner Ali Esmaeili, explicit licensing decision instructions (2026-10-15 and 2026-10-16).
- **Created:** 2026-09-22 · Shape decided: 2026-10-05 · Current decisions: 2026-10-16.
- **Canonical requirements:** [PDR-11 §§9–10 and §21](PDR-11-vardena-licensing-product-requirements.md), [registry](../../open-questions.md), [date/time foundation](../../datetime.md) §0.

## Current Product Owner decision

**2026-10-17 update:** Contract termination follows the natural subscription-expiry operational policy: 14×24 hours UTC Grace from the applicable expiry instant, then Read-Only. Intentional subscription cancellation, license cancellation/revocation, and emergency revocation share the operational outcome `inactive` and do not automatically receive expiry Grace; event reasons and audit records remain distinct. See [PDR-18](PDR-18-licensing-contract-and-activation-policy.md). This resolves the product-policy question about termination strictness; it does not claim lifecycle enforcement is implemented.


For **natural subscription expiry only**: **Active → Grace (14×24 hours in UTC) →
Read-Only**, under existing authoritative license-time semantics. Display the
actual reason/status at expiry. Any extension
beyond the approved period requires Owner authorization and a valid Owner-issued
signed artifact through approved validation. No local-setting/database/restart/
clock bypass or silent extension. Temporary infrastructure/internet failure alone
is not commercial suspension and does not silently extend validity or Grace.

Read-Only permits **all existing users** to log in under normal account/auth rules,
with their existing permissions for document/report views, printing and Excel
export. Database backup remains available through approved administrative/recovery
paths; license status and renewal remain available. No new permissions are granted.
Block business-document creation, business-data modification and inventory/accounting
effects at backend/API and relevant async paths, not merely frontend controls.
Preserve users, permissions, data and history. After valid renewal and license-state
revalidation, restore the previously authorized operational state without manual
reconstruction; unrelated emergency/integrity restrictions remain in force.

Expiry is not emergency termination/revocation: a validated Owner stop or explicitly
defined security policy applies the immediate appropriate restriction without
the automatic 14-day natural-subscription-expiry Grace. PDR-11 §10 requires actual reason, independent authenticated
administrator recovery, approved backup access, and valid applicable Owner-signed
restoration; ordinary renewal, restart or clock repair never bypasses it. Remaining
security/session/protocol details stay tracked under OQ-78, not fabricated here.
The distinct contract-termination policy is decided by the 2026-10-17 update above. Implementation/verification and OQ-78 lifecycle protocol work remain open, so OQ-45 stays open for evidence rather than for the product-policy choice.

## Exact Grace deadline — final Product Owner decision (2026-10-16)

For **natural subscription expiry only**, the Grace boundary is the recorded signed
expiry instant plus **14 days in UTC**. Treat the signed expiry as an exact UTC
Instant; add 14 × 24 hours without using the display timezone, local calendar,
partial-day rounding, or DST arithmetic. At `now >= boundary`, Grace has ended
and the approved Read-Only state applies. Before that instant, the approved
natural-subscription-expiry Grace behavior applies. For example, expiry
`2026-10-08T08:30:00Z` ends Grace at `2026-10-22T08:30:00Z`.

This rule does not change the half-open signed-validity interval, the signed
`validUntil`, display formatting, or Owner-authorized signed extensions. Internet
or infrastructure outages do not extend either license validity or Grace.

Intentional subscription cancellation is **not natural subscription expiry** and grants no
automatic 14-day Grace. Subscription cancellation, license cancellation,
expiration, replacement, and reissuance remain distinct lifecycle events; the
appropriate cancellation/restriction transition and its authorization/evidence
are handled under OQ-78 and must not be inferred from this expiry rule. The
separate question whether contract termination by itself requires a stricter
policy remains open; no new termination policy is inferred.

**Enforcement gate:** the product-level deadline is decided, but Grace/Read-Only
behavior is not implemented or verified. Engineering must implement exact UTC
boundary handling, including before/at/after checks and restart behavior, in a
separate authorized change. Do not change signed formats or use local display
strings as source facts.

## Implementation requirements and status

PDR-11 §20.5–§20.6 records source-backed gaps and future acceptance criteria.
The Product Owner has decided the deadline: engineering must implement the
recorded UTC boundary and specify API/worker enforcement and renewal restoration
against existing time/security boundaries. This record implements none of those
mechanisms and claims no passing feature tests or module-wide compliance. The
global Jalali-first display policy changes neither signed expiry Instants nor
storage semantics. OQ-45's duration, natural-subscription-expiry boundary, outage distinction,
extension authority and Read-Only capabilities are decided; enforcement and
verification require a separate change. The distinct contract-termination
strictness question remains open.

## Implementation submitted for review (2026-10-16, ADR-0049)

Engineering implementation was submitted in a dedicated PR from starting
`main` `74079fe83c6f0023e0ade10ca0d39c02246bf1fa` (live-verified; no open PRs
at start). Domain evaluation now derives `accessMode`/`graceEndsAt`
(`validUntil + 14×24h`, `now >= graceEndsAt` => Read-Only) without mutating
signed validity; `LicensingService.filterLicensedPermissions` (the central
filter behind HTTP and service authorization) keeps entitled permissions in
Grace, entitled `View`/`Export` plus platform licensing permissions in
Read-Only, and the previous platform-only behavior for
unlicensed/suspended/not-yet-valid states. System-context service checks
refuse mutations in Read-Only (queued-work defence; no production worker
dispatch loop exists). API state exposes `accessMode`/`graceEndsAt`; the
frontend workspace remains reachable in Grace/Read-Only with a Persian
notice, and the status card shows the mode/deadline. Stored RBAC assignments
are untouched, so valid renewal (re-evaluated per call, no new cache)
restores prior operation. Tests: new domain/service/RBAC unit specs;
heavy verification is GitHub Actions on the exact PR head. **OQ-45 remains
OPEN**: no Product Owner acceptance is claimed and the contract-termination
strictness question is undecided.

## Historical record — superseded options and unresolved wording

The following is the original dated record, preserved as history only. Its
OPEN/duration recommendations and speculative options are **not current policy**;
the explicit decision above and PDR-11 supersede them, without inferring a
historical meaning for any option label.

## Owner decision (2026-10-05) — Grace then Read-Only

After license expiration / the applicable Grace period:

- user access policy enters **Grace**;
- after Grace, **Read-Only mode** is used according to the final license policy.

**Read-Only must not allow mutation**, including: creating operational
documents; editing operational documents; Accounting Post; inventory-changing
operations; prohibited administration changes. Read-only visibility, reports
and export behavior should remain available according to the final
implementation (consistent with PD-10 data ownership and OQ-46).

**Deliberately NOT decided (stays open — do not invent):** the Grace duration
(14/30/60 days…), exact behavior during internet outages near/past expiry,
whether post-termination behavior is stricter than expiry behavior, and the
emergency-extension/override authority. Enforcement remains **unimplemented**
(ADR-0030 keeps enforcement off); license entering Grace/Read-Only must be
surfaceable through the future administrative alert model (OD-54-11).

Future acceptance tests (none exist today): Grace behavior follows the ratified
policy; Read-Only prevents every mutation listed above.

## Context

The commercial structure (setup fee, base license, support subscription,
modules, custom development) is decided (PB-BASELINE §11.1). The **foundation**
level for licensing — recording license state in-product, non-punitive,
enforcement-off — is proposed in ADR-0030. What is genuinely unresolved is
**behavior at expiry**: what a working installation does when its license ends,
in particular while the customer has no internet connection (which is the
normal operating mode of the product, PB-BASELINE §10.1).

Iranian SMB reality: internet outages are routine; a hard lockout during an
outage would be commercially destructive. But a license with no consequences for
expiry is not a license. The owner explicitly left this undecided.

## Why this matters

- Wrong choice here is commercially self-harming in either direction: punitive
  DRM destroys trust (risk R-02); toothless licensing destroys revenue.
- The behavior must be consistent with the decided "no mandatory internet for
  daily operations" principle — which *rules out* online-only license checks as
  the enforcement mechanism.
- Post-termination data policy (read-only mode) interacts: expiry and
  termination may deserve different behaviors.

## Exact decision required

1. What happens on license expiry in good standing (customer intends to renew):
   warn-only grace period? read-only? full lockout after N days?
2. What happens during an internet outage when the license is near/past expiry?
3. What happens after contract termination: full lockout, read-only mode, or
   unrestricted operation (data stays, no new business)?
4. Who can override (operator-level emergency extension) and with what audit?

## Options

| Option | Advantages | Disadvantages |
|---|---|---|
| **A. Warning-only, never block** | Max trust; zero operational risk to customer | No enforcement teeth; unpaid usage |
| **B. Grace period → read-only** (e.g. 30 days warn → read-only indefinitely) | Preserves data access (PD-10 customer data ownership); meaningful consequence; offline-safe | "Read-only" needs precise definition (exports allowed? postings blocked?); slight implementation cost |
| **C. Grace period → full lockout** | Strong enforcement | Destructive during outages; contradicts offline principle; harms data-ownership promise |
| **D. Operator-issued offline extension tokens** (Vardena issues time-limited extensions out-of-band) | Handles dispute/outage cases humanely | Operational overhead per case; requires secure token mechanism |

## Risks

- Read-only mode (B) must still allow data export (OQ-46) — otherwise it
  contradicts PD-10.
- Any hard block interacting with backup/restore could leave a customer unable
  to restore during a dispute — unacceptable.

## Dependencies

- ADR-0030 (license foundation) — the behavior layer sits on it.
- OQ-46 (export format) — read-only mode must permit whatever export is decided.
- Stage 8 (commercial operations) makes this blocking; Stage 0/1 can proceed
  with ADR-0030 alone (foundation, enforcement-off).

## Recommended option (historical — superseded in part by the Owner decision above)

**B + D**: grace period → read-only (data and export remain available), plus
operator-issued offline extension tokens for special cases. *(Recorded
2026-09-22 as a recommendation. On 2026-10-05 the Owner decided the B shape —
Grace → Read-Only; the D extension-token idea remains an undecided option.)*

## Questions requiring product owner confirmation

1. Is read-only-after-grace acceptable as the standard expiry behavior?
2. How long should the grace/warning period be (14/30/60 days)?
3. During an outage, must an expired license keep operating until connectivity
   returns (i.e. no time bomb)? *(Recommended: yes.)*
4. Is post-termination behavior the same as expiry behavior, or stricter?
5. Who holds the emergency-extension authority?

## Decision deadline or dependency

Needed before Stage 8 (commercial operations) and before any *enforcement*
code is written (Stage 1+ only builds the foundation per ADR-0030).

## Related documents

PB-BASELINE §11, §12, §10.1; ADR-0030; OQ-46; OQ-52/OQ-53 (restore must never
be blocked by license state); MVP proposal category D; roadmap Stage 8.
