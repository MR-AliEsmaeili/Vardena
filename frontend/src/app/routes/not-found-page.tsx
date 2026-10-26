import { Link } from 'react-router-dom';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/patterns/states';
import { useWorkspaceWindowTitle } from '../workspace/workspace-context';

/** Terminal 404 for any unmatched route. */
export function NotFoundPage() {
  // Inside a workspace window the derived fallback title would show the raw
  // last segment; the override keeps the tab readable (§6.6 rule 5).
  useWorkspaceWindowTitle(t.app.notFoundTitle);
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
