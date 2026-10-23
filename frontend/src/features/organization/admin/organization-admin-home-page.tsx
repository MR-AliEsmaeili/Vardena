import {
  Building2,
  Contact,
  Handshake,
  Network,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { Alert, AlertBody, AlertTitle } from '@/ui/alert';
import { PageHeader } from '@/ui/patterns/page-header';
import {
  WorkspaceCardGrid,
  type WorkspaceCardGroup,
} from '@/ui/patterns/workspace-cards';

interface OrgSurface {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
  permission: string;
}

const SURFACES: readonly OrgSurface[] = [
  {
    to: '/app/organization/profile',
    label: t.orgAdmin.profile,
    description: t.orgAdmin.profileDescription,
    icon: Building2,
    permission: PERMISSIONS.organization.view,
  },
  {
    to: '/app/organization/branches',
    label: t.orgAdmin.branches,
    description: t.orgAdmin.branchesDescription,
    icon: Network,
    permission: PERMISSIONS.organization.branchView,
  },
  {
    to: '/app/organization/departments',
    label: t.orgAdmin.departments,
    description: t.orgAdmin.departmentsDescription,
    icon: Contact,
    permission: PERMISSIONS.organization.departmentView,
  },
  {
    to: '/app/organization/employees',
    label: t.orgAdmin.employees,
    description: t.orgAdmin.employeesDescription,
    icon: Users,
    permission: PERMISSIONS.organization.employeeView,
  },
  {
    to: '/app/organization/parties',
    label: t.orgAdmin.parties,
    description: t.orgAdmin.partiesDescription,
    icon: Handshake,
    permission: PERMISSIONS.organization.partyView,
  },
  {
    to: '/app/organization/members',
    label: t.orgAdmin.members,
    description: t.orgAdmin.membersDescription,
    icon: UserCheck,
    permission: PERMISSIONS.organization.membershipView,
  },
];

/** Landing page of the organization area: minimal cards gated by exact permissions. */
export function OrganizationAdminHomePage() {
  const permissions = usePermissions();

  const groups = useMemo<WorkspaceCardGroup[]>(() => {
    if (!permissions.loaded) return [];
    const permitted = SURFACES.filter((surface) =>
      permissions.has(surface.permission),
    );
    if (permitted.length === 0) return [];
    return [
      {
        id: 'organization',
        label: t.workspace.organizationGroup,
        items: permitted,
      },
    ];
  }, [permissions]);

  return (
    <div className="space-y-5" data-testid="organization-admin-home">
      <PageHeader title={t.orgAdmin.title} description={t.orgAdmin.subtitle} />

      <WorkspaceCardGrid groups={groups} />

      <Alert variant="neutral" role="note">
        <AlertTitle>{t.orgAdmin.deferredTitle}</AlertTitle>
        <AlertBody>{t.orgAdmin.deferredBody}</AlertBody>
      </Alert>
    </div>
  );
}
