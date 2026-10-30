import type { MaterialRequestLine } from '@/api/contracts';
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
import { Badge } from '@/ui/badge';
import type { InventoryReferences } from '../use-inventory-references';

/**
 * The request's lines exactly as the server stored them: entered quantity and
 * unit, the base-unit equivalent it resolved for the organization's current
 * business day, the reservation flag/id, and how much of the line has already
 * been invoked into a subsequent process.
 */
export function MaterialRequestLinesTable({
  lines,
  references,
}: {
  lines: MaterialRequestLine[];
  references: Pick<
    InventoryReferences,
    'itemById' | 'warehouseById' | 'unitById'
  >;
}) {
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink">
        {t.materialRequests.lines}
      </h2>
      <TableWrapper>
        <Table data-testid="material-request-lines-table">
          <caption className="sr-only">{t.materialRequests.lines}</caption>
          <TableHead>
            <TableRow>
              <TableHeaderCell>{t.materialRequests.lineNumber}</TableHeaderCell>
              <TableHeaderCell>{t.materialRequests.item}</TableHeaderCell>
              <TableHeaderCell>{t.materialRequests.warehouse}</TableHeaderCell>
              <TableHeaderCell>{t.materialRequests.quantity}</TableHeaderCell>
              <TableHeaderCell>
                {t.materialRequests.baseQuantity}
              </TableHeaderCell>
              <TableHeaderCell>
                {t.materialRequests.reservationRequested}
              </TableHeaderCell>
              <TableHeaderCell>{t.materialRequests.invoked}</TableHeaderCell>
              <TableHeaderCell>{t.materialRequests.remaining}</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map((line) => {
              const item = references.itemById(line.itemId);
              const warehouse = references.warehouseById(line.warehouseId);
              const unit = references.unitById(line.unitId);
              const baseUnit = references.unitById(line.baseUnitId);
              return (
                <TableRow
                  key={line.id}
                  data-testid={`material-request-line-row-${line.id}`}
                >
                  <TableCell className="num">
                    {formatCount(line.lineNumber)}
                  </TableCell>
                  <TableCell>
                    {item === undefined
                      ? line.itemId
                      : `${item.code} — ${item.name}`}
                  </TableCell>
                  <TableCell>
                    {warehouse === undefined
                      ? line.warehouseId
                      : `${warehouse.code} — ${warehouse.name}`}
                  </TableCell>
                  <TableCell className="num">
                    {formatQuantity(line.quantity)}{' '}
                    <span className="text-xs text-ink-subtle">
                      {unit?.code ?? line.unitId}
                    </span>
                  </TableCell>
                  <TableCell className="num">
                    {formatQuantity(line.baseQuantity)}{' '}
                    <span className="text-xs text-ink-subtle">
                      {baseUnit?.code ?? line.baseUnitId}
                    </span>
                  </TableCell>
                  <TableCell>
                    {line.reservationRequested ? (
                      <span className="flex flex-wrap items-center gap-1">
                        <Badge variant="info">
                          {t.materialRequests.reservationYes}
                        </Badge>
                        {line.reservationId !== null ? (
                          <span className="code text-xs" dir="ltr">
                            {line.reservationId}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-ink-subtle">
                        {t.materialRequests.reservationNo}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="num">
                    {formatQuantity(line.invokedBaseQuantity)}
                  </TableCell>
                  <TableCell className="num">
                    {formatQuantity(line.remainingBaseQuantity)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableWrapper>
    </Card>
  );
}
