/**
 * Installation identity (L-02).
 *
 * The stable identity of ONE deployed Vardena instance. It is deliberately a
 * plain server-generated ULID persisted in `licensing.installations`:
 *
 * - it is generated exactly once, at the first bootstrap/first use, and then
 *   loaded on every later start, so a backend/Docker/frontend restart never
 *   produces a new installation;
 * - it is owned by the backend: no client, cookie, browser storage or request
 *   header can choose or influence it;
 * - it is NOT a hardware fingerprint. MAC addresses, CPU/disk serials, IP
 *   addresses and browser fingerprints are deliberately not consulted — they
 *   identify machines unreliably and break on ordinary infrastructure changes
 *   (ADR-0030 keeps hardware binding out of scope).
 *
 * Its persistence boundary is the application database, which is the one
 * store a Vardena deployment already must keep across restarts (the Compose
 * stack keeps it in the `pgdata` volume). Identity therefore survives
 * container replacement exactly as the business data does, and a restored
 * backup restores the same installation and its license together.
 *
 * Identity exists independently of licensing: an unlicensed installation
 * still has one, and that is precisely the value an operator must quote to
 * obtain a license bound to this installation.
 */
export interface InstallationIdentity {
  installationId: string;
  name: string;
  /** Set once a license names the commercial customer; null before that. */
  customerId: string | null;
  createdAt: Date;
}

/** Default display name of a self-provisioned installation. */
export const SELF_PROVISIONED_INSTALLATION_NAME = 'Vardena installation';
