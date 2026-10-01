import { t } from '@/lib/i18n';
import { PageHeader } from '@/ui/patterns/page-header';
import { FinancialContextSelection } from './financial-context-selection';
import { FinancialContextUnavailable } from './financial-context-gate';
import { useFinancialContext } from './use-financial-context';

/** Explicit route for changing an already-valid financial workspace context. */
export function FinancialContextPage() {
  const context = useFinancialContext();

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.masterData.financialContext.title}
        description={t.masterData.financialContext.description}
      />
      {context.status === 'unavailable' ? (
        <FinancialContextUnavailable />
      ) : (
        <FinancialContextSelection full />
      )}
    </div>
  );
}
