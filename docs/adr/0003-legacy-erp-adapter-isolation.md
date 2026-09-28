# ADR-0003: Legacy ERP Isolation via Adapter Layer

Status: Accepted
Date: 2026-09-10

## Context

A FaraPayam-style legacy ERP web service exists in the target environment. The
temptation (and a historical pattern in the region) is to build the new system
*on top of* the legacy service — using it as the backend. That would make
Vardena dependent on the legacy system's availability, data model, security, and
roadmap, and would defeat the purpose of a modern, independent ERP.

## Decision

Vardena is **fully independent**: own database, own business logic, own
authentication/authorization, own API. Legacy ERP (and all future external
systems: Iranian Taxpayer System, payment services, others) are **peer systems**
integrated exclusively through an **Integration/Adapter layer**:

- business modules never call external systems directly — outbound side effects
  become outbox rows (ADR-0004) dispatched by the worker to an adapter;
- every external system has one adapter implementing the kernel adapter port
  (protocol detail is private to the adapter — AR-18);
- the **frontend never communicates with external systems**; the Vardena API is
  the SPA's only backend (AR-19);
- external availability never blocks core ERP transactions.

Bootstrap (one-time historical import from the legacy ERP) is a data-migration
task run through the same validate → preview → confirm discipline, not a
runtime dependency.

## Consequences

- Legacy outages/contract changes are contained in one adapter + mappings.
- Two systems of record during migration: mapping config (Integration module)
  defines ownership per field; conflict policy per destination (see
  integrations.md §6); business rules about *which* fields are externally owned
  are OQ-04 until the contract is known.
- Slightly more moving parts than "wrap the legacy" (outbox, worker, adapters) —
  accepted as the price of independence.
