import { useEffect } from 'react';
import { o } from '@/lib/owner-i18n';
import { Button } from '@/ui/button';
export function Pagination({
  page,
  count,
  setPage,
}: {
  page: number;
  count: number;
  setPage: (p: number) => void;
}) {
  return (
    <nav aria-label={o.page} className="flex items-center gap-3">
      <Button
        variant="outline"
        disabled={page <= 1}
        onClick={() => setPage(page - 1)}
      >
        {o.previous}
      </Button>
      <span>
        {o.page} {page}
      </span>
      <Button
        variant="outline"
        disabled={count < 50}
        onClick={() => setPage(page + 1)}
      >
        {o.next}
      </Button>
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
