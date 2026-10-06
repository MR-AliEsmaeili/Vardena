import type { InventoryDocument } from '@/api/contracts';
import { formatCount, formatQuantity } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Card } from '@/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableWrapper,
} from '@/ui/table';
import type { InventoryReferences } from '../use-inventory-references';

/**
 * The document's lines, with the base-unit quantity the ledger actually
 * stored and the movement ids the posting produced (a transfer line owns
 * TWO: the outbound leg and the inbound leg, written in one transaction).
 */
export function DocumentLinesTable({
  document,
  references,
}: {
  document: InventoryDocument;
  references: Pick<InventoryReferences, 'itemById' | 'unitById'>;
}) {
  const posted = document.lines.some(
    (line) =>
      line.movementId !== null ||
      line.outMovementId !== null ||
      line.inMovementId !== null,
  );

  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-800">
        {t.inventoryDocuments.lines}
      </h2>
      <TableWrapper>
        <Table data-testid="document-lines-table">
          <caption className="sr-only">{t.inventoryDocuments.lines}</caption>
          <TableHead>
            <TableRow>
              <TableHeaderCell>
                {t.inventoryDocuments.lineNumber}
              </TableHeaderCell>
              <TableHeaderCell>{t.inventoryDocuments.lineItem}</TableHeaderCell>
              <TableHeaderCell>
                {t.inventoryDocuments.lineQuantity}
              </TableHeaderCell>
              <TableHeaderCell>
                {t.inventoryDocuments.lineBaseQuantity}
              </TableHeaderCell>
              {posted ? (
                <TableHeaderCell>
                  {t.inventoryDocuments.movementLink}
                </TableHeaderCell>
              ) : null}
            </TableRow>
          </TableHead>
          <TableBody>
            {document.lines.map((line) => {
              const item = references.itemById(line.itemId);
              const unit = references.unitById(line.unitId);
              const baseUnit = references.unitById(line.baseUnitId);
              return (
                <TableRow
                  key={line.id}
                  data-testid={`document-line-row-${line.id}`}
                >
                  <TableCell className="num">
                    {formatCount(line.lineNumber)}
                  </TableCell>
                  <TableCell>
                    {item === undefined ? (
                      <span className="code">{line.itemId}</span>
                    ) : (
                      `${item.code} — ${item.name}`
                    )}
                  </TableCell>
                  <TableCell className="num">
                    {formatQuantity(line.quantity)}{' '}
                    <span className="text-xs text-slate-500">
                      {unit?.code ?? line.unitId}
                    </span>
                  </TableCell>
                  <TableCell className="num">
                    {formatQuantity(line.baseQuantity)}{' '}
                    <span className="text-xs text-slate-500">
                      {baseUnit?.code ?? line.baseUnitId}
                    </span>
                  </TableCell>
                  {posted ? (
                    <TableCell>
                      <LineMovements line={line} />
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableWrapper>
    </Card>
  );
}

function LineMovements({ line }: { line: InventoryDocument['lines'][number] }) {
  if (line.movementId !== null) {
    return <span className="code">{line.movementId}</span>;
  }
  if (line.outMovementId !== null || line.inMovementId !== null) {
    return (
      <div className="space-y-1 text-xs">
        <p>
          {t.inventoryDocuments.outMovement}:{' '}
          <span className="code">{line.outMovementId ?? t.app.none}</span>
        </p>
        <p>
          {t.inventoryDocuments.inMovement}:{' '}
          <span className="code">{line.inMovementId ?? t.app.none}</span>
        </p>
      </div>
    );
  }
  return (
    <span className="text-slate-500">{t.inventoryDocuments.noMovementYet}</span>
  );
}
