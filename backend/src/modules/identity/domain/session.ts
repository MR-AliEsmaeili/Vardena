/**
 * Server-side session domain entity (docs/security.md §2, ADR-0007).
 *
 * Sessions live in `identity.sessions`. Only the SHA-256 hash of the opaque
 * token is stored; the raw token is sent to the browser exactly once (at
 * creation) in an httpOnly cookie.
 */

export interface Session {
  /** ULID primary key (distinct from the secret token). */
  id: string;
  /** Owning user id. */
  userId: string;
  /** SHA-256 hash (hex) of the raw 256-bit session token. */
  tokenHash: string;
  /** Client user-agent at creation (for audit/session listing). */
  userAgent: string | null;
  /** Client IP at creation (for audit/session listing). */
  ipAddress: string | null;
  createdAt: Date;
  /** Updated on each authenticated request (sliding expiry). */
  lastSeenAt: Date;
  /** Sliding-expiry deadline (lastSeenAt + idle timeout). */
  expiresAt: Date;
  /** Absolute-expiry deadline (createdAt + absolute timeout). */
  absoluteExpiresAt: Date;
  /** When the session was explicitly revoked (logout/admin/user disable). */
  revokedAt: Date | null;
}

export function isSessionValid(
  session: Session,
  now: Date = new Date(),
): boolean {
  if (session.revokedAt !== null) return false;
  const t = now.getTime();
  if (t >= session.expiresAt.getTime()) return false;
  if (t >= session.absoluteExpiresAt.getTime()) return false;
  return true;
}
