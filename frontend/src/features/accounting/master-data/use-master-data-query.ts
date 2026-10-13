import { useSearchParams } from 'react-router-dom';

const DEFAULT_PAGE_SIZE = 50;

/** URL-owned state for server-backed accounting master-data lists. */
export function useMasterDataQuery() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const pageSizeValue = Number(params.get('pageSize')) || DEFAULT_PAGE_SIZE;
  const pageSize = [25, 50, 100, 200].includes(pageSizeValue)
    ? pageSizeValue
    : DEFAULT_PAGE_SIZE;
  const search = params.get('search') ?? '';
  const status = params.get('status') ?? '';
  const scopeId = params.get('scopeId') ?? '';

  const update = (values: Record<string, string | number | null>) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(values)) {
        if (value === null || value === '' || value === 1) next.delete(key);
        else next.set(key, String(value));
      }
      return next;
    });
  };

  return { page, pageSize, search, status, scopeId, update };
}
