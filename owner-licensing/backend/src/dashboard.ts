import type { PoolClient } from "pg";
import { assertActiveAuthorizedActor } from "./domain.js";
import { PREPARED_REQUEST_MAX_AGE_MS } from "./licensing.js";

/**
 * Owner dashboard summary (requirement TS-8.2: "a dashboard built from real
 * data").
 *
 * This is a projection of durable Owner state, nothing more. Every number below
 * is counted from the tables the licensing services own; nothing is estimated,
 * cached, back-filled or derived from an assumption about what "should" be
 * there. Consequences of that rule:
 *
 * - there is no trend, no forecast and no synthetic percentage: the Owner
 *   database does not retain a metric history and this endpoint must not invent
 *   one;
 * - the export-backed item is counted only in terms of what is RECORDED
 *   (a signing key marked COMPROMISED/REVOKED), never as "affected licenses
 *   invalidated", because marking a key does not invalidate an already-issued
 *   license (OQ-74 decision);
 * - `preparedRequests.expired` is computed with the one real eligibility rule
 *   (`PREPARED_REQUEST_MAX_AGE_MS`, OD-LIC-20) instead of a second hard-coded
 *   copy of it. An expired row is still `REQUEST_PREPARED` in the table until
 *   the next completion attempt moves it to `ABANDONED`, so reporting it as
 *   expired is a fact about eligibility, not a claim that the row was already
 *   rewritten;
 * - `licenseArtifacts.pending` says exactly what the artifact-reconcile command
 *   needs to finish; it is not a data-loss indicator.
 *
 * Authorization is `licenses.view`, matching every read route this data comes
 * from; the route and the service both assert it (AR-21).
 */
export interface DashboardSummary {
  /** The database clock when the counts were taken. */
  generatedAt: string;
  customers: { active: number; inactive: number };
  installationIdentities: { active: number; retired: number };
  issuances: { prepared: number; signed: number; abandoned: number };
  /**
   * `prepared` is split by the real 14 × 24 h eligibility boundary: `eligible`
   * can still be completed, `expired` will fail closed on its next attempt and
   * be moved to `ABANDONED` (OD-LIC-20).
   */
  preparedRequests: { eligible: number; expired: number };
  revocations: { requested: number; recorded: number };
  /** `needsReview` = COMPROMISED or REVOKED (OQ-74 safety status). */
  signingKeys: { active: number; needsReview: number };
  /** Artifact-store states that require an operator action to settle. */
  licenseArtifacts: { pending: number; quarantined: number };
}

interface DashboardRow {
  generated_at: Date;
  customers_active: string;
  customers_inactive: string;
  identities_active: string;
  identities_retired: string;
  issuances_prepared: string;
  prepared_eligible: string;
  prepared_expired: string;
  issuances_signed: string;
  issuances_abandoned: string;
  revocations_requested: string;
  revocations_recorded: string;
  keys_active: string;
  keys_needs_review: string;
  artifacts_pending: string;
  artifacts_quarantined: string;
}

export async function getDashboardSummary(
  tx: PoolClient,
  actor: Parameters<typeof assertActiveAuthorizedActor>[0],
): Promise<DashboardSummary> {
  assertActiveAuthorizedActor(actor, "licenses.view");
  const row = (
    await tx.query<DashboardRow>(
      `SELECT clock_timestamp() AS generated_at,
        (SELECT count(*) FROM owner.customers WHERE status='ACTIVE') AS customers_active,
        (SELECT count(*) FROM owner.customers WHERE status='INACTIVE') AS customers_inactive,
        (SELECT count(*) FROM owner.installation_identities WHERE status='ACTIVE') AS identities_active,
        (SELECT count(*) FROM owner.installation_identities WHERE status='RETIRED') AS identities_retired,
        (SELECT count(*) FROM owner.license_issuances WHERE status='REQUEST_PREPARED') AS issuances_prepared,
        (SELECT count(*) FROM owner.license_issuances
          WHERE status='REQUEST_PREPARED'
            AND clock_timestamp() < requested_at + ($1::bigint * interval '1 millisecond')) AS prepared_eligible,
        (SELECT count(*) FROM owner.license_issuances
          WHERE status='REQUEST_PREPARED'
            AND clock_timestamp() >= requested_at + ($1::bigint * interval '1 millisecond')) AS prepared_expired,
        (SELECT count(*) FROM owner.license_issuances WHERE status='SIGNED_RECORDED') AS issuances_signed,
        (SELECT count(*) FROM owner.license_issuances WHERE status='ABANDONED') AS issuances_abandoned,
        (SELECT count(*) FROM owner.license_revocations WHERE status='REQUEST_PREPARED') AS revocations_requested,
        (SELECT count(*) FROM owner.license_revocations WHERE status='SIGNED_RECORDED') AS revocations_recorded,
        (SELECT count(*) FROM owner.signing_keys WHERE status='ACTIVE') AS keys_active,
        (SELECT count(*) FROM owner.signing_keys WHERE status<>'ACTIVE') AS keys_needs_review,
        (SELECT count(*) FROM owner.license_artifacts WHERE status='PENDING') AS artifacts_pending,
        (SELECT count(*) FROM owner.license_artifacts WHERE status='QUARANTINED') AS artifacts_quarantined`,
      [PREPARED_REQUEST_MAX_AGE_MS],
    )
  ).rows[0]!;

  const n = (value: string) => Number(value);
  return {
    generatedAt: row.generated_at.toISOString(),
    customers: {
      active: n(row.customers_active),
      inactive: n(row.customers_inactive),
    },
    installationIdentities: {
      active: n(row.identities_active),
      retired: n(row.identities_retired),
    },
    issuances: {
      prepared: n(row.issuances_prepared),
      signed: n(row.issuances_signed),
      abandoned: n(row.issuances_abandoned),
    },
    preparedRequests: {
      eligible: n(row.prepared_eligible),
      expired: n(row.prepared_expired),
    },
    revocations: {
      requested: n(row.revocations_requested),
      recorded: n(row.revocations_recorded),
    },
    signingKeys: {
      active: n(row.keys_active),
      needsReview: n(row.keys_needs_review),
    },
    licenseArtifacts: {
      pending: n(row.artifacts_pending),
      quarantined: n(row.artifacts_quarantined),
    },
  };
}
