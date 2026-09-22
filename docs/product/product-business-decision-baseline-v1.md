# Vardena — Product & Business Decision Baseline v1

## 1. Document Metadata

| Field | Value |
|---|---|
| Title | Vardena Product & Business Decision Baseline |
| Document ID | PB-BASELINE |
| Version | 1.0 |
| Status | **Proposed — pending product-owner approval** |
| Owner | Ali Esmaeili (product, commercial, scope and strategic authority) |
| Contributors | Product/business clarification round with Ali Esmaeili; governance documentation prepared by the architecture/documentation agent |
| Created | 2026-09-22 |
| Last updated | 2026-09-22 |
| Related documents | [`docs/architecture.md`](../architecture.md) · [`docs/modules.md`](../modules.md) · [`docs/security.md`](../security.md) · [`docs/integrations.md`](../integrations.md) · [`docs/database-strategy.md`](../database-strategy.md) · [`docs/reporting-strategy.md`](../reporting-strategy.md) · [`docs/open-questions.md`](../open-questions.md) · [`docs/adr/`](../adr/README.md) · [`docs/decisions/product/README.md`](../decisions/product/README.md) · [`docs/product/mvp-scope-proposal-v1.md`](./mvp-scope-proposal-v1.md) · [`docs/product/development-roadmap-v1.md`](./development-roadmap-v1.md) · `.vardena/project-context.md` · `.vardena/architecture-rules.md` · `.vardena/agent-rules.md` |

This document is **documentation and decision governance only**. It implements no
code, no schema change, and no migration. It is a proposal until the product
owner approves it; approval is recorded by moving the status to Accepted.

### 1.1 Classification legend

Every substantive statement below carries one of six markers:

| Marker | Meaning |
|---|---|
| **DECIDED** | The product owner stated this explicitly and unambiguously. Binding. |
| **DIRECTIONAL** | The owner set a direction or intent, but details/timing are open. Direction binding; details open. |
| **ASSUMED** | Recorded so the project does not stall, explicitly labeled as an assumption (AG-09/AR-31 style), **not** owner-approved. |
| **OPEN QUESTION** | Genuinely unresolved; registered as OQ or ADR (Phase 3). |
| **CONFLICTING / NEEDS CLARIFICATION** | Contradiction between statements or with prior repo decisions; recorded, not silently resolved. |
| **RECOMMENDATION** | The preparer's recommendation, not a decision. Requires owner approval to become binding. |

---

## 2. Executive Summary

Vardena is an independent, proprietary, modular ERP product **owned by Ali
Esmaeili**. It is architecturally a NestJS modular monolith with vertical-slice
modules, PostgreSQL/Prisma, REST/OpenAPI, and a React SPA — already established
in the repository's accepted ADRs (ADR-0001, ADR-0002). (DECIDED)

The product targets Iranian small and medium businesses, is delivered as a
**separate installation per customer** (web app over the customer's internal
LAN, with single-user local operation supported), and operates **without any
mandatory internet dependency for daily operations**. (DECIDED)

The MVP concentrates on four operational modules — **Accounting, Inventory,
Sales, Report Builder** — standing on a set of platform foundations (identity,
RBAC, organization, documents, workflow, license, integration, audit,
backup/restore) that are largely already built as foundations. (DECIDED)

Vardena is **fully independent of FaraPayam**. FaraPayam may exist only as an
optional external integration via the existing adapter layer (ADR-0003,
ADR-0004). (DECIDED)

The commercial model is a setup fee + base license + support subscription +
paid modules/custom development, with license enforcement implementation details
still open. (DIRECTIONAL / OPEN)

Iranian compliance (accounting standards, tax, e-invoicing via the Taxpayer
System, legal books, payroll/social-security context, statutory reports) is a
core differentiator and a required program, with exact scope, effective dates
and review cadence still requiring expert input and owner sign-off.
(DIRECTIONAL / OPEN)

A controlled set of high-stakes decisions remains open — multi-device offline
sync, license expiry behavior, multi-currency accounting rules, Report Builder
MVP depth, API access model, taxpayer release boundary, backup RPO/RTO, and
others — and is registered in Phase 3 as OQ-44…OQ-61 plus two proposed ADRs.
None of these is resolved in this document.

---

## 3. Product Definition

### 3.1 What Vardena is

- An independent, **proprietary, modular ERP product** for Iranian organizations,
  owned and directed by Ali Esmaeili. (DECIDED)
- A **platform core** plus an **ERP main product** composed of independent
  modules (§13). (DECIDED)
- Deployed **per customer**: web application over the customer's internal LAN;
  also supports single-user local operation. (DECIDED)
- Configurable over stable contracts — documents, workflows, numbering, posting,
  master data — rather than forked per customer. (DIRECTIONAL, consistent with
  `docs/architecture/domain/configurability-architecture.md`)

### 3.2 What Vardena is not

- **Not** a microservice system: no microservices unless a future ADR
  explicitly approves extraction (ADR-0001; AR-01). (DECIDED)
- **Not** a FaraPayam derivative: zero dependency on FaraPayam in the core
  (ADR-0003; `docs/integrations.md` §1). FaraPayam may only be an optional
  external integration target. (DECIDED)
- **Not** a multi-tenant SaaS in v1: per-customer separate installations and
  separate databases; SaaS is an architectural possibility only (§9). (DECIDED
  for v1; DIRECTIONAL for the future)
- **Not** an open-source product and **not** source-visible to customers
  (§22). (DECIDED)
- **Not** an over-generic platform-first "ERP engine" with no shipped business
  value; the reference scenario must run end-to-end at MVP (§16, §30). (DECIDED)
- **Not** a product whose business rules are invented by implementers:
  unspecified rules are registered as OQs and asked, per AG-09/AR-31. (DECIDED,
  repo rule reaffirmed)

### 3.3 Product category

General-purpose modular ERP (financial accounting, inventory/warehouse, sales,
reporting) with Iranian statutory compliance capabilities — not an industry
vertical package. (DECIDED)

### 3.4 Target market

Iranian organizations and businesses that need an affordable, modern,
maintainable ERP without mandatory internet connectivity. Initial segment is
SMB (see §6). (DIRECTIONAL — segment sizing is directional; SMB focus DECIDED)

### 3.5 Geographic scope

Iran first. Multi-country operation is out of scope for this baseline and would
require explicit owner approval. (DECIDED for v1)

### 3.6 Ownership and independence

- Product, commercial, scope and strategic authority: **Ali Esmaeili**, final
  authority unless a later explicit decision states otherwise. (DECIDED)
- Brand, IP, codebase, commercial operation and technical direction are
  independent and owned by Ali Esmaeili. (DECIDED)

---

## 4. Product Vision

**DECIDED (direction statement).** Make a modern, dependable, Iranian-compliant
ERP accessible to ordinary Iranian businesses: installable in one operation,
usable by non-specialists, powerful for professionals, running entirely on the
customer's own infrastructure, and sustainable for its owner as an independent
product — not a consulting project, not a feature of someone else's system.

---

## 5. Product Mission

**DECIDED (direction statement).** Deliver, module by module behind stable
contracts, the smallest set of capabilities that lets a real business run its
fiscal-year operation — company, accounts, inventory, sales, statutory-facing
records, reports — with correctness and auditability, while keeping installation
effortless, operation offline-capable, and the architecture intact.

---

## 6. Target Customers

| Topic | Statement | Class |
|---|---|---|
| Initial customer segment | Small and medium businesses (SMB) in Iran, first pilot customers in the owner's existing commercial network. | DECIDED |
| Expected organization sizes | Single-company SMBs first; multi-branch and larger enterprises only through explicitly approved capabilities (§20) and the commercial tiers in §11. | DECIDED (v1 focus) / DIRECTIONAL (upper bound) |
| General ERP positioning | General-purpose ERP: accounting, inventory, sales, reporting — not a vertical package. | DECIDED |
| Industry strategy | **Horizontal first**: no industry-specific editions at launch. Industry-specific legal requirements are handled as configurable compliance scope (§18), and industry packages remain a possible future product line. | DIRECTIONAL |
| Initial geographic market | Iran. | DECIDED |

---

## 7. Product Differentiators

All items below are DECIDED as *intended differentiators* (they are product
commitments). Implementation depth for MVP is scoped in the MVP proposal; where
depth is undecided it is flagged.

1. **Ease of use.** Simple flows for non-specialist users; professional depth
   available where needed (§25). (DECIDED)
2. **Easy installation and deployment.** Controlled install/update by Vardena;
   target is an operationally simple, repeatable deployment on customer
   hardware (Docker Compose stack per ADR-0002/§10 of architecture.md).
   Installation-time simplicity is an MVP acceptance criterion (§30). (DECIDED)
3. **Iranian business requirements.** Persian-context ERP: Jalali calendar
   context, Iranian statutory compliance program (§18), Taxpayer System
   integration (§19), rial-based books (§21). (DECIDED as direction; detailed
   scope OPEN — OQ-43 for statutory data-model constraints)
4. **Configurability.** Configuration over stable core contracts — documents,
   workflows (ADR-0018/0024), numbering, coding structures (ADR-0026/0028),
   posting modes — not per-customer forks. (DECIDED)
5. **Strong reporting.** Reporting is a first-class capability (ADR-0009,
   `docs/reporting-strategy.md`). (DECIDED)
6. **Report Builder.** A visual, permission-aware report-building capability
   (§17). *MVP depth is OPEN — OQ-49.*
7. **Integration capabilities.** Adapter-based external integrations with the
   outbox pattern (ADR-0003/0004). (DECIDED; specific enterprise integrations
   are customer/deal-driven — DIRECTIONAL)
8. **Modular purchasing.** Modules can be licensed and sold separately;
   customers buy what they need (§13, §11). (DECIDED)
9. **Offline / internal-network operation.** No mandatory internet for daily
   operations; LAN web app; single-user local mode (§10). (DECIDED)
10. **Maintainability and supportability.** One deployable (modular monolith),
   migrations-only DB changes, docs-as-architecture, controlled updates (§24).
   (DECIDED)

---

## 8. Ownership and Independence Policy

| Item | Statement | Class |
|---|---|---|
| Ownership | Vardena is owned by **Ali Esmaeili**. All product, commercial, scope and strategic decisions have final authority with him. | DECIDED |
| Independence from FaraPayam | Complete independence: separate codebase, brand, IP, database, commercial operation. | DECIDED |
| No FaraPayam dependency in core | The core contains no FaraPayam code, schema, coupling or runtime dependency. This is already enforced architecturally (ADR-0003 legacy-ERP adapter isolation; AR-18/19; `docs/integrations.md` §1). | DECIDED |
| FaraPayam as external integration | FaraPayam may exist **only** as an optional external integration through the integration adapter layer (destination `faraPayam`, outbox-driven, ADR-0004), e.g. for migrating customer data from a legacy FaraPayam installation. Contract unknown (OQ-04). | DECIDED (principle) / OPEN (contract specifics, existing OQ-04) |
| Brand & commercial operation | Independent brand and commercial identity; not resold or co-branded with FaraPayam. | DECIDED |
| Technical direction | Set by the accepted ADR corpus; changes only through new ADRs approved by the owner. | DECIDED |

---

## 9. Deployment and Distribution Model

| Topic | Statement | Class |
|---|---|---|
| Separate installation per customer | Each customer gets its own installation (own Docker Compose stack on their hardware). Not multi-tenant in v1. | DECIDED |
| Separate database per customer/company | One PostgreSQL database per customer installation. The "one customer, multiple companies/databases" option is **directional** — a customer may acquire additional installations (each with its own database) via additional licenses; a single installation never hosts multiple unrelated companies' books. Cross-installation consolidation is future/enterprise (OQ-59). | DECIDED (per-installation) / DIRECTIONAL (multi-DB per customer) |
| Web app over internal LAN | The product is delivered as a web application consumed on the customer's internal network. | DECIDED |
| Single-user local operation | A customer may run Vardena on a single machine (localhost) with no network at all — supported deployment shape of the same stack. | DECIDED |
| No mandatory internet for daily operations | Daily ERP operation must not require internet. Internet is required only for optional capabilities (e.g. Taxpayer System submission, update downloads) and license validation mechanics (§10, §12, OQ-45). | DECIDED |
| Controlled installation and updates | Installation, updates and migrations are performed/controlled by Vardena (owner or authorized operator), per §24. Customers do not self-serve version upgrades. | DECIDED |
| Future SaaS | SaaS/multi-tenant cloud offering is an **architectural possibility** (ADR-0001 extraction path, ADR-0021 organization-scoped data) — not an immediate commercial commitment and not a v1 design driver. Any SaaS move requires an explicit owner decision and its own ADRs. | DIRECTIONAL / OPEN QUESTION (OQ-59, deferred) |

---

## 10. Offline Strategy

Three distinct capabilities must not be conflated:

### 10.1 Offline without internet, with LAN — **DECIDED for MVP**

The standard deployment: the web app is served inside the customer LAN; users
work on the LAN with no internet dependency whatsoever. Daily operations
(create/receive/issue/sell/post/report) never require internet. Optional
internet-bound features degrade gracefully: outbound integrations queue in the
outbox (ADR-0004) and dispatch when connectivity exists; Taxpayer submission
waits; license validation mechanics are defined by OQ-45 (never blocking
day-to-day operation during outages — that behavior is an explicit open
decision, see §12).

### 10.2 Single-user local operation — **DECIDED for MVP**

One machine, localhost, same stack. This is a supported deployment shape of the
ordinary product, not a different edition. It constrains resource sizing and
installation simplicity (§30) but adds no architectural requirement.

### 10.3 Multi-device disconnected operation with later synchronization — **OPEN / HIGH COMPLEXITY / REQUIRES SEPARATE ARCHITECTURE DECISION**

Operation of multiple devices while *disconnected from each other* (or from the
server) with later merge/synchronization — e.g. a salesman taking orders offline
on the road, or a warehouse in a dead zone — is **not decided, not designed, and
not in the MVP**. This requires:

- a separate architecture decision (conflict model, client-side store,
  per-device identity, merge semantics, security of local caches);
- a product decision on which roles/documents genuinely need it and when;
- its own OQ (**OQ-44**) and a future ADR.

**Status: OPEN / HIGH COMPLEXITY / REQUIRES SEPARATE ARCHITECTURE DECISION
(OQ-44). Explicitly excluded from MVP.**

---

## 11. Commercial and Licensing Model

### 11.1 Intended commercial structure — DECIDED (structure), DIRECTIONAL (numbers)

| Component | Statement | Class |
|---|---|---|
| Setup fee | One-time installation/configuration fee per customer, performed by Vardena. | DECIDED (existence) / DIRECTIONAL (amount) |
| Base license | Annual license for the platform core + the licensed operational modules; renewable as part of the support subscription relationship. | DECIDED (existence) / DIRECTIONAL (term & price) |
| Support subscription | Recurring support subscription covering support and (controlled) updates. | DECIDED (existence) / DIRECTIONAL (price & SLA) |
| Additional modules | Modules beyond the base license are separately purchasable (§13 modular purchasing). | DECIDED |
| Custom development | Custom development offered as a paid service, governed by §26 (core/module/extension/custom/fork/reject decision framework). | DECIDED (existence) / DIRECTIONAL (governance detail) |
| Enterprise capabilities | Larger deals may include enterprise capabilities (e.g. extra installations, advanced integrations, API tiers — §28). | DIRECTIONAL |
| Potential future products | Possible future standalone/adjacent products (e.g. CRM, ticketing, vertical packages, SaaS) — none decided. | DIRECTIONAL |

**Final pricing decisions: not made here and not blocking MVP development.**
Pricing belongs to the owner's commercial process. (Explicitly out of scope —
not an OQ in this governance set.)

### 11.2 License enforcement implementation — ADR REQUIRED (ADR-0030)

The **technical mechanism** of license enforcement (what a license contains,
how it is validated, what is enforced online vs offline, trust model, tamper
resistance) and the **phase question** (foundation now vs commercial
enforcement later) are unresolved. The foundation level to build for MVP is
proposed in **ADR-0030** (minimal, non-punitive, enforcement-off); the
commercial-enforcement timing decision rides on that ADR.

### 11.3 License expiry behavior — OPEN QUESTION (OQ-45)

What happens when a license expires — especially during an internet outage —
is **not decided**. Candidate behaviors (read-only grace, full lockout,
warning-only) have materially different commercial and operational risk
profiles. Registered within **OQ-45**. **The MVP must not implement hard expiry
enforcement until this is decided** (see MVP proposal, category D).

---

## 12. Customer Data Ownership

| Topic | Statement | Class |
|---|---|---|
| Customer owns its data | The customer owns the data it creates in its installation. | DECIDED |
| No deletion at contract end | Upon contract termination, customer data is **not deleted** by Vardena; it remains in the customer's own installation (which is, per §9, on the customer's own infrastructure — the technical default already makes remote deletion impractical; the policy statement is the commitment). | DECIDED |
| Export capability | Customers must be able to export their data in usable formats. | DECIDED |
| Excel export confirmed | Excel (XLSX) export of reports and lists is **confirmed** for MVP (ADR-0011 import ecosystem + reporting export path; ADR-0009 §6). | DECIDED |
| Full-fidelity export format | A documented, complete export format (beyond Excel — e.g. full JSON/SQL dumps with schema documentation) is **not decided** (OQ-46). Excel is confirmed as a channel, not necessarily the complete answer for contract-end data handover. | OPEN QUESTION (OQ-46) |
| Read-only mode after termination | Making an installation read-only after license termination is a **possible policy requiring further decision** (OQ-45 covers expiry behavior; this is the same decision surface, recorded explicitly here as undecided). | OPEN QUESTION |

---

## 13. Product Architecture and Modularity

(DECIDED — consistent with the accepted ADR corpus; restated in product terms.)

- **Platform Core.** The technical/business platform every installation needs:
  identity, users, RBAC, organization, configuration, documents, workflow,
  notifications, audit, jobs, integrations/sync, reporting/excel/print
  horizontal capabilities, customization. Owned by the product; licensed as the
  base of every installation.
- **ERP Main Product.** The operational business modules sold on top of the
  platform core: Accounting, Inventory, Sales, (planned: Purchasing, Taxpayer
  connectivity, Payroll/HR, Treasury, CRM integration surface).
- **Independent modules.** Modules are self-contained vertical slices; each owns
  its data and logic. A module can be licensed and sold separately; not every
  module requires Accounting (§14).
- **Future products and extensions.** Future products (CRM/ticketing integration,
  vertical packages, marketplace extensions) ride on the same platform through
  contracts/events/adapters — see §27 and §29 (directional).
- **Module independence and integration rules.** Cross-module interaction only
  through domain events, public application services, or module-owned views;
  **cross-module direct table/Prisma access is forbidden** (AR-07, AR-08,
  ADR-0005/0008). External systems only via adapters + outbox (AR-14, AR-18).

---

## 14. Accounting Position

- **Accounting is a major operational module** — the financial system of record
  of Vardena — currently in active development (Tasks 10.1–10.8 delivered;
  ADR-0026/0028 accepted). (DECIDED)
- **Accounting is the financial integration point** for other modules: Inventory,
  Sales, Treasury, etc. publish domain events; Accounting subscribes and owns the
  business-event → journal mapping (AR-16, ADR-0005). (DECIDED)
- **Other modules may be sold or used independently of Accounting.** A customer
  can run Inventory+Sales without Accounting. (DECIDED)
- **Not every module requires Accounting** — modules integrate with the
  *platform* (documents, workflow, reports), not necessarily with Accounting.
  (DECIDED)
- **Accounting-related integrations must use explicit contracts** — event
  schemas and posting contracts (`accounting/domain-contract.md` §16/§20), never
  table reach-ins. System-generated posting currently has an explicit gate:
  no production system posting until durability semantics are decided (OQ-39)
  and posting modes are decided (OQ-42). (DECIDED as governance; the durable
  integration ADR is a roadmap item — see ADR-0031-dependent sequencing in the
  roadmap)

---

## 15. MVP Definition

### 15.1 Operational MVP modules — DECIDED

| Module | Role in MVP |
|---|---|
| **Accounting** | Fiscal years/periods, coding structure + chart of accounts (ADR-0026/0028 base shipped), manual vouchers (draft→temporary→final), atomic posting + ledger entries, accounting reports. Full scope in the MVP proposal. |
| **Inventory** | Items/units, warehouses, opening inventory, receipts/issues, stock ledger and availability (ADR-0017/0022). |
| **Sales** | Parties, sales documents (quote/order/invoice minimal set), tax snapshot fields, sales→posting path consistent with OQ-39/OQ-42 gates. |
| **Report Builder** | Permission-aware reporting over module views; depth decided by OQ-49. |

### 15.2 Required platform capabilities — DECIDED

Login · Authentication (ADR-0007) · RBAC (ADR-0006/0016) · Dashboard ·
Organization (ADR-0020/0021/0025) · Configuration · Documents (ADR-0019/0023) ·
Workflow foundation (ADR-0018/0024) · License foundation (minimal, non-punitive —
ADR-0030 proposed) · Integration foundation (outbox + adapter ports, ADR-0004) ·
Audit (AR-23) · Backup/Restore foundation (§23; OQ-52 targets).

### 15.3 Explicitly NOT in MVP (future modules) — DECIDED as exclusions

Purchasing (remains post-MVP per OQ-16), Payroll/HR (OQ-32), Treasury, full
full Taxpayer
System submission flows (§19/OQ-51), multi-device offline sync (OQ-44),
marketplace (§27), public API program (§28, ADR-0029/OQ-58), SaaS,
CRM/ticketing products (§29). Detailed exclusions in the MVP proposal.

---

## 16. MVP Reference Business Scenario

The single end-to-end scenario the MVP must support. (DECIDED as the MVP's
definition of success; used as the acceptance spine in the MVP proposal.)

```
Login
 → Define company
 → Define fiscal year
 → Configure system
 → Define accounting coding structure
 → Define accounts and details
 → Define products and units
 → Enter opening inventory
 → Register warehouse receipt
 → Register warehouse issue
 → Register sale
 → Generate accounting entry
 → Finalize accounting document
 → Inventory reports
 → Sales reports
 → Profit and loss report
 → Create a custom report
```

Constraints recorded by the repo that shape this scenario:

- "Generate accounting entry" runs through the established flow: voucher →
  Posting Readiness → Posting Contract → atomic posting → ledger entries →
  orchestration (`docs/accounting/task-index.md` §3). For system-generated
  entries (sale → posting), durability semantics (OQ-39) and posting mode
  (OQ-42) must be resolved; otherwise the MVP scenario uses **manual voucher
  entry for the sale's accounting entry**, which is already implementable.
- "Profit and loss report" requires accounting balances/reports (candidate §4 of
  task-index) and the chart/report-layout decisions (OQ-25/OQ-43) at least in a
  minimal approved form.
- "Create a custom report" depth = OQ-49.

---

## 17. Report Builder Vision

### 17.1 Report Builder vision — DIRECTIONAL (full vision), with MVP depth OPEN (OQ-49)

The full Report Builder vision spans:

| Category | Capabilities |
|---|---|
| Report families | Operational reports · Management reports · Analytical reports · Accounting reports · Tax reports · Legal reports · Printable reports |
| Output | Excel export (confirmed, ADR-0009 §6) · PDF export · printable documents (ADR-0012) |
| Dashboards | Live dashboards · KPI blocks · charts (dashboard = widgets composing report pipeline, reporting-strategy §5) |
| Automation | Scheduling and delivery (via Jobs module, ADR-0010) |
| Scale-out | Multi-entity reporting (across installations/organizations — future, depends on OQ-59) |
| Building | Visual Query Builder over approved semantic entities · calculations and expressions |

### 17.2 Security constraints — DECIDED (binding regardless of builder depth)

These constraints are architectural law for any Report Builder depth:

1. **No unrestricted raw SQL for end users.** End users never author SQL.
   (AR-11, ADR-0009.)
2. **Permission-aware data access.** Every report definition carries its
   permission; execution is backend-enforced (AR-21). Row/column visibility
   follows the same RBAC model.
3. **Approved semantic entities.** The builder composes only from
   module-owned, reviewable semantic entities (views/registered field
   catalogs) — never from raw tables   (ADR-0009 §1, AR-11).
4. **Query resource limits.** Row caps, timeouts, read-only DB role, async
   thresholds (reporting-strategy §7).
5. **Auditability.** Sensitive report exports are audited (AR-23 §4).
6. **Report versioning.** Builder-produced report definitions are versioned
   artifacts (stored definitions must carry version + author + change audit;
   mechanism detail follows the reporting-strategy "code-defined reports"
   decision adapted for builder-produced definitions — the versioning *policy*
   is DECIDED, the storage mechanism follows the OQ-49 outcome).

---

## 18. Iranian Compliance Strategy

### 18.1 Required compliance scope — DIRECTIONAL (program confirmed), OPEN (detail)

The compliance program covers, at minimum, the following domains (each listed
with its current decision state):

| Domain | Notes | State |
|---|---|---|
| Accounting standards | Iranian accounting standards as they affect report layouts and bookkeeping structure. | OPEN detail (OQ-43/OQ-25) |
| Tax | VAT and transaction taxes; tax treatment on documents (OQ-30). | OPEN detail (OQ-30) |
| Electronic invoicing | E-invoice generation data requirements feeding the Taxpayer System (§19). | OPEN detail |
| Taxpayer system (سامانه مودیان) | Submission, status, corrective documents (§19). | Program DECIDED; release boundary OQ-51 |
| VAT | VAT registration status on parties, VAT handling on documents. | OPEN detail (OQ-30/OQ-38) |
| Legal books | `دفتر روزنامه`, `دفتر کل`, journal/ledger statutory layouts (Art. 95 / Commercial Code context, OQ-43). | OPEN detail (OQ-43) |
| Payroll and social security | Payroll/HR itself is a future module (OQ-32); statutory interfaces (e.g. list interfaces) are future. | DIRECTIONAL / post-MVP |
| Tax returns | Corporate tax return data support — report-level capability. | DIRECTIONAL |
| Quarterly transactions | Article 169 quarterly transaction reports (OQ-43). | OPEN detail (OQ-43) |
| Industry-specific legal requirements | Configurable per-industry compliance packs (future; §6 industry strategy). | DIRECTIONAL |

### 18.2 Compliance governance — DECIDED (framework)

- **Compliance baseline:** a versioned compliance baseline document per
  statutory domain must exist before statutory features ship; the baseline is
  owned by the product owner with expert validation (accountant + tax expert).
- **Effective dates:** every compliance rule carries an effective date; the
  product must be able to express rules whose effective dates differ
  (config-driven, never hardcoded — the AG-09/AR-31 posture already in the
  repo: "no legal requirement is hardcoded", OQ-43).
- **Ownership:** Ali Esmaeili (final authority) with named accountant/tax
  expert validators per domain.
- **Review dates:** each baseline is reviewed on a stated cadence (proposed:
  quarterly for tax, annually otherwise; exact cadence is an operational
  policy choice recorded with each baseline).
- **Versioning:** baselines are versioned documents; changes create new
  versions with change logs; historical behavior of the product against an old
  baseline is preserved by configuration versioning (e.g. coding structure,
  posting rules), never by editing history.
- **Historical behavior:** already-posted documents never change meaning due to
  a compliance update (immutability, AR-13); updates affect new documents and
  explicitly-versioned configuration.
- **Change notifications:** compliance baseline changes are announced to
  affected customers as part of controlled updates (§24); the notification
  mechanism reuses the update/release notes process.
- **Customer accountant approval:** before a statutory feature ships to
  customers, the customer-facing accountant's acceptance is part of the
  compliance baseline sign-off process (per customer/pilot).
- **Product owner final decision authority:** all compliance trade-offs (what
  ships when, how much of a statutory requirement is automated vs supported
  manually) are decided by Ali Esmaeili on expert recommendation.

---

## 19. Taxpayer System Integration (سامانه مودیان)

### 19.1 Intended scope — DECIDED (intended scope), OPEN (release boundary)

The full intended scope of Taxpayer System integration:

| Capability | Class |
|---|---|
| Electronic invoice submission | DIRECTIONAL (in intended scope) |
| Online status retrieval | DIRECTIONAL |
| Retry of failed submissions | DIRECTIONAL (mechanism: outbox — ADR-0004) |
| Error explanation for users | DIRECTIONAL |
| User guidance (what to fix, whom to call) | DIRECTIONAL |
| Reconciliation between Vardena and the Taxpayer System | DIRECTIONAL |
| Corrective invoices | DIRECTIONAL |
| Cancellation | DIRECTIONAL |
| Returns | DIRECTIONAL |
| Corrective returns | DIRECTIONAL |
| Full tracking and reporting of submission state | DIRECTIONAL |

### 19.2 Internal domain vs external adapter — DECIDED (separation principle)

- **Internal tax-invoice domain logic** (the tax invoice as a Vardena document:
  structure, numbering, totals, tax fields per OQ-30, lifecycle, corrections —
  consistent with the correction model OQ-27) is owned by the Sales/Document
  domain, independent of any external system.
- **External adapter logic** (protocol, credentials, submission queue, status
  polling, error taxonomy, retries) is owned exclusively by the integration
  module behind the adapter port + outbox (AR-14/18, ADR-0003/0004), exactly as
  `docs/integrations.md` §4 plans (`destination = taxpayer`, OQ-05).
- The MVP ships **neither** the full submission loop nor the adapter; the   release boundary is **OQ-51**. The MVP must only ensure the document model
  does not preclude the adapter (e.g. snapshot tax fields, stable document ids,
  correction links).

---

## 20. Organization, Companies, Branches, and Multi-Company Model

| Topic | Statement | Class |
|---|---|---|
| Separate database per company/customer installation | Per §9 — one installation = one customer = one database. | DECIDED |
| Multiple databases for one customer | Possible through multiple licensed installations; not one installation hosting several companies. Cross-installation consolidation (holding reporting) is future. | DIRECTIONAL / OPEN (OQ-59) |
| Branches as physical organizational units | A branch (شعبه) is a physical organizational unit within the single legal entity of the installation (consistent with OQ-22's interim posture). | DIRECTIONAL (matches OQ-22 interim; final wording OQ-22) |
| Branch-specific inventory/warehouse/cashbox | Warehouses belong to one branch; inventory availability and movements are branch-scoped. | DIRECTIONAL (consistent with OQ-22/OQ-24 current design) |
| Branch-specific reporting | Branch as a reporting/scope dimension. | DIRECTIONAL |
| Branch-level access | Permissions may be scoped by branch. | DIRECTIONAL (requires permission-model extension; post-MVP unless proven MVP-critical) |
| Future branch capability | Deeper branch capabilities (branch-level approval routing, branch P&L) are post-MVP candidates. | DIRECTIONAL |
| Two-book accounting | Two-book accounting (parallel legal/commercial books — e.g. statutory vs management) is a **separately analyzed capability or extension**: not decided, not in MVP, requires its own analysis and likely an ADR + accountant input (related: OQ-22/OQ-31 financial-area model, OQ-43 legal books). | OPEN / separately analyzed |

---

## 21. Currency and Multi-Currency

### 21.1 Confirmed requirements — DECIDED

- **Configurable base currency** per organization (rial expected, but
  configurable — OQ-03 consistency).
- **Multiple currencies** definable per organization.
- **Currency per transaction/document** (each document carries its currency).
- **Foreign amount and base amount** recorded per line/document.
- **Historical exchange rate** snapshotted on the document at composition time
  (the accounting contract already reserves exactly this seam —
  `accounting/domain-contract.md` §13.6/§24.1, OQ-03 note).
- **Rial/base currency as accounting basis**: the accounting ledger balances in
  the organization's single base currency (contract §13.6: balancing invariant
  is defined in the base currency).

### 21.2 Requiring accounting analysis — OPEN (registered; accountant + owner)

| Topic | Registered as |
|---|---|
| Revaluation of foreign-currency balances | OQ-48 |
| Foreign exchange gain/loss recognition | OQ-48 |
| Currency account separation (foreign-currency sub-ledgers/accounts) | OQ-47 |
| Foreign currency inventory valuation | OQ-47 |
| Rate source and rate governance (who sets/imports rates, effective dating) | OQ-47 |

**MVP constraint:** MVP operates single-currency (base currency) end-to-end
except where the confirmed per-document currency fields (§21.1) already exist as
schema seams. No revaluation, no FX gain/loss, no multi-currency reporting in
MVP — those follow OQ-47/OQ-48 resolution. See MVP proposal category D.

---

## 22. Security and Commercial Protection

| Topic | Statement | Class |
|---|---|---|
| No source-code access for customers | Customers never receive source code or schema; Vardena is proprietary, delivered as a controlled deployment. | DECIDED |
| Encryption of sensitive data | Secrets and integration credentials encrypted at rest (AR-20); sensitive business data handling follows `docs/security.md` §8. | DECIDED (baseline) |
| Encrypted backups | Backups are encrypted at rest. (Mechanism/deployment policy: OQ-52/OQ-17 adjacency.) | DECIDED (requirement) / OPEN (mechanism) |
| Authentication and access control | Server-side sessions (ADR-0007), granular RBAC (ADR-0006/0016), backend enforcement (AR-21). | DECIDED (shipped foundations) |
| Login/logout audit | Authentication events (login success/fail, lockout, session revoke, logout) are audited (security.md §4). | DECIDED (shipped foundation) |
| Log retention | Audit/security log retention is a policy decision — currently OQ-17 (retention & archival). | OPEN (existing OQ-17) |
| Protected APIs | Every endpoint permission-declared (AR-21), validated at edge (AR-24), rate-limited, no internal leakage. | DECIDED (shipped foundations) |
| Security testing | Security test pass (authz denial paths, validation, session lifecycle) is part of MVP hardening (§30, roadmap Stage 6). | DECIDED (requirement) |
| Penetration testing | A penetration test before/with first customer deployment is required; scheduling and scope is an operational decision (roadmap Stage 6 exit gate). | DECIDED (requirement) / DIRECTIONAL (timing) |
| Controlled support access | Support access to customer installations is controlled: only via Vardena-controlled procedures, with customer knowledge, audited. | DECIDED (principle) |
| No uncontrolled customer impersonation | No feature may allow a support/operator to impersonate a customer user outside an explicit, audited, customer-approved procedure; impersonation, if ever built, requires its own decision + audit trail + consent. Not in MVP. | DECIDED (v1: absent) |

---

## 23. Backup, Restore, and Disaster Recovery

| Topic | Statement | Class |
|---|---|---|
| Automatic backups | Scheduled automatic logical backups (pg_dump) per deployment (database-strategy §14). | DECIDED (foundation exists as strategy) |
| Scheduled backups | Configurable schedule per deployment. | DECIDED |
| Configurable retention | Retention per deployment config (OQ-17). | DECIDED (mechanism) / OPEN (policy values, OQ-17) |
| Encrypted backups | Backup artifacts encrypted at rest. | DECIDED (requirement) |
| Customer-triggered backups | A customer-admin "backup now" action must exist in-product. | DECIDED (requirement, MVP) |
| Controlled restore | Restore is a controlled operation performed by/with Vardena; an in-product guided restore path for the customer-admin is a candidate (OQ-53). | DECIDED (controlled) / OPEN (self-service degree) |
| Backup before migrations | Every update applies a pre-migration backup automatically (§24). | DECIDED |
| Recovery planning | Documented recovery runbook per deployment. | DECIDED (requirement) |
| RPO/RTO targets | **OPEN — require formal operational targets.** No numeric RPO/RTO is committed anywhere in the repo (OQ-17 explicitly defers). Registered as **OQ-52** for formal targets. | OPEN QUESTION (OQ-52) |
| RPO zero | **RPO zero is NOT claimed as technically guaranteed.** The repo explicitly says "no RPO/RTO committed"; async WAL archiving (if deployed) still loses the tail window. Any "zero data loss" claim requires a formal architecture decision (synchronous replication etc.) that is not made. | Explicit non-claim (DECIDED as governance) |
| Disaster recovery / server replacement | DR beyond single-server recovery (site loss, hardware replacement runbook) is undecided — registered within OQ-53. | OPEN QUESTION (OQ-53) |

---

## 24. Versioning and Updates

- **Stable releases.** Vardena ships versioned, stable releases to customers;
  controlled by Vardena. (DECIDED)
- **LTS possibility.** Long-term-support versions for customers who cannot take
  frequent updates is a *possibility* requiring a release-engineering decision —
  not decided. (DIRECTIONAL)
- **Controlled updates by Vardena.** Updates are applied by Vardena/authorized
  operators, never customer self-upgrade; each update runs: pre-flight
  compatibility checks → automatic backup → `prisma migrate deploy` →
  migration verification → health checks. (DECIDED)
- **Compatibility checks.** An update verifies the current version, applied
  migrations, and configuration compatibility before starting. (DECIDED)
- **Backup before migration.** Mandatory automatic pre-migration backup.
  (DECIDED)
- **Migration verification.** Post-migration verification (schema + smoke) runs
  before the service is declared healthy. (DECIDED)
- **Health checks.** API/worker/DB health checks gate update success.
  (DECIDED)
- **Rollback strategy.** Rollback = restore pre-migration backup + previous app
  version. The detailed rollback runbook and its automation level are part of
  the backup/restore decision set (OQ-53) — the principle (restore from
  pre-migration backup) is decided; fine-grained automation is open.
  (DECIDED principle / OPEN detail)
- **Avoiding forced rapid upgrades.** Product policy: avoid forcing customers
  to take rapid successive upgrades; support subscription covers a reasonable
  update window; forced-obsolescence windows (if ever) are a commercial policy
  decision (owner). (DECIDED as direction)

---

## 25. UX and User Experience

- **Modern and visually acceptable UI.** Tailwind + shadcn/ui design system
  (ADR-0002 stack). (DECIDED)
- **Simple experience for non-specialist users.** Primary flows (the §16
  scenario) must be completable by a non-accountant office user with minimal
  training; guided defaults, clear Persian-context labels (OQ-02 for
  language/calendar finalization). (DECIDED as priority)
- **Advanced details for professional users.** Power surfaces (bulk operations,
  raw-number edit views, advanced filters) exist but do not complicate the
  simple paths. (DECIDED as priority)
- **Role-based forms and visibility.** Forms, fields and menu visibility adapt
  to the user's permissions; backend remains the enforcement point (AR-21).
  (DECIDED)
- **Optional guided help.** Contextual help/onboarding is optional content,
  post-MVP unless trivially cheap. (DIRECTIONAL)
- **Speed and usability as major product priorities.** Performance budgets are
  product acceptance criteria (report/query responsiveness targets set in the
  MVP proposal §30/roadmap Stage 6). (DECIDED as priority)

---

## 26. Customization and Extensibility Governance

Every customization/extensibility request is classified into exactly one of six
buckets. **Decision authority for the classification: Ali Esmaeili**
(recommended by architecture, decided by the owner).

| Bucket | Meaning | Governance |
|---|---|---|
| **Core feature** | Belongs in the platform/ERP main product for all customers. | Product decision (owner) + ADR if architectural; enters roadmap. |
| **Module** | A new sellable module (or major extension of one) with its own bounded context. | Product decision (owner) + ADR (new module = AR-29 gate); priced in §11 structure. |
| **Extension** | A bounded addition to an existing module via its contracts/extension points (reports, imports, documents, events). | Owner decision; no ADR unless it changes contracts (AR-29). |
| **Customer-specific customization** | Built for one customer, not part of the standard product; may or may not be promoted later. | Owner decision + commercial agreement (§11); must use extension points, never core forks. |
| **Fork** | A per-customer branch of the product. **Default policy: forbidden.** A fork permanently breaks update economics and maintainability; only the owner may approve one, in writing, knowing it ends controlled updates for that customer. | Owner decision only (rare, discouraged). |
| **Rejected request** | Does not fit product/architecture/commercial direction. | Owner decision; recorded with reason in the product decision log. |

---

## 27. Future Ecosystem and Marketplace

**Status: DIRECTIONAL / FUTURE — nothing here is decided for MVP.**

- **Third-party modules.** A future ecosystem where third parties can build
  modules/extensions is a possibility (extraction-ready boundaries make it
  technically plausible).
- **Signed extensions.** Any binary/code extension mechanism would require
  signing and a trust model.
- **API-based extensions.** The most plausible first ecosystem shape: external
  services consuming the licensed API (§28) rather than in-process code.
- **Marketplace possibility.** A marketplace/distribution channel is a possible
  future commercial product — entirely owner-decided.
- **Extension approval.** Any ecosystem requires an explicit approval process
  for extensions (technical review + security review + owner sign-off).
- **Database access policy.** Third-party access to the customer database is
  **not granted** under any current decision; any change would be a major
  security/architecture ADR.

**Unresolved security policies for the marketplace (extension sandboxing,
capability model, revocation, liability) are deliberately NOT finalized here**
— they would be premature. Registered as a deferred decision (OQ-57 status:
defer until ecosystem becomes real; see OQ index).

---

## 28. API and Integration Strategy

### 28.1 Decided direction

- **Licensed API access.** API access beyond the product's own UI is a
  licensed capability — enabled per installation via licensing (§11), not
  automatically open. (DIRECTIONAL with owner confirmation; enforcement shape
  in ADR-0029)
- **Enterprise integrations.** Enterprise integrations (ERP-to-ERP, payment,
  legacy) follow the adapter + outbox architecture (ADR-0003/0004).
  (DECIDED architecturally)
- **Permission scopes.** API access uses the existing granular RBAC
  permission model; no separate ambient "API role" beyond declared
  permissions. (RECOMMENDATION adopted in ADR-0029; owner to ratify)
- **Configurable rate limits.** Rate limits are per-deployment and per-client
  configuration (security.md §5 baseline). (DECIDED as mechanism)
- **Import/export.** Excel import (ADR-0011) and Excel export are the
  customer-facing bulk-data channels for MVP. (DECIDED)
- **External system integration.** Outbound via outbox/adapters only (AR-14).
  (DECIDED)
- **API activation through licensing.** The API capability is tied to the
  license modules/flags (ADR-0029 proposal). (DIRECTIONAL)

### 28.2 Requiring further decisions — OPEN

| Topic | State |
|---|---|
| API authentication mechanism for non-UI clients | OPEN → ADR-0029 (proposes API-key based machine identity, OAuth2 deferred) |
| OAuth2 / delegation | OPEN — deferred by ADR-0029 unless owner overrides |
| API keys (issuance, rotation, revocation UX) | OPEN → ADR-0029 (proposed model) |
| Webhooks (inbound/outbound, subscription model) | OPEN → OQ-50 |
| API versioning policy beyond /api/v1 | DECIDED minimally (`/api/v1` base, ADR-0014); deprecation policy OPEN (folded into OQ-58) |
| Public availability (public API program) | OPEN → OQ-58 (not in MVP either way) |

---

## 29. CRM and Ticketing Strategy

**Status: DIRECTIONAL — current direction, not MVP.**

- **Separate products or external tools initially.** CRM and ticketing for
  Vardena's own commercial operations (customers, leads, licenses, contracts,
  renewals, support, communications) start as separate products or external
  tools — not modules of the ERP product and not blockers of MVP. (DIRECTIONAL)
- **Integration with Vardena.** Over time, integration with Vardena (customer
 /license data sync, support-ticket context) is expected, via the same
  integration discipline (adapters/contracts) — in either direction depending
  on which system is source of truth. (DIRECTIONAL)
- **CRM scope.** Customers, leads, licenses, contracts, renewals, support
  history, communications. (DIRECTIONAL)
- **Ticketing as a commercial/support capability.** Ticketing serves Vardena's
  support operation commercially; it is not an ERP module for customers in the
  current direction. (DIRECTIONAL)
- **Timing and ownership** (when to build/buy, who owns the tooling) are
  commercial-operations decisions — registered as **OQ-61**.

---

## 30. Product Success Criteria

Measurable MVP success criteria (proposed — to be ratified with the MVP scope;
numbers are proposals, not yet owner-approved):

| # | Criterion | Measure (proposed) |
|---|---|---|
| 1 | Critical end-to-end scenario | The §16 reference scenario completes end-to-end on a clean installation by a test user matching the target persona, without developer assistance. |
| 2 | Accounting correctness | For the scenario dataset: Σ debits = Σ credits in base currency on every final document; ledger entries 1:1 with posted lines; trial balance invariants hold; corrections only via counter-documents (AR-13). |
| 3 | Inventory correctness | Stock-on-hand equals ledger replay at any point; availability respects policy (negative stock rejected by default per OQ-24 interim); receipt/issue arithmetic exact under defined unit conversions (OQ-29 rules where decided). |
| 4 | Reliable reports | The MVP report set (§15.1) returns correct totals against fixture datasets (view regression tests per AG-06); Excel export byte-identical semantics across runs. |
| 5 | Internal LAN operation | Full scenario runs with internet fully disabled; no blocking internet calls; outbox queues pending external work. |
| 6 | Installation simplicity | Fresh install to login on target hardware ≤ 30 minutes by a trained operator (proposed target), from a documented runbook, with no manual DB steps. |
| 7 | Backup and restore | A scheduled backup runs automatically; a customer-admin can trigger a backup; a controlled restore from backup succeeds in the staged drill. |
| 8 | Security and access boundaries | Permission denial paths tested for every MVP endpoint (AG-06/AG-13); session lifecycle per ADR-0007; audit records present for all sensitive MVP actions. |
| 9 | Non-specialist usability | Scenario tasks completed by a non-specialist test user with only the built-in help, measured in usability pass (proposed: no task > 10 min, no critical confusion points). |
| 10 | No unresolved P0/P1 defects | Zero open P0/P1 at MVP exit (definition in roadmap Stage 6). |

---

## 31. Strategic Trade-off Policy

- **Quality and architecture are important.** The ADR corpus and module
  boundaries are strategic assets; they are not traded for schedule by default.
  (DECIDED)
- **If schedule expands, non-essential standards may be deferred selectively.**
  Deferred items must be *non-essential* (e.g. polish, secondary standards
  conformance, optional help content) — never correctness, security, or data
  integrity. (DECIDED as policy)
- **Decisions are made case by case.** No blanket rule; each deferral is
  recorded with reason and revisit point. (DECIDED)
- **Scope reduction is preferred over damaging core architecture.** When under
  pressure, cut scope — do not fork the architecture or bypass boundaries.
  (DECIDED)
- **Product owner may reconsider strategy if delivery becomes excessively
  delayed.** Persistent schedule failure triggers an explicit strategy review
  by Ali Esmaeili (which may alter scope, sequencing, staffing, or approach) —
  recorded as a decision when it happens. (DECIDED as policy)

---

## 32. Explicit Non-Goals and Things Vardena Must Avoid

1. **Overly complex ERP.** Do not chase big-ERP breadth (consolidation,
   allocation engines, HR suites) at the expense of simplicity for the target
   customer.
2. **Inflexible workflows/configuration.** Avoid hardcoding practices that
   Iranian businesses vary on (numbering, approvals, coding structures).
3. **Overly generic architecture.** Do not build platform-first abstractions
   with no shipped business capability; ship the reference scenario.
4. **FaraPayam dependency.** Any core dependency on FaraPayam is prohibited
   (§8).
5. **No viable revenue model.** Do not add capabilities whose support cost
   cannot be recovered; respect the §11 structure.
6. **Lack of Iranian compliance.** Do not ship statutory-adjacent features
   without the compliance baseline (§18) — incorrect compliance is worse than
   absent compliance.
7. **Feature accumulation without real users.** No speculative modules without
   demand evidence from real/pilot customers.
8. **Endless development without reaching market.** MVP scope discipline
   (Phase 4) and roadmap staging (Phase 5) exist to force market contact;
   scope creep is a governed exception, not a habit (AG-03 culture at product
   level).

---

## 33. Decision Classification Table

Classifications: **D** = Decided · **DIR** = Directional · **A** = Assumed ·
**OQ** = Open question (registered) · **C** = Conflicting/needs clarification ·
**R** = Recommendation (not yet approved).

| ID | Topic | Decision (abridged) | Class | Confidence | Evidence/source | Follow-up required |
|---|---|---|---|---|---|---|
| PD-01 | Product nature | Independent proprietary modular ERP, owned by Ali Esmaeili | D | High | Owner clarification; `.vardena/project-context.md`; ADR-0001 | None |
| PD-02 | Core architecture | Modular monolith, vertical slices, no microservices without ADR | D | High | ADR-0001/0002; owner statement | None |
| PD-03 | Independence from FaraPayam | Zero core dependency; adapter-only integration | D | High | ADR-0003; integrations.md §1; owner statement | OQ-04 (contract) remains |
| PD-04 | Deployment model | Separate install per customer; LAN web app; single-user local supported; no mandatory internet | D | High | Owner clarification; architecture.md §10 | None |
| PD-05 | Offline capability | LAN-offline + single-user local for MVP; multi-device sync OPEN/HIGH | D (10.1/10.2) + OQ (10.3) | High | Owner clarification | OQ-44 |
| PD-06 | SaaS | Architectural possibility only; no v1 commitment | DIR | High | Owner clarification; ADR-0001 §12 | OQ-59 (deferred) |
| PD-07 | Commercial structure | Setup fee + base license + support + modules + custom dev | D (structure) | High | Owner clarification | Pricing is owner's commercial process (out of scope) |
| PD-08 | License enforcement | Mechanism undecided | OQ | High | Absence of any mechanism in repo + owner uncertainty | ADR-0030 (foundation, proposed); expiry → OQ-45 |
| PD-09 | License expiry behavior | Undecided, incl. during internet outage | OQ | High | Owner uncertainty | OQ-45 |
| PD-10 | Customer data ownership | Customer owns data; no deletion at contract end; export required | D | High | Owner clarification | OQ-46 (full export format) |
| PD-11 | Excel export | Confirmed for MVP | D | High | Owner confirmation; ADR-0009/0011 | None |
| PD-12 | Post-termination read-only mode | Possible policy, undecided | OQ | Medium | Owner statement ("possible") | OQ-45 |
| PD-13 | Platform/ERP module split | Platform core + ERP main product + independent sellable modules | D | High | Owner clarification; modules.md | None |
| PD-14 | Module independence | Cross-module integration only via contracts/events/adapters; no table coupling | D | High | AR-07/08; owner statement | None |
| PD-15 | Accounting position | Major module + financial integration point; other modules may run without it | D | High | Owner clarification; task-index §3 | None |
| PD-16 | MVP operational modules | Accounting, Inventory, Sales, Report Builder | D | High | Owner clarification | None |
| PD-17 | MVP platform capabilities | Login, authn, RBAC, dashboard, org, config, documents, workflow, license foundation, integration foundation, audit, backup/restore foundation | D | High | Owner clarification; shipped ADRs | License-foundation depth → ADR-0030 |
| PD-18 | MVP reference scenario | §16 scenario is the MVP acceptance spine | D | High | Owner clarification | Scenario-dependent OQs: OQ-39/42/50 |
| PD-19 | Report Builder | Vision confirmed (§17.1); MVP depth undecided; security constraints decided | D (constraints) + OQ (depth) | High | Owner clarification; reporting-strategy | OQ-49 |
| PD-20 | Iranian compliance program | Program confirmed; scope/dates/ownership framework decided; detail open | DIR + OQ detail | Medium | Owner clarification; OQ-43 | OQ-43 (existing); OQ-51 (taxpayer boundary) |
| PD-21 | Taxpayer integration | Intended scope listed; internal domain vs adapter separation decided; MVP boundary open | DIR + OQ | Medium | Owner clarification; OQ-05 | OQ-51 |
| PD-22 | Multi-company model | Per-installation single company; multi-DB per customer directional | D (v1) + DIR | Medium | Owner clarification; OQ-01/OQ-22 | OQ-59 (consolidation, deferred) |
| PD-23 | Branches | Physical organizational units; branch-scoped inventory/reporting; branch-level access directional | DIR | Medium | Owner clarification; OQ-22 | OQ-22 (existing) |
| PD-24 | Two-book accounting | Separately analyzed capability/extension — undecided | OQ | Medium | Owner clarification | OQ-56 (new, cross-refs OQ-22/31/43) |
| PD-25 | Multi-currency confirmed set | Base currency + multi-currency + per-document currency + historical rate + rial basis | D | High | Owner clarification; contract §13.6/§24.1 | None (schema seams already reserved) |
| PD-26 | Multi-currency accounting rules | Revaluation, FX gain/loss, currency accounts, FC inventory valuation, rate governance undecided | OQ | Medium | Owner clarification | OQ-47/OQ-48 |
| PD-27 | Security posture | No customer source access; encryption; audit; protected APIs; pen test required; controlled support; no uncontrolled impersonation | D | High | Owner clarification; security.md | None |
| PD-28 | Backup/DR | Auto+scheduled+encrypted backups; customer-triggered backup; controlled restore; backup before migrations; runbook | D (requirements) | High | Owner clarification | OQ-52 (RPO/RTO), OQ-53 (DR/self-service restore) |
| PD-29 | RPO zero claim | NOT claimed as guaranteed | D (non-claim) | High | Owner + repo (OQ-17) | None (explicit) |
| PD-30 | Versioning/updates | Controlled updates; compat checks; pre-migration backup; verification; health; rollback-by-restore; avoid forced rapid upgrades | D | High | Owner clarification | None blocking |
| PD-31 | LTS | Possible, undecided | DIR | Low | Owner statement ("possibility") | Fold into release policy later |
| PD-32 | UX priorities | Modern UI; simple for non-specialists; pro depth; role-based forms; speed priority; guided help optional | D (priorities) | High | Owner clarification | None |
| PD-33 | Customization governance | Six-bucket classification; owner decides; forks forbidden by default | D | High | Owner clarification | None |
| PD-34 | Marketplace/ecosystem | Directional future; DB access not granted; security policies deliberately unfinalized | DIR | Medium | Owner clarification | OQ-57 (deferred) |
| PD-35 | API strategy | Licensed API; scopes = RBAC permissions (R); rate limits configurable; Excel import/export for MVP | D + R | Medium | Owner clarification; ADR-0029 | ADR-0029 ratification; OQ-50/OQ-58 |
| PD-36 | API open items | Authn mechanism, OAuth2, keys, webhooks, versioning policy, public availability | OQ | High | Absence of decisions | ADR-0029 + OQ-50/OQ-58 |
| PD-37 | CRM/ticketing | Separate products/external tools initially; integrate later | DIR | Medium | Owner clarification | OQ-61 |
| PD-38 | Success criteria | §30 criteria as MVP acceptance spine (numbers proposed) | D (framework) + A (numbers) | Medium | Owner clarification | Ratify numbers with MVP approval |
| PD-39 | Trade-off policy | Quality/architecture protected; selective deferral; case-by-case; scope cut over architecture damage; owner strategy review on delay | D | High | Owner clarification | None |
| PD-40 | Non-goals | §32 list | D | High | Owner clarification | None |

---

## 34. Risks and Constraints

| # | Risk/Constraint | Impact | Mitigation |
|---|---|---|---|
| R-01 | **Offline sync scope ambiguity.** If multi-device sync is silently expected by early customers, MVP expectations collide with its exclusion. | High | OQ-44 records it as excluded; sales pipeline must not promise it. |
| R-02 | **License enforcement deadlock.** Building either too little (no monetization control) or too much (punitive DRM hurting trust) before ADR-0030/OQ-45 resolve. | High | ADR-0030 proposes a minimal non-punitive foundation; enforcement stays off until it is ratified and OQ-45 decides expiry behavior. |
| R-03 | **Accounting correctness under delivery pressure.** Ledger correctness is the product's reputation; pressure invites shortcuts (direct edits, soft corrections). | Critical | AR-13 immutability; correction-policy OQ-27; scope-cut-over-architecture trade-off policy (§31). |
| R-04 | **Compliance error liability.** Wrong statutory behavior (tax, legal books) shipped to real customers creates legal exposure. | Critical | §18 governance: baseline + expert validation + accountant acceptance before statutory features ship. |
| R-05 | **Multi-currency creep.** Document-currency seams tempt premature FX features before accounting rules exist (OQ-48). | Medium | MVP constraint §21.2: single-currency operations; seams remain dormant. |
| R-06 | **Report Builder over-reach.** A too-ambitious builder (arbitrary SQL, unrestricted entities) becomes a security/performance hole. | High | §17.2 constraints are binding; OQ-49 bounds MVP depth. |
| R-07 | **Single-node operations risk.** On-premise single-server deployments have hardware/backup failure modes; no committed RPO/RTO (OQ-52). | High | OQ-52/OQ-53 targets + drill; pre-migration backup policy (§24). |
| R-08 | **Taxpayer System dependency.** External system changes (contract/format) can invalidate adapter work; sandbox access uncertain. | Medium | OQ-51 release boundary; adapter isolation; document model must not preclude (§19.2). |
| R-09 | **Governance debt.** The OQ registry (43 entries) is large; unresolved blockers could stall the critical path (system posting, statutory reports). | High | Roadmap Stage 0 is explicitly "decision and governance closure"; each stage names its gating OQs. |
| R-10 | **Team/agent parallelism vs boundaries.** Multiple agents/PRs risk boundary violations (cross-module access). | Medium | AR-07 enforcement; self-review checklists; review discipline. |
| R-11 | **Expectation gap on "ERP" breadth.** Buyers may expect payroll/CRM/marketplace in v1; MVP is deliberately narrow. | Medium | §32 non-goals; §29 direction; clear sales scoping. |
| R-12 | **Sole-owner bottleneck.** All final decisions route through Ali Esmaeili; decisions can batch up. | Medium | Batched decision sessions per roadmap stage (Stage 0, then per-stage gates). |

---

## 35. Open Decisions Summary

Consolidated list of genuinely unresolved items from this baseline. Full
records: `docs/decisions/product/` (OQs) and `docs/adr/` (proposed ADRs).

| ID | Topic | Type | Blocks MVP? | Blocking stage |
|---|---|---|---|---|
| OQ-44 | Multi-device offline sync scope & timing | OQ | No (excluded) | Post-MVP (Stage 7+) |
| OQ-45 | License expiry behavior (incl. internet-outage behavior) + post-termination read-only mode | OQ | Foundation only | Stage 0/1 |
| OQ-46 | Customer data export format & completeness beyond Excel | OQ | No (Excel confirmed) | Stage 5/6 |
| OQ-47 | Exchange-rate & multi-currency accounting rules (rate governance, currency accounts, FC inventory valuation) | OQ (accounting) | No (single-currency MVP) | Stage 7+ |
| OQ-48 | Revaluation & foreign exchange gain/loss | OQ (accounting) | No (single-currency MVP) | Stage 7+ |
| OQ-49 | Report Builder MVP depth | OQ | Yes (scope level) | Stage 0 gate |
| OQ-50 | Webhook requirement & API surface open items (with ADR-0029) | OQ | No | Stage 7 |
| OQ-51 | Taxpayer System integration release boundary | OQ | No (excluded; document model only) | Stage 4 gate |
| OQ-52 | Backup RPO/RTO formal targets | OQ | Foundation only | Stage 6 gate |
| OQ-53 | Disaster recovery, server replacement, restore self-service | OQ | Foundation only | Stage 6 |
| OQ-54 | Finalized document deletion/editing policy | OQ | Yes (policy posture) | Stage 0/2 |
| OQ-55 | Branch as cost center | OQ | No | Stage 7 |
| OQ-56 | Two-book accounting architecture | OQ | No | Post-MVP |
| OQ-57 | Marketplace & third-party extension security | OQ (deferred) | No | Post-MVP |
| OQ-58 | Public release vs internal-only | OQ | No | Stage 0 (commercial decision) |
| OQ-59 | One ERP + product family vs multi-ERP consolidation strategy | OQ | No | Strategic, post-MVP |
| OQ-60 | MVP acceptance thresholds (numbers in §30) | OQ | Yes (ratification) | Stage 0 gate |
| OQ-61 | CRM/ticketing timing & ownership | OQ | No | Stage 8 |
| ADR-0029 | Machine/API access model (proposed) | ADR | Yes (integration foundation semantics) | Stage 0 ratify |
| ADR-0030 | License foundation (minimal, non-punitive) | ADR | Yes | Stage 0 ratify |

**Existing OQs that gate the MVP path** (not duplicated — referenced):
OQ-39 (durable system posting — gates sale→posting automation),
OQ-42 (posting mode), OQ-49 (report depth), OQ-25 (chart/report layouts),
OQ-43 (statutory constraints), OQ-03 (currency precision), OQ-24 (valuation),
OQ-12 (numbering), OQ-02 (localization), OQ-16 (purchasing post-MVP),
OQ-32 (payroll post-MVP).

---

## Document history

| Date | Version | Change |
|---|---|---|
| 2026-09-22 | 1.0 | Initial baseline from product/business clarification answers. Proposed — pending owner approval. |
