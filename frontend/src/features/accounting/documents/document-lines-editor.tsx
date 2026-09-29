import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { useFieldArray, useFormContext } from 'react-hook-form';
import type { Account } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { Trash2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableWrapper,
} from '@/ui/table';
import {
  emptyDocumentLine,
  MAX_DOCUMENT_DESCRIPTION_LENGTH,
  type DocumentFormValues,
} from './document-form-schema';
import { LineAccountSelect, LineDetailSelect } from './line-reference-fields';
import { useAccountReference } from './use-document-detail';

/**
 * The lines editor of the compose form (FE-UX-08 §8.4).
 *
 * Rows are RHF field-array entries (`lines`); each cell registers its field
 * directly, so validation lives in the Zod schema and errors render inline.
 * Debit/credit accept ONE side per line (the money pattern of the backend
 * contract); both empty or both filled is rejected by the schema, and zero is
 * written back as the canonical «0» string on submit. The editor computes no
 * totals — aggregated debit/credit is the backend's own number, shown only
 * from a response.
 *
 * Keyboard support: Enter inside a row moves to the next row (or adds one),
 * never submits the form; Ctrl+S submits.
 */
export function DocumentLinesEditor({
  organizationId,
}: {
  organizationId: string | null;
}): ReactElement {
  const form = useFormContext<DocumentFormValues>();
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'lines',
  });
  // Focus scheduled for a row that does not exist yet (the row appended in
  // this very event); consumed by the layout effect once it renders.
  const pendingFocusRef = useRef<number | null>(null);
  const rowRefs = useRef(new Map<number, HTMLElement>());

  const linesError =
    form.formState.errors.lines?.message ??
    form.formState.errors.lines?.root?.message ??
    null;

  const focusRow = (index: number) => {
    const row = rowRefs.current.get(index);
    row
      ?.querySelector<HTMLElement>(
        'select:not([disabled]), input:not([disabled]):not([type="search"])',
      )
      ?.focus();
  };

  useLayoutEffect(() => {
    const index = pendingFocusRef.current;
    if (index === null) return;
    const row = rowRefs.current.get(index);
    if (row === undefined) return; // not rendered yet; keep waiting
    pendingFocusRef.current = null;
    focusRow(index);
  });

  const addLine = () => {
    append(emptyDocumentLine());
    pendingFocusRef.current = fields.length;
  };

  const handleRowKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    index: number,
  ) => {
    if (event.key !== 'Enter') return;
    event.preventDefault(); // Enter moves between rows; it never submits.
    if (index + 1 < fields.length) {
      focusRow(index + 1);
    } else {
      addLine();
    }
  };

  return (
    <section aria-label={t.documents.linesSection} className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-800">
          {t.documents.linesSection}
        </h2>
        <Button type="button" variant="outline" size="sm" onClick={addLine}>
          {t.documents.addLine}
        </Button>
      </div>

      <TableWrapper>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell className="w-10">
                {t.documents.lineNo}
              </TableHeaderCell>
              <TableHeaderCell className="min-w-56">
                {t.documents.lineAccount}
              </TableHeaderCell>
              <TableHeaderCell className="min-w-56">
                {t.documents.lineDetail}
              </TableHeaderCell>
              <TableHeaderCell className="text-end">
                {t.documents.debit}
              </TableHeaderCell>
              <TableHeaderCell className="text-end">
                {t.documents.credit}
              </TableHeaderCell>
              <TableHeaderCell className="min-w-48">
                {t.documents.lineDescription}
              </TableHeaderCell>
              <TableHeaderCell className="w-12">
                <span className="sr-only">{t.documents.removeLine}</span>
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {fields.map((field, index) => (
              <DocumentLineRow
                key={field.id}
                index={index}
                organizationId={organizationId}
                canRemove={fields.length > 1}
                onRemove={() => remove(index)}
                onKeyDown={(event) => handleRowKeyDown(event, index)}
                registerRowRef={(element) => {
                  if (element === null) rowRefs.current.delete(index);
                  else rowRefs.current.set(index, element);
                }}
              />
            ))}
          </TableBody>
        </Table>
      </TableWrapper>

      {linesError !== null && (
        <p role="alert" className="text-xs font-medium text-rose-700">
          {linesError}
        </p>
      )}
      <p className="text-[11px] text-slate-500">{t.documents.linesHint}</p>
    </section>
  );
}

function DocumentLineRow({
  index,
  organizationId,
  canRemove,
  onRemove,
  onKeyDown,
  registerRowRef,
}: {
  index: number;
  organizationId: string | null;
  canRemove: boolean;
  onRemove: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  registerRowRef: (element: HTMLElement | null) => void;
}): ReactElement {
  const form = useFormContext<DocumentFormValues>();
  const { register, watch, setValue, formState } = form;

  const accountId = watch(`lines.${index}.accountId`);
  const accountQuery = useAccountReference(
    organizationId,
    accountId === '' ? undefined : accountId,
  );
  const account: Account | undefined = accountQuery.data;
  const needsDetail =
    account?.detailGroupId !== undefined && account?.detailGroupId !== null;

  const lineErrors = (formState.errors.lines?.[index] ?? {}) as {
    accountId?: { message?: string | undefined };
    detailId?: { message?: string | undefined };
    debitAmount?: { message?: string | undefined };
    creditAmount?: { message?: string | undefined };
    description?: { message?: string | undefined };
  };

  return (
    <TableRow ref={registerRowRef} onKeyDown={onKeyDown}>
      <TableCell>
        <span className="num">{index + 1}</span>
      </TableCell>
      <TableCell>
        <LineAccountSelect
          id={`lines-${index}-account`}
          organizationId={organizationId}
          value={accountId}
          error={lineErrors.accountId?.message}
          onChange={(next) => {
            setValue(`lines.${index}.accountId`, next, { shouldDirty: true });
            // A detail belongs to its account's group; changing the account
            // voids the previous detail selection.
            setValue(`lines.${index}.detailId`, '', { shouldDirty: true });
          }}
        />
      </TableCell>
      <TableCell>
        {needsDetail ? (
          <LineDetailSelect
            id={`lines-${index}-detail`}
            organizationId={organizationId}
            value={watch(`lines.${index}.detailId`)}
            error={lineErrors.detailId?.message}
            onChange={(next) =>
              setValue(`lines.${index}.detailId`, next, { shouldDirty: true })
            }
          />
        ) : (
          <p className="text-xs text-slate-400">
            {t.documents.detailNotRequired}
          </p>
        )}
      </TableCell>
      <TableCell>
        <Input
          dir="ltr"
          inputMode="decimal"
          className="text-end tabular-nums"
          placeholder="0"
          aria-invalid={lineErrors.debitAmount?.message !== undefined}
          aria-describedby={
            lineErrors.debitAmount?.message !== undefined
              ? `lines-${index}-debit-error`
              : undefined
          }
          {...register(`lines.${index}.debitAmount`)}
        />
        {lineErrors.debitAmount?.message !== undefined && (
          <p
            id={`lines-${index}-debit-error`}
            role="alert"
            className="mt-1 text-xs text-rose-700"
          >
            {lineErrors.debitAmount.message}
          </p>
        )}
      </TableCell>
      <TableCell>
        <Input
          dir="ltr"
          inputMode="decimal"
          className="text-end tabular-nums"
          placeholder="0"
          aria-invalid={lineErrors.creditAmount?.message !== undefined}
          aria-describedby={
            lineErrors.creditAmount?.message !== undefined
              ? `lines-${index}-credit-error`
              : undefined
          }
          {...register(`lines.${index}.creditAmount`)}
        />
        {lineErrors.creditAmount?.message !== undefined && (
          <p
            id={`lines-${index}-credit-error`}
            role="alert"
            className="mt-1 text-xs text-rose-700"
          >
            {lineErrors.creditAmount.message}
          </p>
        )}
      </TableCell>
      <TableCell>
        <Input
          maxLength={MAX_DOCUMENT_DESCRIPTION_LENGTH}
          aria-invalid={lineErrors.description?.message !== undefined}
          aria-describedby={
            lineErrors.description?.message !== undefined
              ? `lines-${index}-description-error`
              : undefined
          }
          {...register(`lines.${index}.description`)}
        />
        {lineErrors.description?.message !== undefined && (
          <p
            id={`lines-${index}-description-error`}
            role="alert"
            className="mt-1 text-xs text-rose-700"
          >
            {lineErrors.description.message}
          </p>
        )}
      </TableCell>
      <TableCell>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canRemove}
          onClick={onRemove}
          aria-label={t.documents.removeLine}
          title={canRemove ? t.documents.removeLine : undefined}
        >
          <Trash2 aria-hidden className="h-4 w-4 text-rose-600" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
