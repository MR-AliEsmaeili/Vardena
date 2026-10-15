import { createHash, randomBytes } from "node:crypto";

export const roles = [
  "SYSTEM_ADMIN",
  "LICENSE_ISSUANCE",
  "READ_ONLY_OBSERVER",
  "SUPPORT_SPECIALIST",
] as const;
export type Role = (typeof roles)[number];
export type Permission =
  "customers.view" | "customers.write" | "users.manage" | "audit.view";
// PDR-17: absent proposal is not a grant. Specialist/support business scope is restricted.
export function permissions(role: string): Permission[] {
  if (role === "SYSTEM_ADMIN")
    return ["customers.view", "customers.write", "users.manage", "audit.view"];
  if (role === "READ_ONLY_OBSERVER") return ["customers.view", "audit.view"];
  return [];
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function fail(status: number, code: string, message: string): never {
  throw new ApiError(status, code, message);
}
export function invalid(message: string): never {
  return fail(400, "ValidationFailed", message);
}
export function object(
  value: unknown,
  allowed: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("Invalid request.");
  const o = value as Record<string, unknown>;
  if (Object.keys(o).some((k) => !allowed.includes(k)))
    invalid("Unknown field.");
  return o;
}
export function text(
  value: unknown,
  field: string,
  min: number,
  max: number,
  trim = true,
): string {
  if (typeof value !== "string") invalid(`${field} is required.`);
  const s = trim ? value.trim() : value;
  if (s.length < min || s.length > max || (min > 0 && !s.trim()))
    invalid(`${field} must contain ${min}..${max} characters.`);
  return s;
}
export function password(value: unknown): string {
  return text(value, "password", 8, 128, false);
}
export function role(value: unknown): Role {
  if (!roles.includes(value as Role)) invalid("Invalid role.");
  return value as Role;
}
// PDR-14 grammar, case-sensitive, no implicit uppercasing or identity inference.
export function customerCode(value: unknown, id?: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/.test(value) ||
    value.trim() !== value ||
    value === id
  )
    invalid("Invalid customerCode.");
  return value;
}
export function status(value: unknown): string {
  if (value !== "ACTIVE" && value !== "INACTIVE") invalid("Invalid status.");
  return value;
}
export function page(value: unknown): number {
  if (value === undefined) return 1;
  if (typeof value !== "string" || !/^[1-9][0-9]{0,5}$/.test(value))
    invalid("Invalid page.");
  return Number(value);
}
export function id(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(value))
    invalid("Invalid record id.");
  return value;
}
export function token(): string {
  return randomBytes(32).toString("base64url");
}
export function digest(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
export interface User {
  id: string;
  username: string;
  password_hash: string;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  created_at: Date;
}
export function safeUser(u: User) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    isActive: u.is_active,
    mustChangePassword: u.must_change_password,
    createdAt: u.created_at.toISOString(),
  };
}
