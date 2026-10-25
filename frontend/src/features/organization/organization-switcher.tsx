import { Building2 } from 'lucide-react';
import { t } from '@/lib/i18n';
import { Select } from '@/ui/select';
import { useOrganization } from './use-organization';

/**
 * Organization indicator / switcher.
 *
 * Renders a `<select>` only when the API actually returned more than one
 * organization (the multi-organization case of the existing contract);
 * otherwise it shows the single effective organization as plain text instead
 * of inventing a tenant selector (ADR-0025).
 */
export function OrganizationSwitcher({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { organizations, organization, canSwitch, selectOrganization, status } =
    useOrganization();

  if (status === 'loading') {
    return (
      <span className="text-xs text-ink-subtle">{t.organization.loading}</span>
    );
  }

  if (organization === null) return null;

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Building2 className="h-3.5 w-3.5 shrink-0 text-ink-subtle" aria-hidden />
      {canSwitch ? (
        <Select
          className={compact ? 'h-8 min-w-0 max-w-44 text-xs' : 'h-9 w-56'}
          aria-label={t.organization.switcher}
          value={organization.id}
          onChange={(event) => selectOrganization(event.target.value)}
        >
          {organizations.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({item.code})
            </option>
          ))}
        </Select>
      ) : (
        /*
         * Compact mode = the application header. On a phone the name is
         * hidden (the icon plus its `title`/accessible name still say which
         * organization is active) because a 360px header has no room for the
         * wordmark, the scope name and the settings/profile controls at once.
         */
        <span
          className={
            compact
              ? 'hidden min-w-0 max-w-32 truncate text-xs font-medium text-ink-muted sm:inline'
              : 'text-sm font-medium text-ink-muted'
          }
          title={`${t.organization.label}: ${organization.name}`}
        >
          {organization.name}
        </span>
      )}
    </div>
  );
}
