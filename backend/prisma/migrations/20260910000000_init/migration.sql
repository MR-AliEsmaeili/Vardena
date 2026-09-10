-- Vardena initial migration.
--
-- Creates the `core` schema owned by the kernel (ADR-0008, docs/database-strategy.md).
-- No tables yet: tables arrive with their owning modules, each with its own
-- migration (AR-10). Never edit this file after it has applied anywhere —
-- always add a new migration.

CREATE SCHEMA IF NOT EXISTS "core";
