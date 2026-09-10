import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Session token generation and hashing (ADR-0007).
 *
 * - `generateToken()` produces a cryptographically-secure 256-bit random
 *   token, encoded as base64url for cookie transport.
 * - `hashToken()` returns the SHA-256 hex digest of the raw token — what we
 *   persist in `identity.sessions`. The raw token is NEVER stored.
 *
 * This keeps the server-side table worthless to an attacker who steals a DB
 * dump: hashed tokens cannot be used to forge cookies.
 */
@Injectable()
export class SessionTokenService {
  /** Token length in bytes (256 bits = 32 bytes). */
  private static readonly TOKEN_BYTES = 32;

  generateToken(): string {
    return randomBytes(SessionTokenService.TOKEN_BYTES).toString('base64url');
  }

  hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken, 'utf8').digest('hex');
  }
}
