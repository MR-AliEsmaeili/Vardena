import type { ReactNode } from 'react';

/**
 * Read-only key/value summary used by every detail page (master data, users,
 * organizations).
 *
 * The grid is rendered as a single bordered surface with hairline separators
 * instead of one card per field: a detail page stays scannable and the same
 * density is used everywhere. `Definition` keeps the semantic `dt`/`dd` pair,
 * so the label is announced with its value.
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
    <div className="min-w-0 bg-surface p-4">
      <dt className="text-[11px] font-medium text-ink-subtle">{label}</dt>
      <dd className="mt-1 text-sm font-medium break-words text-ink">
        {children}
      </dd>
    </div>
  );
}
