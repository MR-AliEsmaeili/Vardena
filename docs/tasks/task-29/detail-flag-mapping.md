# Detail Requirement / Detail Hierarchy Decision (OD-29-03)

## 1. Historical Source Finding

The VARDENA source artifact contains four boolean flag columns: `ACLTafsil1`, `ACLTafsil2`, `ACLTafsil3`, and `ACLTafsil4`. In the canonical 264-row source artifact, every value is `0`.

Task 29 originally established only that these are source-level numbered Detail-requirement flags. The artifact does not assign fixed business identities such as Party, Cost Center, Project, Bank, Customer, or Vendor to those flags. Earlier mapping text was therefore a proposal pending a domain decision.

---

## 2. Owner Decision Closure

**OD-29-03 Status:** **`DECIDED`** (2026-09-28)

Vardena must support a first-class Detail hierarchy independent from the Account hierarchy. Its coding structure is configurable by Organization and supports:

- configurable Detail-level count;
- configurable digit length per level;
- configurable name per level;
- hierarchical parent/child relationships; and
- code validation and uniqueness consistent with the configured structure.

The example `01 = اشخاص` with child codes such as `01001 = علی` is illustrative only. It is not product seed content and must not be hard-coded.

---

## 3. Account-to-Detail Relationship

An Account relates to a Detail at the **first Detail level**. It does not require one relationship row for every descendant Detail.

```text
Account
└── first-level Detail group
    ├── child Detail
    ├── child Detail
    └── child Detail
```

When an Account is related to a first-level Detail group, valid descendants under that group are available for that Account subject to applicable Detail rules. A future separately approved requirement would be needed before introducing per-leaf Account relationships.

---

## 4. Posting Requirement

An Account may require one or more Detail/Dimension values when used in an accounting document. Required values must ultimately be enforced by Accounting Domain/backend Posting validation. UI validation may assist but must not be the only enforcement boundary; direct API/backend calls must not bypass the rule.

No generic Detail slot is assigned a hard-coded semantic name by OD-29-03.

---

## 5. Controlled Relationship Removal

The system must eventually support explicit removal of an Account-to-Detail relationship. When historical documents contain affected Detail allocations, this is a controlled destructive data operation rather than a simple configuration deletion.

The user must receive an explicit confirmation warning with this source meaning:

> این تغییر باعث حذف ارتباط بین تفصیلی و کد حساب می‌شود و تمامی گردش‌های تفصیلی در سندهایی که کدحساب مدنظر گردش داشته باشد حذف خواهد شد . قبل از انجام این کار از دیتا بیس بکاپ بگیرید

Cancellation changes nothing. Confirmation requires the future approved operation to:

1. remove the Account-to-Detail relationship;
2. remove affected historical Detail allocations according to the approved domain operation;
3. handle all affected references consistently;
4. preserve Account-level accounting turnover;
5. execute atomically with no partial destructive result; and
6. record an audit trail including actor, timestamp, Account, Detail relationship, and operation.

---

## 6. Fit-Gap and Implementation Boundary

| Area                      | Decided Domain Requirement                                                              | Current State   | Classification                          |
| ------------------------- | --------------------------------------------------------------------------------------- | --------------- | --------------------------------------- |
| Detail hierarchy          | First-class, Account-independent, organization-configurable hierarchy                   | Not implemented | **MODEL GAP / IMPLEMENTATION REQUIRED** |
| Account relationship      | Relationship to first Detail level, not every leaf                                      | Not implemented | **MODEL GAP / IMPLEMENTATION REQUIRED** |
| Posting requirement       | Backend-enforced required Detail/Dimension values                                       | Not implemented | **MODEL GAP / IMPLEMENTATION REQUIRED** |
| Relationship removal      | Explicitly confirmed, atomic, audited destructive operation preserving Account turnover | Not implemented | **DESIGN + IMPLEMENTATION REQUIRED**    |
| Physical allocation model | Not decided by OD-29-03                                                                 | Not implemented | **OPEN IMPLEMENTATION DESIGN**          |

OD-29-03 decides the generic domain architecture and safeguards. It does **not** choose a physical database schema, allocation storage model, endpoint, permission, UI flow, transaction implementation, or deletion algorithm. It also does not authorize Task 30 or a Detail implementation task. ADR-0037 and any future architecture record must be reconciled during a separately authorized design/implementation gate.
