import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { Alert, AlertBody, AlertTitle } from '@/ui/alert';
import { Button } from '@/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { PageHeader } from '@/ui/patterns/page-header';

interface Surface {
  to: string;
  title: string;
  description: string;
  permission: string;
}

const surfaces: readonly Surface[] = [
  {
    to: '/app/organization/profile',
    title: t.orgAdmin.profile,
    description: t.orgAdmin.profileDescription,
    permission: PERMISSIONS.organization.view,
  },
  {
    to: '/app/organization/branches',
    title: t.orgAdmin.branches,
    description: t.orgAdmin.branchesDescription,
    permission: PERMISSIONS.organization.branchView,
  },
  {
    to: '/app/organization/departments',
    title: t.orgAdmin.departments,
    description: t.orgAdmin.departmentsDescription,
    permission: PERMISSIONS.organization.departmentView,
  },
  {
    to: '/app/organization/employees',
    title: t.orgAdmin.employees,
    description: t.orgAdmin.employeesDescription,
    permission: PERMISSIONS.organization.employeeView,
  },
  {
    to: '/app/organization/parties',
    title: t.orgAdmin.parties,
    description: t.orgAdmin.partiesDescription,
    permission: PERMISSIONS.organization.partyView,
  },
];

/** Landing page of the organization area: the surfaces this session can open. */
export function OrganizationAdminHomePage() {
  return (
    <div className="space-y-5" data-testid="organization-admin-home">
      <PageHeader title={t.orgAdmin.title} description={t.orgAdmin.subtitle} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {surfaces.map((surface) => (
          <PermissionGate key={surface.to} permission={surface.permission}>
            <Card>
              <CardHeader>
                <CardTitle>{surface.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-slate-600">{surface.description}</p>
                <Button asChild variant="outline" size="sm">
                  <Link to={surface.to}>
                    {t.home.openSection}
                    <ArrowLeft className="h-4 w-4" aria-hidden />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </PermissionGate>
        ))}
      </div>

      <Alert variant="neutral" role="note">
        <AlertTitle>{t.orgAdmin.deferredTitle}</AlertTitle>
        <AlertBody>{t.orgAdmin.deferredBody}</AlertBody>
      </Alert>
    </div>
  );
}
