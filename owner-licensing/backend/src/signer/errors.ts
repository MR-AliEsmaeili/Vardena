/**
 * Signer refusal vocabulary, kept separate from the signer orchestration and
 * from key-permission inspection so both can raise the same stable error type.
 * The CLI maps `code` and `exitCode`; callers must not depend on message text.
 */
export type SignerErrorCode =
  | "request-malformed"
  | "digest-missing"
  | "digest-malformed"
  | "digest-mismatch"
  | "key-id-mismatch"
  | "date-invalid"
  | "already-signed"
  | "state-unavailable"
  | "key-unavailable"
  | "unsafe-environment";

export class SignerError extends Error {
  constructor(
    readonly code: SignerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SignerError";
  }

  get exitCode(): number {
    if (this.code === "already-signed") return 4;
    if (this.code === "key-unavailable" || this.code === "state-unavailable")
      return 3;
    if (this.code === "unsafe-environment") return 5;
    return 2;
  }
}
