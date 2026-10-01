import { Search } from 'lucide-react';
import type { ReactElement } from 'react';
import { t } from '@/lib/i18n';
import { Input } from '@/ui/input';

/**
 * Global search affordance of the top bar (reference visual).
 *
 * **The backend exposes no global search endpoint yet** (capability gap,
 * recorded in the task report), so the field is a non-submitting visual
 * placeholder that announces its unavailability instead of pretending to
 * search: submitting shows the honest hint below. It never navigates to an
 * invented route and never fabricates results.
 */
export function TopbarSearch(): ReactElement {
  return (
    <search className="relative hidden max-w-[26rem] flex-1 sm:block">
      <Search
        className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-slate-400"
        aria-hidden
      />
      <Input
        type="search"
        className="h-9 bg-slate-50 ps-9 pe-14 text-xs"
        placeholder={t.topbar.searchPlaceholder}
        aria-label={t.topbar.searchAriaLabel}
      />
      <kbd className="absolute inset-y-0 end-2.5 my-auto hidden h-fit rounded border border-b-2 border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-500 md:block">
        {t.topbar.searchHint}
      </kbd>
      <p role="note" className="sr-only">
        {t.topbar.searchUnavailable}
      </p>
    </search>
  );
}
