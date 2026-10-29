import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect } from 'react';
import { o } from '@/lib/owner-i18n';
import { Button } from '@/ui/button';
export function Pagination({
  page,
  count,
  setPage,
  hasNext,
}: {
  page: number;
  count: number;
  setPage: (p: number) => void;
  /** Server-reported continuation. When absent, a full page implies a next page. */
  hasNext?: boolean;
}) {
  const canGoNext = hasNext ?? count >= 50;
  return (
    <nav
      aria-label={o.page}
      className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3.5 text-xs text-secondary"
    >
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          {o.previous}
        </Button>
        <span className="rounded-control border border-line bg-muted/60 px-2.5 py-1 font-medium text-ink">
          {o.page} {page}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={!canGoNext}
          onClick={() => setPage(page + 1)}
        >
          {o.next}
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
export function useDirtyGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const linkHandler = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.('a[href]');
      if (link && !window.confirm(o.confirmDirty)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('click', linkHandler, true);
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      document.removeEventListener('click', linkHandler, true);
    };
  }, [dirty]);
}
