import { ArrowRight } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';

function fallbackPath(pathname: string): string {
  if (pathname.endsWith('/new')) return pathname.slice(0, -4) || '/app';
  if (pathname.endsWith('/edit')) {
    const withoutEdit = pathname.slice(0, -5);
    const lastSlash = withoutEdit.lastIndexOf('/');
    return lastSlash > 0 ? withoutEdit.slice(0, lastSlash) : '/app';
  }
  return '/app';
}

/** A consistent return-to-previous-step control for every create/edit form. */
export function PageBackButton() {
  const location = useLocation();
  const navigate = useNavigate();
  const isForm = /\/(new|edit)$/.test(location.pathname);

  if (!isForm) return null;

  return (
    <div className="-mb-2 flex justify-start">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          const state: unknown = window.history.state;
          const index =
            typeof state === 'object' && state !== null && 'idx' in state
              ? state.idx
              : undefined;
          if (typeof index === 'number' && index > 0) navigate(-1);
          else navigate(fallbackPath(location.pathname), { replace: true });
        }}
      >
        <ArrowRight className="h-4 w-4" aria-hidden />
        {t.app.backToPrevious}
      </Button>
    </div>
  );
}
