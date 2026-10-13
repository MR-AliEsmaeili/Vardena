-- Task 15 — Accounting reversal foundation (contract §12.2 / §15.4 AC-D-22).
--
-- Typed self-links on the voucher header:
--   reverses_document_id  — the original this document reverses (unique: at
--     most one reversal document per original).
--   reversed_by_document_id — the reversal of this document (unique: at most
--     one successful reversal of one original).
--   correction_kind / correction_reason — `reversal` + mandatory reason.
--
-- PostgreSQL UNIQUE treats NULLs as distinct, so ordinary vouchers do not
-- collide. FKs are ON DELETE RESTRICT: a reversal cannot orphan its original
-- and a Final original cannot be deleted anyway (AC-I-06).
--
-- No CHECK constraints (Prisma cannot represent them; a later generated
-- migration would DROP them). Kind/reason rules live in the domain layer.

ALTER TABLE "accounting"."accounting_documents"
    ADD COLUMN "correction_kind" TEXT,
    ADD COLUMN "correction_reason" VARCHAR(500),
    ADD COLUMN "reverses_document_id" TEXT,
    ADD COLUMN "reversed_by_document_id" TEXT;

CREATE UNIQUE INDEX "uq_accounting_documents_reverses_document_id"
    ON "accounting"."accounting_documents" ("reverses_document_id");

CREATE UNIQUE INDEX "uq_accounting_documents_reversed_by_document_id"
    ON "accounting"."accounting_documents" ("reversed_by_document_id");

ALTER TABLE "accounting"."accounting_documents"
    ADD CONSTRAINT "fk_accounting_documents_reverses"
        FOREIGN KEY ("reverses_document_id")
        REFERENCES "accounting"."accounting_documents" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "accounting"."accounting_documents"
    ADD CONSTRAINT "fk_accounting_documents_reversed_by"
        FOREIGN KEY ("reversed_by_document_id")
        REFERENCES "accounting"."accounting_documents" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
