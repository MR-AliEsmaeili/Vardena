# Owner UI — presentation and request-loading contract

Status: implemented in PR #190; **Product Owner visual acceptance outstanding**
(2026-10-21). Exact final-HEAD CI evidence is indexed in the PR body and audit
handoff; an earlier run is never carried forward after a push.
Scope: `owner-licensing/frontend` only. Reference: [loading system](loading-system.md),
[ADR-0051](../adr/0051-global-request-loading-system.md) (still Proposed),
[frontend standards](standards.md), [Owner separation](../adr/0048-owner-side-licensing-separation-boundary.md).
This adaptation does not approve an ADR or resolve any product question.

## Presentation

- `src/styles/index.css` defines semantic canvas/surface, ink/secondary,
  accent, success, warning and danger tokens using the existing Tailwind palette.
- `public/fonts/Vazirmatn.woff2` is a self-hosted variable Persian font (v33.003,
  SIL OFL; bundled license). No font CDN or additional runtime dependency.
- `PageHeading`, native `Select` and `Input` share typography, 40px control
  height, focus/invalid/disabled styles. `owner-panel`, `owner-toolbar`,
  `owner-success` and `owner-status` are reusable presentation classes.
- The shell has a solid header, isolated username, descriptive navigation icons,
  a logical active border and `aria-current` from NavLink. Navigation is two
  columns on phones and a sticky right-hand rail from the existing `md`
  breakpoint. Main content can shrink, actions wrap, and long references wrap.
- Existing lists remain lists; no fake DataTable, KPI, action, data or capability
  was added. Forms, URL filtering/pagination, permission predicates and
  operation transitions are unchanged. Unimplemented lifecycle entries still
  explicitly say they are unavailable; they have no simulated action.

## One activity source

Only the request interceptor of `src/api/client.ts` calls `beginRequest`.
TanStack Query owns server data and existing local pending/fetching state; it
**does not** register activity. Every HTTP attempt has a unique numeric token.
The registry holds only scope/message enums, never request data or credentials.

The response interceptor ends its token before error normalization/session
handling. The API helper's `finally` ends the **same** token as a safety net for
errors without an Axios config. `ActivityTracker` is a class instance so Axios
config merging preserves the shared reference. Duplicate/unknown endings are
no-ops. Concurrent requests cannot finalize one another. Cached immutable
snapshots change identity only when activity changes; React subscribes through
`useSyncExternalStore`. No listener is installed by a feature/API call.

Expected 401s remain `/auth/login`, `/auth/logout`, `/auth/me` and especially
`/auth/change-password`: a rejected current password must not claim an ended
session. The existing session probe and cache clearing behavior are unchanged.

## Surfaces

| Situation                          | Feedback                                                                                  | Delay                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------ |
| Session bootstrap                  | Existing `FullPageLoading` with orb, never reused as a modal for ordinary reads           | Immediate                      |
| Initial section data               | `LoadingState` with label, decorative orb and page-shaped skeleton rows                   | Immediate                      |
| GET / HEAD / OPTIONS               | Decorative header ambient orb; never blocks content                                       | 300 ms                         |
| Refresh with existing section data | `LocalFetchingIndicator`, based on `isFetching && !isPending`                             | 300 ms                         |
| POST / PATCH / PUT / DELETE        | Non-interactive global panel; local pending button remains the primary immediate feedback | 500 ms global; local immediate |
| Completed operation                | Existing success/error/validation channels, not a progress toast                          | Existing behavior              |

There is **no minimum duration**, retry, request delay, new timeout, fabricated
percentage, cache reset or navigation lock. The global panel is pointer-events
none, bottom-end. Completion toasts are bottom-start above its reserved band;
no modal or focus trap was introduced. Only previously disabled mutation
buttons receive `loading={existingPendingFlag}`; their disabled predicates and
labels remain intact. Plain disabled/read-only fields do not imply activity.

`useDelayedFlag` resets its own timer state on an input change during render,
with a guarded state adjustment, and schedules only the show timer in an effect.
A zero-delay hide timer was proven to leak the previous visible state into a
new rapid burst; the regression test protects this fix. Timers and subscriptions
are cleaned on unmount. Ending activity hides immediately.

Do **not** reset the process-wide registry on route exit: another real request
may still be running. Existing query AbortSignals finalize through Axios when
cancelled. Requests that intentionally survive a route remain genuinely active
until settlement; the indicator does not change that business/transport policy.

## Accessibility and animation

- Only `src/ui/thinking-orb.tsx` imports `thinking-orbs@0.3.2`.
- `theme="auto"`, with `<html data-theme="light" dir="rtl" lang="fa">`.
- The real library paints one static frame for reduced motion and handles
  animation/offscreen/visibility resource cleanup; tested through the wrapper.
  CSS also suppresses skeleton animation/transitions for reduced motion.
- Text-adjacent canvases are decorative (`aria-hidden`).
- Global progress is a permanently mounted, initially empty **div** with
  `aria-live="polite"`/`aria-atomic`. Unlike the previous `<output>`, it has no
  implicit `role="status"`, including while active, and does not set `aria-busy`
  on the announcement channel. Toast status semantics remain independent.
- Idle local refresh outputs are hidden from the accessibility tree. Initial
  loading/error/empty states retain their existing section semantics.
- No claim of live screen-reader testing: the tests verify DOM roles/labels,
  focusable controls and reduced-motion scheduling, not spoken output.

## Build independence and maintenance

Run all scripts **inside `owner-licensing/frontend`** with its own manifest and
lock. No root workspace or customer dependency installation is needed.
`dates:stage` resolves paths relative to `import.meta.url`, projects exactly the
seven approved canonical source files, rejects graph drift/missing sources, and
uses Owner-installed type declarations. It runs before dev/typecheck/test/build.
Docker uses repository-root context, its restrictive Dockerfile.dockerignore,
`WORKDIR /repo/owner-licensing/frontend`, and the Owner manifest/lock. These
boundaries, the isolation scans and all CI gates were left unchanged.

Future feedback must use these existing primitives. Do not create another
Axios instance, register from Query hooks, import the orb library in features,
or invent blocking/timeout behavior for visual convenience.

See the [corrective report](../tasks/owner-ui-thinking-orbs-agent-report.md) for
actual commands, CI limitations, screenshots and test evidence.
