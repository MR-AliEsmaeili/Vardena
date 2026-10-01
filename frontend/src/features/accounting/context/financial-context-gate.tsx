import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { ApiErrorAlert } from '@/ui/patterns/api-error-alert';
import { BlockedState, ResolvingState } from '@/app/layouts/bootstrap-states';
import { FinancialContextSelection } from './financial-context-selection';
import { useFinancialContext } from './use-financial-context';

/**
 * Financial context is the final Accounting bootstrap step. It does not run
 * until OrganizationContext is ready, and it never confers access: the API
 * validates the selected organization, area/year/period relationship, RBAC,
 * and licensing again for every request.
 */
export function FinancialContextGate({ children }: { children: ReactNode }) {
  const context = useFinancialContext();

  switch (context.status) {
    case 'ready':
    case 'unavailable':
      // A user with no Accounting context-read authority can still use the
      // organization-scoped surfaces they are independently authorized for.
      // This preserves the existing non-Accounting workspace behavior and is
      // not a bypass: no Financial Area/Year/Period endpoint is called and
      // every Accounting API remains guarded by its own server permission.
      return children;

    case 'idle':
    case 'loading':
      return <ResolvingState label={t.masterData.financialContext.title} />;

    case 'error':
      return (
        <ApiErrorAlert
          error={context.error}
          title={t.masterData.financialContext.loadFailed}
          onRetry={context.refresh}
        />
      );

    case 'empty-financial-area':
    case 'selecting-financial-area':
    case 'invalid-financial-area':
    case 'empty-fiscal-year':
    case 'selecting-fiscal-year':
    case 'invalid-fiscal-year':
    case 'empty-accounting-period':
    case 'selecting-accounting-period':
    case 'invalid-accounting-period':
      return <FinancialContextSelection />;
  }
}

/** A page-level explanation for a partial-permission session, where needed. */
export function FinancialContextUnavailable() {
  return (
    <BlockedState
      title={t.masterData.financialContext.unavailableTitle}
      description={t.masterData.financialContext.unavailableBody}
    />
  );
}
