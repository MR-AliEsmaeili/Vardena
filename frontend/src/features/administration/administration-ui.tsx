import type { ReactNode } from 'react';

/**
 * Presentational atoms shared by the administration surfaces (users, roles).
 *
 * Duplicated from (not imported out of) the organization/inventory features
 * on purpose: `standards.md` §2 forbids feature → feature imports. Only
 * `@/ui`, `@/lib` and `@/api` cross the boundary.
 */

export function DefinitionList({ children }: { children: ReactNode }) {
  return (
    <dl className="grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-2">
      {children}
    </dl>
  );
}

export function Definition({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-surface p-4">
      <dt className="text-xs text-ink-subtle">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-ink">{children}</dd>
    </div>
  );
}
