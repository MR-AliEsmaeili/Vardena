import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSession } from '@/features/auth/use-session';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/card';
import { PageHeader } from '@/ui/patterns/page-header';
import { navigationSections } from '../navigation';

/**
 * Authenticated landing page.
 *
 * Deliberately carries NO figures: the backend exposes no dashboard/KPI
 * surface, and inventing numbers in the UI is forbidden. It only routes the
 * user to the sections their session can actually open.
 */
export function HomePage() {
  const session = useSession();
  const permissions = usePermissions();

  const sections = navigationSections
    .filter((section) => section.id !== 'workspace')
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          item.permissions === undefined ||
          (permissions.loaded && permissions.hasAll(item.permissions)),
      ),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t.home.welcome}
        description={t.home.body}
        actions={
          <span className="text-xs text-slate-500">
            {t.auth.signedInAs}:{' '}
            <span className="font-medium text-slate-700" dir="ltr">
              {session.user?.username ?? ''}
            </span>
          </span>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {sections.flatMap((section) =>
          section.items.map((item) => (
            <Card key={item.to}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <item.icon className="h-4 w-4 text-indigo-600" aria-hidden />
                  {item.label}
                </CardTitle>
                <CardDescription>{section.label}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild variant="outline" size="sm">
                  <Link to={item.to}>
                    {t.home.openSection}
                    <ArrowLeft className="h-4 w-4" aria-hidden />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )),
        )}
      </div>
    </div>
  );
}
