import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

/**
 * Password hashing service.
 *
 * Wraps argon2id (AR-25, ADR-0007, security.md §2):
 * - hash(): generate an argon2id hash from a plaintext password.
 * - verify(): verify a plaintext password against an existing hash.
 *
 * Rules for callers:
 * - Never log the plaintext password or the hash.
 * - Never return the hash through an API response.
 * - Only this module deals in password hashes; cross-module callers use
 *   `verifyCredentials()` on the Users public service instead.
 */
@Injectable()
export class PasswordService {
  /**
   * Argon2id parameters chosen for an on-premise server-class deployment.
   * These are conservative defaults and should be tuned per deployment
   * via a future config key if performance testing requires it.
   *
   * memoryCost is in KiB (argon2 convention). 19456 KiB ≈ 19 MiB.
   */
  private static readonly OPTIONS: argon2.HashOptions = {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  };

  async hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, PasswordService.OPTIONS);
  }

  async verify(hash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plaintext);
    } catch {
      // Malformed or unsupported hash: treat as verification failure
      // instead of leaking an error (AR-24).
      return false;
    }
  }

  /**
   * Returns true if the given hash looks like an argon2id hash
   * (used by tests to assert hashing algorithm).
   */
  isArgon2idHash(hash: string): boolean {
    // argon2 hashes start with $argon2<variant>$…  variant "id" for argon2id.
    return typeof hash === 'string' && hash.startsWith('$argon2id$');
  }
}
