# OQ-45: License expiry behavior — internet outage, grace, and post-termination mode

- **Type:** OQ (product/business + operational policy)
- **Status:** Open
- **Owner:** Ali Esmaeili
- **Created:** 2026-09-22
- **Priority:** High · Blocks only the _enforcement_ layer, not the license _foundation_ (ADR-0030)
- **Related docs:** PB-BASELINE §11.3, §12, §10.1; ADR-0030 (proposed foundation); PD-09, PD-12; MVP proposal category D; roadmap Stage 0/1, Stage 8

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
  daily operations" principle — which _rules out_ online-only license checks as
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

| Option                                                                                               | Advantages                                                                                  | Disadvantages                                                                                         |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **A. Warning-only, never block**                                                                     | Max trust; zero operational risk to customer                                                | No enforcement teeth; unpaid usage                                                                    |
| **B. Grace period → read-only** (e.g. 30 days warn → read-only indefinitely)                         | Preserves data access (PD-10 customer data ownership); meaningful consequence; offline-safe | "Read-only" needs precise definition (exports allowed? postings blocked?); slight implementation cost |
| **C. Grace period → full lockout**                                                                   | Strong enforcement                                                                          | Destructive during outages; contradicts offline principle; harms data-ownership promise               |
| **D. Operator-issued offline extension tokens** (Vardena issues time-limited extensions out-of-band) | Handles dispute/outage cases humanely                                                       | Operational overhead per case; requires secure token mechanism                                        |

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

## Recommended option

**B + D**: grace period → read-only (data and export remain available), plus
operator-issued offline extension tokens for special cases. **This is a
recommendation only — the owner must decide.**

## Questions requiring product owner confirmation

1. Is read-only-after-grace acceptable as the standard expiry behavior?
2. How long should the grace/warning period be (14/30/60 days)?
3. During an outage, must an expired license keep operating until connectivity
   returns (i.e. no time bomb)? _(Recommended: yes.)_
4. Is post-termination behavior the same as expiry behavior, or stricter?
5. Who holds the emergency-extension authority?

## Decision deadline or dependency

Needed before Stage 8 (commercial operations) and before any _enforcement_
code is written (Stage 1+ only builds the foundation per ADR-0030).

## Related documents

PB-BASELINE §11, §12, §10.1; ADR-0030; OQ-46; OQ-52/OQ-53 (restore must never
be blocked by license state); MVP proposal category D; roadmap Stage 8.
