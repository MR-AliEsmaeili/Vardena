import { apiGet } from './client';

/**
 * Owner dashboard summary (`GET /dashboard`, TS-8.2).
 *
 * These are counts of durable Owner state, read from the same database the
 * licensing services write. They are deliberately not derived, projected into a
 * trend or cached: a dashboard that disagreed with the list pages would be
 * worse than no dashboard, so every number here is what the list pages would
 * count. `generatedAt` is the database clock at the moment of counting, not the
 * browser's.
 */
export interface DashboardSummary {
  generatedAt: string;
  customers: { active: number; inactive: number };
  installationIdentities: { active: number; retired: number };
  issuances: { prepared: number; signed: number; abandoned: number };
  /** `prepared` split by the 14 × 24 h eligibility rule (OD-LIC-20). */
  preparedRequests: { eligible: number; expired: number };
  revocations: { requested: number; recorded: number };
  signingKeys: { active: number; needsReview: number };
  licenseArtifacts: { pending: number; quarantined: number };
}

export const getDashboardSummary = (signal?: AbortSignal) =>
  apiGet<DashboardSummary>('/dashboard', signal ? { signal } : {});
