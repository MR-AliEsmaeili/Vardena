import { useMemo } from 'react';
import { useSession } from '@/features/auth/use-session';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { PageHeader } from '@/ui/patterns/page-header';
import {
  WorkspaceCardGrid,
  type WorkspaceCardGroup,
} from '@/ui/patterns/workspace-cards';
import { isNavigationItemVisible, navigationSections } from '../navigation';

/**
 * Authenticated domain directory (`میزکار`).
 *
 * Groups permitted navigation destinations by domain with minimal cards
 * (icon on top, title below) and zero duplicate hub links.
 */
export function HomePage() {
  const session = useSession();
  const permissions = usePermissions();

  const groups = useMemo<WorkspaceCardGroup[]>(() => {
    return navigationSections
      .filter((section) => section.id !== 'workspace')
      .map((section) => ({
        id: section.id,
        label: section.label,
        items: section.items
          .filter((item) => isNavigationItemVisible(item, permissions))
          .map((item) => ({
            to: item.to,
            label: item.label,
            icon: item.icon,
          })),
      }))
      .filter((group) => group.items.length > 0);
  }, [permissions]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t.home.welcome}
        description={t.home.body}
        actions={
          <span className="text-xs text-ink-subtle">
            {t.auth.signedInAs}:{' '}
            <span className="font-medium text-ink-muted" dir="ltr">
              {session.user?.username ?? ''}
            </span>
          </span>
        }
      />

      <WorkspaceCardGrid groups={groups} />
    </div>
  );
}
