import { useMemo, type ReactElement } from 'react';
import { useFieldArray, useFormContext } from 'react-hook-form';
import type { Account } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { Input } from '@/ui/input';
import {
  DetailGrid,
  type DetailGridColumn,
} from '@/ui/patterns/operational-form';
import {
  emptyDocumentLine,
  MAX_DOCUMENT_DESCRIPTION_LENGTH,
  type DocumentFormValues,
  type DocumentLineValues,
} from './document-form-schema';
import { LineAccountSelect, LineDetailSelect } from './line-reference-fields';
import { useAccountReference } from './use-document-detail';

interface FieldLineRow extends DocumentLineValues {
  id: string;
}

/**
 * Operational Detail Grid for Accounting Document lines (FE-UX-08 §8.4).
 *
 * Built on the shared `DetailGrid`:
 * - Stable RHF `field.id` row keys (never array index).
 * - Keyboard navigation (`Enter` advances/appends row; `ArrowUp`/`ArrowDown`
 *   moves vertically; `Ctrl+S` submits).
 * - Row Context Menu: Insert Above, Insert Below, Duplicate Row, Delete Row.
 * - Automatic virtualization at 80+ rows.
 */
export function DocumentLinesEditor({
  organizationId,
  readOnly = false,
}: {
  organizationId: string | null;
  readOnly?: boolean;
}): ReactElement {
  const form = useFormContext<DocumentFormValues>();
  const { fields, append, insert, remove } = useFieldArray({
    control: form.control,
    name: 'lines',
  });

  const linesError =
    form.formState.errors.lines?.message ??
    form.formState.errors.lines?.root?.message ??
    null;

  const columns = useMemo<DetailGridColumn<FieldLineRow>[]>(
    () => [
      {
        key: 'account',
        header: t.documents.lineAccount,
        minWidthClass: 'min-w-56',
        render: (_row, index) => (
          <AccountCell index={index} organizationId={organizationId} />
        ),
      },
      {
        key: 'detail',
        header: t.documents.lineDetail,
        minWidthClass: 'min-w-52',
        render: (_row, index) => (
          <DetailCell index={index} organizationId={organizationId} />
        ),
      },
      {
        key: 'debit',
        header: t.documents.debit,
        minWidthClass: 'min-w-36',
        align: 'end',
        render: (_row, index) => (
          <AmountSideCell index={index} side="debitAmount" />
        ),
      },
      {
        key: 'credit',
        header: t.documents.credit,
        minWidthClass: 'min-w-36',
        align: 'end',
        render: (_row, index) => (
          <AmountSideCell index={index} side="creditAmount" />
        ),
      },
      {
        key: 'description',
        header: t.documents.lineDescription,
        minWidthClass: 'min-w-48',
        render: (_row, index) => <DescriptionCell index={index} />,
      },
    ],
    [organizationId],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-ink">
          {t.documents.linesSection}
        </h2>
      </div>

      <DetailGrid
        ariaLabel={t.documents.linesSection}
        columns={columns}
        rows={fields}
        getRowId={(row) => row.id}
        readOnly={readOnly}
        addLabel={t.documents.addLine}
        onAddRow={() => append(emptyDocumentLine())}
        onInsertAbove={(index) => insert(index, emptyDocumentLine())}
        onInsertBelow={(index) => insert(index + 1, emptyDocumentLine())}
        onDuplicateRow={(index) => {
          const current = form.getValues(`lines.${index}`);
          insert(index + 1, {
            accountId: current.accountId,
            detailId: current.detailId,
            debitAmount: current.debitAmount,
            creditAmount: current.creditAmount,
            description: current.description,
          });
        }}
        onRemoveRow={(index) => {
          if (fields.length > 1) remove(index);
        }}
        canRemoveRow={() => fields.length > 1}
      />

      {linesError !== null && (
        <p role="alert" className="text-xs font-medium text-danger-ink">
          {linesError}
        </p>
      )}
      <p className="text-[0.6875rem] text-ink-subtle">
        {t.documents.linesHint}
      </p>
    </div>
  );
}

function AccountCell({
  index,
  organizationId,
}: {
  index: number;
  organizationId: string | null;
}) {
  const form = useFormContext<DocumentFormValues>();
  const accountId = form.watch(`lines.${index}.accountId`);
  const error = form.formState.errors.lines?.[index]?.accountId?.message;

  return (
    <LineAccountSelect
      id={`lines-${index}-account`}
      organizationId={organizationId}
      value={accountId}
      error={error}
      onChange={(next) => {
        form.setValue(`lines.${index}.accountId`, next, { shouldDirty: true });
        form.setValue(`lines.${index}.detailId`, '', { shouldDirty: true });
      }}
    />
  );
}

function DetailCell({
  index,
  organizationId,
}: {
  index: number;
  organizationId: string | null;
}) {
  const form = useFormContext<DocumentFormValues>();
  const accountId = form.watch(`lines.${index}.accountId`);
  const detailId = form.watch(`lines.${index}.detailId`);
  const accountQuery = useAccountReference(
    organizationId,
    accountId === '' ? undefined : accountId,
  );
  const account: Account | undefined = accountQuery.data;
  const needsDetail =
    account?.detailGroupId !== undefined && account?.detailGroupId !== null;
  const error = form.formState.errors.lines?.[index]?.detailId?.message;

  if (!needsDetail) {
    return (
      <p className="text-xs text-ink-subtle">{t.documents.detailNotRequired}</p>
    );
  }

  return (
    <LineDetailSelect
      id={`lines-${index}-detail`}
      organizationId={organizationId}
      value={detailId}
      error={error}
      onChange={(next) =>
        form.setValue(`lines.${index}.detailId`, next, { shouldDirty: true })
      }
    />
  );
}

function AmountSideCell({
  index,
  side,
}: {
  index: number;
  side: 'debitAmount' | 'creditAmount';
}) {
  const form = useFormContext<DocumentFormValues>();
  const error = form.formState.errors.lines?.[index]?.[side]?.message;
  const errorId = `lines-${index}-${side}-error`;

  return (
    <div>
      <Input
        dir="ltr"
        inputMode="decimal"
        className="text-end tabular-nums"
        placeholder="0"
        aria-label={
          side === 'debitAmount' ? t.documents.debit : t.documents.credit
        }
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
        {...form.register(`lines.${index}.${side}`)}
      />
      {error !== undefined && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-danger-ink">
          {error}
        </p>
      )}
    </div>
  );
}

function DescriptionCell({ index }: { index: number }) {
  const form = useFormContext<DocumentFormValues>();
  const error = form.formState.errors.lines?.[index]?.description?.message;
  const errorId = `lines-${index}-description-error`;

  return (
    <div>
      <Input
        maxLength={MAX_DOCUMENT_DESCRIPTION_LENGTH}
        aria-label={t.documents.lineDescription}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
        {...form.register(`lines.${index}.description`)}
      />
      {error !== undefined && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-danger-ink">
          {error}
        </p>
      )}
    </div>
  );
}
