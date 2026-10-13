# FE-ARCH-01 — Frontend State-Management Audit

**Date:** 2026-09-29  
**Scope:** `frontend/**` and frontend documentation only  
**Decision status:** Architecture reassessment complete; no global client-state dependency added

## 1. Executive summary

The current frontend is **structurally sound for its present, mostly read-only vertical slice**. It has a clear composition root, one HTTP adapter, generated API types, organization-scoped query keys, server-side filtering/paging/sorting, local interaction state, React Hook Form for form state, and two narrow application contexts. Backend-owned data is not copied into a second client cache.

The required current decision is:

> **NOT NEEDED NOW**

Vardena does not currently need Redux Toolkit, Zustand, MobX, or another global client-state library. The current implementation has no demonstrated complex, client-owned state crossing unrelated feature boundaries. Installing a store now would add a second state mechanism without giving the existing login, organization, dashboard, or read-only accounting surfaces a clearer owner.

TanStack Query remains the canonical server-state mechanism. React state remains the default for local interaction state. React Context remains appropriate for the session facade and current organization dependency. A global client-state library is now explicitly **permitted**, but optional and subject to an evidence-based architecture decision.

If a future global store is justified by a real cross-feature workspace, the conditional preference is **Redux Toolkit** for Vardena's likely ERP-scale transition complexity, explicit actions, selectors, DevTools, and testability. That is a future selection preference, not approval to install it now. TanStack Query would continue to own all backend data; Redux Toolkit Query would not be introduced alongside it.

This audit made four bounded corrections:

1. replaced the active Redux/Zustand prohibition with a technology-neutral ownership policy in `docs/frontend/standards.md` and `frontend/README.md`;
2. corrected the inaccurate claim in `frontend/src/app/query-client.ts` that ADR-0002 forbade global stores;
3. clarified the historical, non-prescriptive wording in the Task 22 report and acceptance record;
4. made session-expiry cleanup clear the complete TanStack Query cache, including Inventory and Workflow data, rather than only selected namespaces in `frontend/src/features/auth/session-context.tsx`.

No backend, Prisma, migration, API contract, backend ADR, backend OQ, permission, or domain-rule file was changed. No frontend feature was started and no dependency was added.

## 2. Current frontend architecture

### 2.1 Composition and dependency flow

The composition root is small and understandable:

```text
frontend/src/main.tsx
  -> frontend/src/app/App.tsx
       -> AppProviders
            -> QueryClientProvider
                 -> SessionProvider
                      -> OrganizationProvider
       -> BrowserRouter
            -> AppRoutes
```

Evidence:

- `frontend/src/app/providers.tsx` creates one stable `QueryClient` and establishes the dependency order Query -> Session -> Organization.
- `frontend/src/app/router.tsx` owns route composition and UX-only authentication/permission boundaries.
- `frontend/src/app/layouts/app-shell.tsx` composes shell concerns and keeps drawer visibility in local state.
- `frontend/src/app/query-client.ts` owns global query defaults: no mutation retries, bounded query retries, 30-second default staleness, and no default focus refetch.

This composition preserves backend independence: browser code calls only the Vardena API through `frontend/src/api/client.ts`, with a relative base URL and httpOnly cookie transport.

### 2.2 Data and feature boundaries

The implementation separates the main layers reasonably well:

- `frontend/src/api/**` is the transport/contract boundary. `client.ts` contains the sole Axios instance; `*.api.ts` functions map to backend endpoints; `contracts.ts` derives types from `frontend/src/api/generated/vardena-api.d.ts`.
- `frontend/src/api/query-keys.ts` centralizes query identity.
- `frontend/src/features/**` owns feature hooks, forms, view state, and rendering.
- `frontend/src/ui/**` contains reusable primitives and display patterns such as `DataTable` and pagination.
- `frontend/src/lib/**` contains cross-cutting format, sort, i18n, and debounce utilities.
- `frontend/src/app/**` is the composition root rather than a business-state layer.

The Dashboard correctly consumes Accounting references through the application API layer rather than importing Accounting feature internals (`frontend/src/features/dashboard/api/use-dashboard-references.ts`). This preserves a useful distinction between shared backend resources and feature presentation code.

There is some boundary drift around application capabilities: Accounting and Dashboard import Organization and Permissions hooks directly, and Permissions imports the Auth hook. The imports are of intentionally public hooks, not private rendering details, but there are no explicit feature public entry points. This is maintainable at current size; before many more features are added, public capability APIs or placement under an application/shared layer should be made explicit rather than allowing arbitrary feature-to-feature imports.

### 2.3 What is good

- **Single server cache:** `@tanstack/react-query` is the only server-state cache in `frontend/package.json` and runtime code.
- **Single transport:** `frontend/src/api/client.ts` is the only Axios client. The audit found no component-level `fetch` or Axios call.
- **Generated contract types:** `frontend/src/api/contracts.ts` and `frontend/src/api/generated/vardena-api.d.ts` preserve OpenAPI ownership.
- **Organization-safe cache identity:** every organization-scoped key in `frontend/src/api/query-keys.ts` includes `organizationId`.
- **Cancellation:** query functions consistently forward TanStack Query's `AbortSignal` to API adapters.
- **Server-side list ownership:** report and dashboard requests include page, page size, filters, and allow-listed sort parameters in query identity; `frontend/src/ui/patterns/data-table.tsx` uses manual sorting and pagination.
- **Exact accounting values:** accounting adapters and views leave decimal values as contract strings; no client store performs financial aggregation as a substitute for the backend.
- **Appropriate local state:** menu visibility, chart expansion, account search input, debounce state, dismissed notices, and report interaction state are colocated with their owners.
- **Appropriate form state:** login and report filters use React Hook Form and Zod rather than Context or a global store.
- **UX-only permission model:** permission data is backend-owned server state, and all frontend checks are documented as presentation gates rather than security controls.

### 2.4 Unnecessary complexity and duplication

No large architectural layer is currently unnecessary. In particular, the two Context providers are not substitutes for a state library; they are small facades around application dependencies.

The main duplication is query declaration for the same Accounting references:

- `frontend/src/features/accounting/shared/use-accounting-references.ts`
- `frontend/src/features/dashboard/api/use-dashboard-references.ts`
- the period query embedded in `frontend/src/features/dashboard/dashboard-page.tsx`

They correctly share API functions and query keys, so they share cache entries, but repeat query functions, staleness, and parameter construction. Typed `queryOptions` factories per backend resource would reduce drift when another consumer appears. This is a bounded later refactor, not a reason to centralize presentation state or install a global store.

### 2.5 Risks and accidental constraints

1. **The global-store ban was accidental and overstated.** `frontend/README.md`, `docs/frontend/standards.md`, and a comment in `frontend/src/app/query-client.ts` treated Redux/Zustand/MobX as forbidden. ADR-0002 does not contain that prohibition; `docs/adr/0002-technology-stack.md` fixes the current stack and requires an ADR for additions. The active policy has been corrected.
2. **Session-expiry cache lifecycle was incomplete.** The unauthorized handler in `frontend/src/features/auth/session-context.tsx` removed Identity permissions, Accounting, and Organization data but omitted Inventory and Workflow query namespaces already used by the Dashboard. That contradicted its own promise to drop every previous-session server value. It now clears the whole QueryClient cache and re-establishes only the unauthenticated session value, matching logout behavior.
3. **Accounting report URL state is not yet compliant with the standards.** `frontend/src/features/accounting/shared/use-report-query-state.ts` stores applied filters, page, page size, and sorting in component state. This is valid client interaction state, but unlike `frontend/src/features/dashboard/dashboard-page.tsx`, it is not linkable or restorable. It belongs in router search parameters for report pages; it does not belong in Redux or Zustand.
4. **Query definitions are only partially centralized.** `frontend/src/api/query-keys.ts` is coherent, but key functions accept broad `Record<string, unknown>` filters and feature hooks use `'none'` sentinels plus type assertions for disabled queries. This works because `enabled` blocks execution, but typed option factories would improve compile-time safety.
5. **Context subscription breadth could grow.** `SessionContextValue` currently combines user, permissions, login/logout mutation state, and expiry notification. This is acceptable at current scale, but unrelated consumers will all rerender when any value changes. Split query hooks or contexts only if profiling or feature growth demonstrates a problem.
6. **Documentation topology drift exists.** The active frontend standard describes `src/shared`, while the implemented, documented architecture uses `src/api`, `src/ui`, and `src/lib`. This does not create incorrect state ownership today, but the standards and actual public-boundary model should be reconciled in a separate documentation task rather than through a speculative source-tree move.

## 3. Current state ownership map

| State/fact                                      | Current owner                                        | Mechanism                                                        | Assessment                                             | Evidence                                                                                                                  |
| ----------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Authenticated user/session probe                | Backend                                              | TanStack Query                                                   | Correct                                                | `frontend/src/features/auth/session-context.tsx`, key `queryKeys.session()`                                               |
| Effective permissions                           | Backend                                              | TanStack Query                                                   | Correct; Context only exposes a facade                 | `frontend/src/features/auth/session-context.tsx`, `frontend/src/features/permissions/use-permissions.ts`                  |
| Login/logout request lifecycle                  | Backend mutation plus local pending/error view       | TanStack Query mutation                                          | Correct                                                | `frontend/src/features/auth/session-context.tsx`                                                                          |
| Session-expired notice                          | Client UI lifecycle                                  | React state in Session provider                                  | Correct                                                | `frontend/src/features/auth/session-context.tsx`                                                                          |
| Accessible organizations                        | Backend                                              | TanStack Query                                                   | Correct                                                | `frontend/src/features/organization/organization-context.tsx`                                                             |
| Current organization selection                  | Client application scope, constrained by server list | React state exposed through scoped Context                       | Correct for current simple lifecycle                   | `frontend/src/features/organization/organization-context.tsx`                                                             |
| Dashboard documents/balances/inventory/workflow | Backend                                              | TanStack Query                                                   | Correct                                                | `frontend/src/features/dashboard/api/use-dashboard-data.ts`                                                               |
| Accounting chart and reports                    | Backend                                              | TanStack Query                                                   | Correct                                                | `frontend/src/features/accounting/**/use-*.ts`                                                                            |
| List filters/paging/sorting                     | Client navigation/query state                        | Dashboard: router search params; accounting reports: React state | Dashboard correct; reports should migrate to URL later | `frontend/src/features/dashboard/dashboard-page.tsx`, `frontend/src/features/accounting/shared/use-report-query-state.ts` |
| Login/report form input                         | Local form                                           | React Hook Form + Zod                                            | Correct                                                | `frontend/src/features/auth/login-page.tsx`, Accounting report pages                                                      |
| Sidebar open/closed                             | Local shell interaction                              | React state                                                      | Correct                                                | `frontend/src/app/layouts/app-shell.tsx`                                                                                  |
| Chart expanded nodes                            | Local page interaction                               | React state                                                      | Correct                                                | `frontend/src/features/accounting/chart-tree/chart-tree-page.tsx`                                                         |
| Account-picker search/debounce                  | Local component interaction                          | React state/custom hook                                          | Correct                                                | `frontend/src/features/accounting/shared/account-picker.tsx`, `frontend/src/lib/use-debounced-value.ts`                   |
| Dismissed dashboard period notice               | Ephemeral local interaction                          | React state                                                      | Correct                                                | `frontend/src/features/dashboard/components/notice-widgets.tsx`                                                           |
| Table row data                                  | Backend                                              | TanStack Query -> controlled table props                         | Correct; not copied into table/global store            | `frontend/src/ui/patterns/data-table.tsx`                                                                                 |
| Persisted client preferences/drafts             | Not implemented                                      | None                                                             | Correct: no unapproved persistence                     | executable code under `frontend/src/**` has no `localStorage`/`sessionStorage` usage                                      |

There is no Accounting Context, Redux slice, Zustand store, MobX observable, client-side entity cache, or duplicated server-data reducer.

## 4. Current Context audit

### 4.1 SessionContext

**Decision: keep as React Context. No migration is justified.**

`frontend/src/features/auth/session-context.tsx` has an application-wide lifecycle and supplies a narrow capability that unrelated routes need: current user, auth status, login/logout operations, effective-permission facade, and expiry UX. The actual user and permission payloads remain in TanStack Query. Context distributes access; it does not become a second cache.

Responsibilities that should remain where they are:

- `GET /auth/me` and `GET /permissions/effective` remain Query state.
- login/logout remain TanStack mutations.
- the httpOnly token remains browser/backend-owned and absent from JavaScript storage.
- `sessionExpired` remains client-owned notification state.
- API 401 notification remains connected at the provider boundary rather than in components.

Potential later extraction, only if growth warrants it:

- expose effective permissions through a dedicated query/capability hook rather than carrying them in the same Context value;
- split mutation controls from read-only session data if broad rerenders become measurable;
- move transport-to-session expiry signalling to a more explicit application event boundary if multiple transports ever exist.

Redux or Zustand would not materially improve the current provider. They would merely relocate one boolean and wrap Query-owned values in another subscription system.

### 4.2 OrganizationContext

**Decision: keep as React Context. No migration is justified.**

`frontend/src/features/organization/organization-context.tsx` owns one small cross-tree dependency: which server-returned organization should scope requests. It intentionally validates selection against the current organizations query and exposes one derived `organizationId` used across pages. Accessible organizations themselves remain Query data.

The provider is not becoming an application-state container: it contains one selected id, derived organization fields, status, and a refresh action. It has no feature drafts, report data, table data, or business workflow transitions.

Responsibilities should stay separated as follows:

- accessible organizations: TanStack Query;
- membership/pin/authorization: backend only;
- selected id: client application scope in Context;
- feature data for the selected organization: separate organization-keyed queries;
- per-page filters and selections: URL/local feature state, not OrganizationContext.

A store would become relevant only if organization/workspace switching acquires richer client-owned semantics such as multiple open workspaces, per-organization unsaved drafts, cross-route restoration, or coordinated commands. None exists now.

### 4.3 Are the contexts global-state containers?

No. They are top-level providers, but scope is determined by responsibility rather than tree height. A provider being application-wide does not by itself make it an inappropriate global store. Both contexts expose cohesive application dependencies and keep backend data in TanStack Query.

## 5. TanStack Query audit

### 5.1 Canonical ownership

TanStack Query is used as the canonical mechanism for backend-owned data and must remain so. Evidence includes:

- app-wide configuration in `frontend/src/app/query-client.ts`;
- all API reads wrapped by `useQuery` in Auth, Organization, Dashboard, and Accounting hooks;
- all current API writes (login/logout) wrapped by `useMutation`;
- no executable direct HTTP call from a component;
- no Redux/Zustand/MobX dependency or parallel entity cache.

### 5.2 Server-state duplication

No material duplication was found. Context values reference/derive Query results rather than copying them into independent state. Table components receive query result rows directly. Dashboard transformations derive display data during render or in pure functions. Form state represents request criteria, not a copied backend entity.

The `applied` object in `use-report-query-state.ts` is client-owned request state. It should eventually move to URL ownership, but it is not server-state duplication.

### 5.3 Query keys and organization scope

`frontend/src/api/query-keys.ts` is coherent:

- module namespaces start keys (`identity`, `rbac`, `organization`, `accounting`, `inventory`, `workflow`);
- all organization-scoped resource keys include `organizationId` before resource/filter identity;
- filter, paging, and sorting objects are part of list/report keys;
- changing organizations creates distinct cache entries rather than reusing another organization's rows.

The unscoped Organizations list is correctly session-owned: it represents the organizations discoverable to the current principal. Full cache clearing at logout/401 provides the principal boundary.

Improvement opportunity: add typed resource-level key/options factories and `all` roots consistently for targeted future invalidation. Do this with the first write-heavy feature, not as a speculative rewrite.

### 5.4 Query functions, cancellation, retries, and stale times

- Query functions forward `signal` into `frontend/src/api/*.api.ts` adapters.
- Search is debounced centrally by `frontend/src/lib/use-debounced-value.ts` and query-key changes provide latest-result behavior.
- Global query retries stop after two attempts and terminal 4xx/business responses are not retried (`frontend/src/app/query-client.ts`).
- Mutations never auto-retry.
- Session/permission/organization probes deliberately disable retries.
- five-minute staleness is used for reference data; shorter intervals are used for operational/dashboard data.
- focus refetch is off by default, with an explicit session-probe exception.

These choices are reasonable for the current financial UI.

### 5.5 Mutations and invalidation

Only authentication mutations exist in the current frontend:

- login writes the authoritative returned user into the session query and invalidates effective permissions;
- logout clears all previous-principal cache data and sets the session to unauthenticated;
- a non-probe 401 now performs the same whole-cache security cleanup.

There are no accounting, inventory, document, or workflow mutations to assess yet. Future feature mutations must invalidate exact entity/list roots, avoid blanket cache clearing during normal operation, and avoid optimistic updates for financial finalization/posting/reversal actions.

### 5.6 Findings

Overall result: **correct use with bounded maintainability improvements**. TanStack Query should not be replaced by Redux, Redux Toolkit Query, Zustand, or MobX for backend data.

## 6. Global state requirement analysis

> **NOT NEEDED NOW**

Repository evidence:

- `frontend/package.json` includes TanStack Query but no Redux Toolkit, React Redux, Zustand, or MobX.
- only `SessionContext` and `OrganizationContext` are created (`frontend/src/features/auth/session-context.tsx`, `frontend/src/features/organization/organization-context.tsx`);
- no `useReducer` implementation exists;
- local `useState` usage is limited to provider-local session/organization UI state and colocated component/page interaction;
- executable source uses neither `localStorage` nor `sessionStorage`;
- current Accounting is read-only; there is no document editor, line-editor reducer, cross-page draft, bulk-operation queue, keyboard-command registry, or multi-workspace model;
- Dashboard navigation state already uses URL search params, and server values use Query.

A global library now would have no legitimate initial slice other than state already better owned by Query, URL, forms, local state, or narrow Context. That would encourage server-cache mirroring and premature architectural coupling.

Conditions that would justify reopening the decision:

1. one coherent client-owned workspace is used by multiple unrelated routes/features;
2. state must survive feature unmounts but is not backend-owned or URL state;
3. many components need selective subscriptions and Context causes demonstrable broad updates or provider coupling;
4. transitions form a nontrivial state machine requiring auditable actions, undo/redo, command history, or deterministic replay;
5. multiple document editors/drafts are open concurrently and coordinated across routes;
6. application-wide keyboard commands, bulk-operation selection, or workspace panes need one lifecycle;
7. persistence of explicitly approved client drafts/preferences requires versioned hydration and migrations;
8. local/context implementations have measured complexity, not merely anticipated complexity.

Meeting one condition should trigger a design review; it does not automatically require a store. A scoped reducer plus Context may still be sufficient.

## 7. Redux Toolkit evaluation

### Vardena-specific strengths

- explicit actions and reducers make ERP workspace transitions reviewable;
- TypeScript support and typed selectors suit complex discriminated workflow/editor states;
- selector subscriptions can isolate high-frequency line-editor or workspace updates;
- Redux DevTools provides action history useful for hard-to-reproduce multi-step document editing;
- reducer and selector tests are deterministic and independent of React rendering;
- conventions around slices, middleware, serializability, and store topology reduce architectural variation as features/teams grow;
- it scales better than ad hoc Context chains if Accounting, Inventory, Workflow, bulk operations, and command state genuinely converge on one client workspace.

### Costs and constraints

- it is a new major dependency under `docs/adr/0002-technology-stack.md` and AR-30, so an ADR/design decision is required before installation;
- actions/slices/selectors add ceremony that current state does not need;
- it creates a serious temptation to mirror Query data;
- Redux Toolkit Query would duplicate TanStack Query and therefore should not be introduced;
- indiscriminate slices for modals, forms, or fetched entities would make ownership worse, not better.

### Recommendation

Do not install Redux Toolkit now. If a future store is required for **complex cross-feature ERP client state**, Redux Toolkit is the preferred default candidate because explicit transitions and long-term consistency matter more for that problem than minimal setup code. The approving ADR must define store boundaries and explicitly retain TanStack Query for server state.

## 8. Zustand evaluation

### Vardena-specific strengths

- small API and low setup cost;
- ergonomic TypeScript selectors and selective subscriptions;
- easy to colocate a bounded store with a document-editor workspace;
- straightforward unit testing of store actions without rendering providers;
- suitable if Vardena's demonstrated need is one focused client-owned workspace rather than an application-wide transition model.

### Risks at ERP scale

- low ceremony also makes it easy to create many unrelated stores without a consistent lifecycle;
- action/event conventions, middleware, DevTools discipline, serialization, and persistence rules must be designed by the team rather than supplied by one strong architecture;
- direct state access can blur feature boundaries and encourage imperative coupling;
- a collection of convenient feature stores can become harder to govern than one explicit Redux store as cross-feature workflows grow.

### Recommendation

Zustand is a legitimate alternative, not forbidden. It should be selected over Redux Toolkit only if a concrete spike shows that the required state is bounded, transition complexity is modest, and the team commits to one store architecture with typed selectors/actions and tests. It is not justified for current Session or Organization state.

## 9. MobX evaluation

MobX can model complex observable graphs and computed values, so it is technically capable of supporting editors and workspaces. It is not recommended for current or foreseeable default Vardena architecture because:

- implicit observable mutation is less aligned with the desired explicit, predictable ERP transitions;
- tracing ownership and action history across modules is harder without strong MobX-specific discipline;
- it introduces a distinct reactive mental model alongside React and TanStack Query;
- no repository or team-convention evidence favors MobX;
- it offers no current benefit for the small amount of client-owned shared state.

MobX remains permitted by the technology-neutral policy, but would require a particularly strong, documented use case and team-expertise rationale. Do not introduce it merely because it is capable.

## 10. Future ERP state-management model

| Future requirement              | Server state                                                                      | URL state                                                               | Local/form/scoped state                                                             | Possible global client state                                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Accounting document list/detail | Query owns lists, detail, status, server totals                                   | list filters/page/sort and document route id                            | modal/active tab local                                                              | none by default                                                                                                          |
| Accounting document editor      | Query owns loaded document, reference data, save/finalize responses               | document id/mode when linkable                                          | RHF plus feature-scoped reducer/Context for line editing and validation interaction | only for multiple open editors, cross-route draft workspace, undo/redo, or command history                               |
| Document lines                  | backend remains authoritative after save; never mirror canonical rows globally    | selected line only if linkability is useful                             | editor-local field-array/reducer, stable line ids                                   | normalized client draft graph only when a demonstrated multi-editor workspace requires it                                |
| Inventory operations            | Query owns items, warehouses, balances, reservations, movements, operation status | list filters/page/sort                                                  | operation form, scanner input, row selection local to workflow                      | cross-feature picking/receiving workspace only if it spans routes and survives unmounts                                  |
| Workflow approval               | Query owns instance, history, assignees, and mutation results                     | instance id/filter state                                                | decision modal and reason form local                                                | only a client-owned multi-item approval workspace/queue, not workflow truth                                              |
| Organization switching          | Query owns accessible organizations                                               | optional route parameter only if product semantics require shareability | current simple selection remains OrganizationContext                                | only multi-workspace/per-organization draft coordination                                                                 |
| Permissions                     | Query owns effective codes; backend authorizes                                    | none                                                                    | permission checks derived in hooks                                                  | never duplicate into a store                                                                                             |
| Dashboards                      | Query owns widgets/read models                                                    | date/range/view parameters                                              | widget expansion/dismissal local                                                    | user-editable cross-page layout workspace only; persisted preference remains backend state when a preferences API exists |
| Reporting                       | Query owns results/export job status                                              | all reproducible filters/page/sort                                      | transient filter-form edits in RHF until Apply                                      | none by default                                                                                                          |
| Bulk operations                 | Query owns server job and results                                                 | list criteria                                                           | page-local selected ids when bounded                                                | justified if selection/operation queue intentionally spans pages/features and has a defined lifecycle                    |
| Multi-step forms                | Query owns reference/load/save data                                               | step when deep-linking is intended                                      | RHF plus feature-scoped reducer/Context                                             | only if the draft spans unrelated routes or multiple concurrent processes                                                |
| Complex tables                  | Query owns rows                                                                   | filters/page/sort/grouping                                              | hover, open menu, local row interaction                                             | column/workspace preferences only if client-owned; backend preference data remains Query-owned                           |
| Keyboard shortcuts              | none unless commands call APIs                                                    | none                                                                    | component shortcuts local                                                           | central registry is a valid store candidate when commands cross features and need conflict resolution                    |
| Workspace panes/selections      | entity content remains Query-owned                                                | linkable active resource                                                | single-page layout can remain local/Context                                         | strong candidate when panes, active editors, command routing, and selections cross feature/route boundaries              |

### Backend contract gaps exposed by foreseeable UI needs

No backend change is requested by this audit. The following are documentation/design gates only:

- `frontend/src/app/layouts/topbar-search.tsx` documents that no global-search endpoint exists, so the UI correctly does not invent results.
- `frontend/src/api/dashboard.api.ts` documents that workflow list data is not an approval-decision screen/read model.
- the project context records that the Customization module is not implemented; application-level persisted table/workspace preferences therefore cannot yet be treated as backend server state.
- persistent document drafts, autosave conflict/version semantics, and cross-device draft behavior require explicit product/API contracts before any client persistence is designed.

A global store would not fill any of these contract gaps; it cannot become a substitute backend.

## 11. Required refactors

| Classification         | Finding/action                                                                                                | Status and evidence                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **KEEP**               | TanStack Query as the only backend-data cache                                                                 | `frontend/src/app/query-client.ts`, `frontend/src/api/query-keys.ts`, feature query hooks                                                                              |
| **KEEP**               | one Axios adapter and generated OpenAPI types                                                                 | `frontend/src/api/client.ts`, `frontend/src/api/contracts.ts`, `frontend/src/api/generated/vardena-api.d.ts`                                                           |
| **KEEP**               | local state for shell, chart expansion, search, notice dismissal                                              | relevant components under `frontend/src/app` and `frontend/src/features`                                                                                               |
| **KEEP**               | React Hook Form + Zod for form state                                                                          | login and Accounting report pages                                                                                                                                      |
| **KEEP**               | SessionContext and OrganizationContext                                                                        | no migration justified; responsibilities remain cohesive                                                                                                               |
| **REFACTOR NOW**       | replace the active global-library prohibition with ownership-based policy                                     | Completed in `docs/frontend/standards.md` §۵ and `frontend/README.md`                                                                                                  |
| **REFACTOR NOW**       | remove false ADR-0002 ban attribution                                                                         | Completed in `frontend/src/app/query-client.ts`                                                                                                                        |
| **REFACTOR NOW**       | prevent previous-principal Inventory/Workflow cache survival after arbitrary 401                              | Completed with full QueryClient clear in `frontend/src/features/auth/session-context.tsx`; regression covered by `frontend/src/features/auth/session-context.test.tsx` |
| **REFACTOR NOW**       | clarify historical Task 22 wording so it is not read as current policy                                        | Completed in `docs/tasks/task-22/task-22-implementation-report.md` and `docs/tasks/task-22/task-22-acceptance-record.md`                                               |
| **REFACTOR LATER**     | move Accounting report filters/page/page size/sort to router search params                                    | `frontend/src/features/accounting/shared/use-report-query-state.ts`; do with a focused report-navigation refactor and behavior tests                                   |
| **REFACTOR LATER**     | create typed reusable query-options factories for shared Accounting references                                | consolidate repeated declarations from Accounting and Dashboard without moving server state to Context/store                                                           |
| **REFACTOR LATER**     | add typed key roots/options for future targeted mutation invalidation and remove `'none'`/broad-cast patterns | do with the first write-heavy feature, before mutation count grows                                                                                                     |
| **REFACTOR LATER**     | formalize public APIs/placement for Auth, Organization, and Permissions capabilities                          | avoid speculative tree move; address before many more domain features consume these hooks                                                                              |
| **REFACTOR LATER**     | split Session Context only if profiling/growth shows broad subscription cost                                  | no current evidence justifies it                                                                                                                                       |
| **NO CHANGE REQUIRED** | install Redux Toolkit, Zustand, or MobX                                                                       | current decision is NOT NEEDED NOW                                                                                                                                     |
| **NO CHANGE REQUIRED** | backend APIs, DTOs, permissions, Prisma, migrations, domain rules                                             | outside scope and unnecessary for this audit                                                                                                                           |

## 12. Documentation changes

### Active documentation corrected

- `docs/frontend/standards.md`
  - version advanced from 2.1 to 2.2 under its existing governance rule;
  - §۵ now defines state ownership and the required hierarchy;
  - Redux Toolkit, Zustand, and MobX are neither mandated nor forbidden;
  - only one deliberately selected global library may be used when justified;
  - TanStack Query remains canonical for backend data;
  - an accidentally pasted prior task instruction block was removed from the end of the canonical standard.
- `frontend/README.md`
  - the explicit ban was replaced with a concise ownership policy.
- `frontend/src/app/query-client.ts`
  - the comment now accurately describes Query ownership and no longer claims ADR-0002 bans stores.

### Historical documentation clarified

- `docs/tasks/task-22/task-22-implementation-report.md`
- `docs/tasks/task-22/task-22-acceptance-record.md`

These records still truthfully state that Task 22 introduced no global store, but now explicitly identify that as historical scope/evidence rather than a continuing architecture prohibition.

### ADR audit

No existing ADR contains the old explicit rule. In particular, `docs/adr/0002-technology-stack.md` lists the accepted current frontend stack and requires an ADR for additions; it does **not** say Redux, Zustand, or MobX is forbidden. Therefore no existing ADR should be amended or silently superseded by this task.

If a global store is later justified, it is a new major dependency under ADR-0002/AR-30. A new decision record should then be created through the normal process. This report does not invent an ADR number.

## 13. Final architecture decision

The approved state-management hierarchy is:

```text
Backend-owned data
        ↓
TanStack Query

Local component interaction
        ↓
React state

Small scoped dependency/context
        ↓
React Context

Complex cross-feature client-owned state
        ↓
Approved global state library (optional)
```

Additional rules:

1. Ownership, not component count, selects the mechanism.
2. Backend data stays in TanStack Query even when many features consume it.
3. URL-addressable state stays in Router search params.
4. Form values and form interaction stay in React Hook Form/Zod.
5. Context is for cohesive, narrow cross-tree dependencies, not a generic object bag or server cache.
6. A global client store is permitted only for demonstrated complex client-owned state crossing feature boundaries.
7. Select one global library deliberately and use it consistently; do not mix Redux, Zustand, and MobX without a separate, compelling architecture justification.
8. No global state dependency is approved or installed by this audit.

**Library recommendation:** **No global state library for now.** If future evidence meets the triggers in §6, evaluate the concrete state model; for a complex ERP-wide workspace, prefer Redux Toolkit unless a bounded-state spike demonstrates Zustand is the simpler sustainable fit. MobX is not the default recommendation.

## 14. Migration strategy if a global store becomes necessary

1. **Document the concrete problem.** List state fields, owners, consumers, lifecycle, transitions, persistence, and why URL/local state/feature Context is insufficient.
2. **Separate ownership first.** Mark every field as backend-owned, URL-owned, form-owned, local UI, or genuinely shared client-owned. Only the last category is eligible.
3. **Measure current pain.** Record provider coupling, rerender/profile evidence, transition defects, or cross-route lifecycle needs. Do not migrate based on anticipated ERP size alone.
4. **Create the required architecture decision.** Evaluate Redux Toolkit and Zustand against the concrete model, bundle/runtime impact, team familiarity, testing, persistence, and DevTools. Do not invent the ADR number in advance.
5. **Choose one library and boundaries.** Define one store topology, typed selectors/actions, ownership rules, and prohibited contents. Explicitly prohibit API entities, Query loading/error state, auth tokens, and raw business-data persistence.
6. **Pilot one bounded workspace.** A complex document-editor workspace is a plausible pilot. Keep server reads/mutations in Query; store only client draft/workspace transitions that Query, URL, RHF, and local reducers do not own.
7. **Avoid dual ownership.** Migrate an eligible client-state unit atomically. Do not keep Context/local/store copies synchronized indefinitely.
8. **Use selectors, not broad subscriptions.** Components subscribe to the minimum client-owned state needed. Keep feature APIs explicit.
9. **Version persistence if explicitly approved.** Use a strict allow-list and migration/version policy. Never persist tokens; do not persist business documents or drafts without an explicit product/security decision.
10. **Test transitions and integration.** Unit-test reducers/actions/selectors or store actions, then test observable editor/workspace behavior and Query mutation/invalidation boundaries.
11. **Reassess after the pilot.** Confirm that the store reduced complexity before adding more slices. Remove superseded Context/reducer code and update frontend standards/documentation.

This is not a migration plan for current code; it is a controlled gate for a future demonstrated need.

## 15. Verification results

Verification is run from `frontend/` against the resulting source and documentation changes. Backend E2E suites are intentionally not part of this frontend-only task.

| Check                  | Command                                                                                      | Result                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Dependency install     | `npm ci`                                                                                     | PASS — 215 packages installed; audit found 0 vulnerabilities                                             |
| TypeScript             | `npm run typecheck`                                                                          | PASS — exit 0                                                                                            |
| Lint                   | `npm run lint`                                                                               | PASS — 0 warnings, 0 errors across 117 files                                                             |
| Unit/integration tests | `npm test`                                                                                   | PASS — 20 files, 112 tests                                                                               |
| Production build       | `npm run build`                                                                              | PASS — 2,204 modules transformed; production assets emitted                                              |
| Frontend formatting    | `npm run format:check`                                                                       | PASS — all frontend files match Prettier                                                                 |
| Audit report format    | `npx prettier --check ...frontend-state-management-audit.md`                                 | PASS after formatting                                                                                    |
| Scope check            | `git status --short`, `git diff --name-only`, `git diff --check`, backend/Prisma diff checks | PASS — only eight frontend/frontend-documentation files; no whitespace errors; no backend/Prisma changes |
| State-library check    | repository search and `frontend/package.json` inspection                                     | PASS — no Redux Toolkit, React Redux, Zustand, or MobX dependency added                                  |
| HTTP/storage check     | source search                                                                                | PASS — no direct component Axios/fetch and no executable browser-storage use                             |

The test command emitted two existing jsdom/React warnings that the semantic HTML `<search>` element in `frontend/src/app/layouts/topbar-search.tsx` is unrecognized in that test environment; all tests passed. The build emitted two non-fatal Rollup annotation warnings from installed Zod files under `node_modules`; the application production build completed successfully. Neither warning was introduced by the changed state-management code. Backend E2E tests were not run, in accordance with this task's frontend-only scope.
