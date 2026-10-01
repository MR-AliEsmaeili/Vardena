import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PermissionGate } from '@/features/permissions/permission-gate';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { PageHeader } from '@/ui/patterns/page-header';

interface Surface {
  to: string;
  title: string;
  description: string;
  permission: string | readonly string[];
}

const surfaces: readonly Surface[] = [
  {
    to: '/app/accounting/context',
    title: t.nav.financialContext,
    description: t.masterData.financialContext.description,
    permission: [
      PERMISSIONS.accounting.financialAreaView,
      PERMISSIONS.accounting.fiscalYearView,
      PERMISSIONS.accounting.accountingPeriodView,
    ],
  },
  {
    to: '/app/accounting/documents',
    title: t.nav.documents,
    description: t.accounting.documentsDescription,
    permission: PERMISSIONS.accounting.documentView,
  },
  {
    to: '/app/accounting/financial-areas',
    title: t.masterData.financialAreas,
    description: t.masterData.financialAreasDescription,
    permission: PERMISSIONS.accounting.financialAreaView,
  },
  {
    to: '/app/accounting/fiscal-years',
    title: t.masterData.fiscalYears,
    description: t.masterData.fiscalYearsDescription,
    permission: PERMISSIONS.accounting.fiscalYearView,
  },
  {
    to: '/app/accounting/periods',
    title: t.masterData.periods,
    description: t.masterData.periodsDescription,
    permission: PERMISSIONS.accounting.accountingPeriodView,
  },
  {
    to: '/app/accounting/chart',
    title: t.nav.chartTree,
    description: t.accounting.chartTreeDescription,
    permission: PERMISSIONS.accounting.accountView,
  },
  {
    to: '/app/accounting/accounts',
    title: t.masterData.accounts,
    description: t.masterData.accountsDescription,
    permission: PERMISSIONS.accounting.accountView,
  },
  {
    to: '/app/accounting/account-statements',
    title: t.nav.accountStatements,
    description: t.accounting.accountStatementsDescription,
    permission: PERMISSIONS.accounting.accountStatementView,
  },
  {
    to: '/app/accounting/general-ledger',
    title: t.nav.generalLedger,
    description: t.accounting.generalLedgerDescription,
    permission: PERMISSIONS.accounting.generalLedgerView,
  },
  {
    to: '/app/accounting/trial-balance',
    title: t.nav.trialBalance,
    description: t.accounting.trialBalanceDescription,
    permission: PERMISSIONS.accounting.trialBalanceView,
  },
];

/** Accounting landing page: the read surfaces this session can open. */
export function AccountingHomePage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title={t.accounting.title}
        description={t.accounting.subtitle}
      />

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
    </div>
  );
}
