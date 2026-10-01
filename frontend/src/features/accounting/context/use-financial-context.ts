import { useContext } from 'react';
import {
  FinancialContext,
  type FinancialContextValue,
} from './financial-context';

/** Read the in-memory accounting workspace choice below OrganizationContext. */
export function useFinancialContext(): FinancialContextValue {
  const context = useContext(FinancialContext);
  if (context === null) {
    throw new Error(
      'useFinancialContext must be used inside FinancialContextProvider.',
    );
  }
  return context;
}
