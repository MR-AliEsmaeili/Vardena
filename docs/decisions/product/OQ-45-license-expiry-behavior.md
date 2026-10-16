# OQ-45: License expiry — 14-calendar-day Grace then Read-Only

- **Type:** OQ (product/business + operational policy)
- **Status:** **Open — narrowed (2026-10-15). 14-day duration/Read-Only capabilities/extension authority decided; exact Grace deadline and distinct contract-termination trigger/strictness remain open (clarified 2026-10-16).** Documentation only; enforcement/verification remain separate follow-ups.
- **Owner / authority:** Product Owner Ali Esmaeili, explicit licensing decision instruction (2026-10-15).
- **Created:** 2026-09-22 · Shape decided: 2026-10-05 · Current decision: 2026-10-15.
- **Canonical requirements:** [PDR-11 §§9–10 and §20](PDR-11-vardena-licensing-product-requirements.md), [registry](../../open-questions.md), [date/time foundation](../../datetime.md) §0.

## Current Product Owner decision

**Active → Grace (14 calendar days) → Read-Only**, under existing authoritative
license-time semantics. Display the actual reason/status at expiry. Any extension
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
14-day expiry Grace. PDR-11 §10 requires actual reason, independent authenticated
administrator recovery, approved backup access, and valid applicable Owner-signed
restoration; ordinary renewal, restart or clock repair never bypasses it. Remaining
security/session/protocol details stay tracked under OQ-78, not fabricated here.
The original distinct contract-termination trigger/strictness question remains
**OPEN**: these instructions do not decide whether termination alone mandates a
stricter policy. Do not infer such a trigger or equate termination with a validated
Owner emergency stop. This residual product question is why the OQ-45 registry
row is not closed. The exact Grace deadline question below is another narrowly
scoped residual; it does not reopen the approved duration or access policy.

## Exact Grace deadline — Product Owner question (OPEN)

The approved 14-calendar-day duration does **not** unambiguously select an exact
Read-Only Instant for intraday expiry. ADR-0046 and the existing half-open
`[validFrom, validUntil)` contract define **expiry**, not Grace arithmetic.
`docs/datetime.md` §0 defines presentation and zone handling, not a new license
validity or Grace clock. A license is installation-scoped and can cover multiple
organizations; an organization's display zone does not select a license deadline.

**Question to the Product Owner:** from signed `validUntil`, should Grace end
(a) after exactly 336 elapsed hours, (b) at the same local wall-clock time after
14 calendar dates, or (c) at a local day boundary? For (b)/(c), which authoritative
zone applies, does the partial expiry day count, and how are DST gaps/overlaps
resolved? These are competing interpretations, **not approved options or an
engineering default**. Preserve the approved 14-day duration and signed extension
authority; do not alter signed `validUntil` or use UI-rendered strings as facts.

Concrete example: expiry `2026-10-08T08:30:00.000Z` is 12:00 in Tehran. A 336-hour
rule ends at `2026-10-22T08:30:00.000Z` (12:00 Tehran). If the expiry date counts
as calendar day one, ending after that fourteenth date instead yields
`2026-10-21T20:30:00.000Z` (start of October 22 in Tehran); counting fourteen
full dates after the partial expiry date instead yields
`2026-10-22T20:30:00.000Z` (start of October 23). None is selected here.

DST also separates elapsed and wall-clock addition: `2022-09-15T08:30:00.000Z`
is 13:00 Tehran before its historical offset change. 336 elapsed hours ends at
`2022-09-29T08:30:00.000Z` (12:00 Tehran); preserving 13:00 across fourteen local
dates instead gives `2022-09-29T09:30:00.000Z`. Historical examples are boundary
requirements, not permission to reinterpret stored licenses.

**Enforcement gate:** do not implement the Grace/Read-Only deadline until the PO
resolves this question in this existing OQ-45 record. Afterwards add exact
before/at/after, intraday and DST fixtures for the chosen UTC deadline, signed
extension/restart behavior and any approved zone. No new OQ ID or runtime
implementation/test of an invented policy is created. The separate
contract-termination trigger/strictness question remains independently OPEN.

## Implementation requirements and status

PDR-11 §20.5 lists source-backed gaps and §20.6 supplies future acceptance criteria.
Engineering must first obtain the PO deadline decision above, then specify
API/worker enforcement and renewal restoration against existing time/security
boundaries. Deadline arithmetic is not delegated as a free technical choice. This record implements
none of them and claims no passing feature tests or module-wide compliance.
The global Jalali-first display policy changes neither signed expiry Instants nor
storage semantics. OQ-45's duration, outage distinction, override authority and
Read-Only capability questions are answered; exact deadline semantics still need
PO resolution before enforcement, and mechanisms require a separate PR. The
separate termination-trigger/strictness question also still requires PO input.

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
