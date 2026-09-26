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
export function OrganizationSwitcher() {
  const { organizations, organization, canSwitch, selectOrganization, status } =
    useOrganization();

  if (status === 'loading') {
    return (
      <span className="text-xs text-slate-500">{t.organization.loading}</span>
    );
  }

  if (organization === null) return null;

  return (
    <div className="flex items-center gap-2">
      <Building2 className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      {canSwitch ? (
        <Select
          className="h-9 w-56"
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
        <span
          className="text-sm font-medium text-slate-700"
          title={`${t.organization.label}: ${organization.name}`}
        >
          {organization.name}
        </span>
      )}
    </div>
  );
}
