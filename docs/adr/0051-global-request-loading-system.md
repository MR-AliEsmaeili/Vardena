# ADR-0051: Single request-activity loading system with Thinking Orbs

Status: Proposed — implemented for Product Owner review (2026-10-19)
Date: 2026-10-19

## Context

The frontend already exposes honest per-query and per-mutation states
(`isPending`/`isFetching`, skeletons, disabled actions), but there is no single
source of truth for "is a real web-service operation running right now?".
Every feature derives that answer locally, so concurrent requests can produce
inconsistent or duplicated feedback, and a long mutation that outlives its
originating button has no application-level indicator. The Product Owner
requested one global loading system, visually driven by `thinking-orbs`, while
preserving the existing per-section UX, accessibility, RTL layout and every
existing interceptor.

There is exactly one HTTP choke point (`src/api/client.ts`: one Axios instance
and four helpers), which makes a transport-level registry possible without
touching components. The application is currently light-only; a new dependency
requires an ADR (AR-29/AR-30).

## Decision

1. Add the process-wide registry `src/api/request-activity.ts`. Every real
   HTTP attempt gets a unique token; `endRequest(token)` is idempotent and can
   never decrement another attempt or a count below zero. React subscribes via
   `useSyncExternalStore`; no new state library and no new provider.
2. Track requests only in the existing Axios interceptors
   (`src/api/client.ts`). The response interceptor is the primary
   finalization path (success, HTTP error, network error, cancellation); the
   four API helpers end the same token in a `finally` safety net. The token,
   not the code path, guarantees exactly-once finalization. 401 handling,
   session-expiry and error normalization keep their current order: the entry
   is finalized first, then the existing reaction runs.
3. Classify each attempt once, in `resolveRequestActivity`: reads are
   `background`; writes are `global`; a per-call `vardenaRequestActivity`
   override can choose the scope and the neutral semantic message. The
   registry stores no URL, body or error.
4. Render three surfaces from the same registry, each mounted once:
   a delayed non-modal global panel (writes), an ambient top-bar orb
   (background reads) and a per-table local refresh indicator. Initial page
   reads keep their section `LoadingState`; mutations keep their existing
   disabled/relabelled controls. No surface issues a request.
5. Use `thinking-orbs@0.3.2` (MIT) as the shared animation through the single
   wrapper `src/ui/thinking-orb.tsx`. Display thresholds (500 ms global,
   300 ms ambient/local) suppress flicker; there is no artificial minimum
   display duration. The library handles `prefers-reduced-motion` with one
   static frame.

## Consequences

- One place answers "is something running"; features only choose a scope.
- Fast requests never flash a global panel; long writes surface it after
  500 ms. Local feedback stays immediate, so independent areas remain usable.
- A stuck server request remains visibly active by design; the registry does
  not invent timeouts. Cancellation and all error paths are tested to finalize.
- The wrapper defaults to `theme="auto"`; the app declares
  `<html data-theme="light">`, so a future dark theme flips one attribute.
- `thinking-orbs` becomes a production dependency and must stay in
  `THIRD_PARTY_NOTICES.md`; no other loading/animation library is added.
- Coverage is bounded by the single HTTP layer: a future direct `fetch`,
  WebSocket or non-Axios client would need explicit registration, which the
  frontend standards already forbid.
