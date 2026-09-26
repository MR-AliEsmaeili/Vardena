import { Link } from 'react-router-dom';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/patterns/states';

/** Terminal 404 for any unmatched route. */
export function NotFoundPage() {
  return (
    <EmptyState
      title={t.app.notFoundTitle}
      description={t.app.notFoundBody}
      action={
        <Button asChild variant="outline" className="mt-2">
          <Link to="/app">{t.app.backToHome}</Link>
        </Button>
      }
    />
  );
}
