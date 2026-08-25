import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { loadColumnWidths, saveColumnWidths } from "@/lib/tableStorage";
import { TablePagination } from "@/components/TablePagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface DataTableColumn<T> {
  id: string;
  header: React.ReactNode;
  accessorKey?: keyof T;
  cell?: (item: T) => React.ReactNode;
  className?: string;
  minWidth?: number;
  defaultWidth?: number;
  resizable?: boolean;
  align?: "left" | "right";
}

export interface DataTableProps<T> {
  data: T[];
  columns: DataTableColumn<T>[];
  tableId: string;
  onRowClick?: (item: T) => void;
  getRowClassName?: (item: T) => string | undefined;
  className?: string;
  pageSize?: number;
  enablePagination?: boolean;
  enableColumnResize?: boolean;
}

const DEFAULT_MIN_WIDTH = 72;
const DEFAULT_COLUMN_WIDTH = 140;
const ACTIONS_COLUMN_ID = "actions";
const ACTIONS_COLUMN_WIDTH = 52;

function isActionsColumn<T>(col: DataTableColumn<T>): boolean {
  return col.id === ACTIONS_COLUMN_ID;
}

const STICKY_ACTIONS_HEAD_CLASS =
  "sticky right-0 z-20 !w-[52px] min-w-[52px] max-w-[52px] bg-muted/95 backdrop-blur-sm border-l border-border/50 shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.08)]";

const STICKY_ACTIONS_CELL_CLASS =
  "sticky right-0 z-10 !w-[52px] min-w-[52px] max-w-[52px] bg-card border-l border-border/50 shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.08)] group-hover:bg-muted/50 group-data-[state=selected]:bg-muted";

function columnAlign<T>(col: DataTableColumn<T>): "left" | "right" {
  if (col.align) return col.align;
  return isActionsColumn(col) ? "right" : "left";
}

function getDefaultWidths<T>(columns: DataTableColumn<T>[]): Record<string, number> {
  return Object.fromEntries(
    columns.map((col) => [
      col.id,
      isActionsColumn(col) ? ACTIONS_COLUMN_WIDTH : (col.defaultWidth ?? DEFAULT_COLUMN_WIDTH),
    ]),
  );
}

export function DataTable<T>({
  data,
  columns,
  tableId,
  onRowClick,
  getRowClassName,
  className,
  pageSize = 20,
  enablePagination = true,
  enableColumnResize = true,
}: DataTableProps<T>) {
  const [page, setPage] = useState(1);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const stored = loadColumnWidths(tableId);
    const defaults = getDefaultWidths(columns);
    return stored ? { ...defaults, ...stored } : defaults;
  });
  const resizingRef = useRef<{
    columnId: string;
    startX: number;
    startWidth: number;
    minWidth: number;
  } | null>(null);

  useEffect(() => {
    setPage(1);
  }, [data.length, tableId]);

  useEffect(() => {
    const defaults = getDefaultWidths(columns);
    const stored = loadColumnWidths(tableId);
    setColumnWidths(stored ? { ...defaults, ...stored } : defaults);
    // Only re-init widths when the table identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId]);

  const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const paginatedData = useMemo(() => {
    if (!enablePagination) return data;
    const start = (safePage - 1) * pageSize;
    return data.slice(start, start + pageSize);
  }, [data, enablePagination, safePage, pageSize]);

  const persistWidths = useCallback(
    (widths: Record<string, number>) => {
      saveColumnWidths(tableId, widths);
    },
    [tableId],
  );

  const handleResizeStart = useCallback(
    (columnId: string, minWidth: number, clientX: number) => {
      if (!enableColumnResize) return;
      const startWidth = columnWidths[columnId] ?? DEFAULT_COLUMN_WIDTH;
      resizingRef.current = { columnId, startX: clientX, startWidth, minWidth };

      const onMove = (e: MouseEvent) => {
        const state = resizingRef.current;
        if (!state) return;
        const next = Math.max(state.minWidth, state.startWidth + (e.clientX - state.startX));
        setColumnWidths((prev) => ({ ...prev, [state.columnId]: next }));
      };

      const onUp = (e: MouseEvent) => {
        const state = resizingRef.current;
        resizingRef.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        if (!state) return;
        const finalWidth = Math.max(state.minWidth, state.startWidth + (e.clientX - state.startX));
        setColumnWidths((prev) => {
          const next = { ...prev, [state.columnId]: finalWidth };
          persistWidths(next);
          return next;
        });
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [columnWidths, enableColumnResize, persistWidths],
  );

  const tableMinWidth = useMemo(
    () =>
      columns.reduce((sum, col) => {
        if (isActionsColumn(col)) return sum + ACTIONS_COLUMN_WIDTH;
        return sum + (columnWidths[col.id] ?? col.defaultWidth ?? DEFAULT_COLUMN_WIDTH);
      }, 0),
    [columns, columnWidths],
  );

  const hasActionsColumn = useMemo(() => columns.some(isActionsColumn), [columns]);

  return (
    <div
      className={cn(
        "w-full max-w-full min-w-0 bg-card rounded-xl border border-card-border overflow-hidden shadow-soft",
        className,
      )}
    >
      <div className="w-full max-w-full min-w-0 overflow-x-auto overscroll-x-contain">
        <Table
          noContainer
          className="table-fixed min-w-full"
          style={{ width: tableMinWidth }}
        >
          <colgroup>
            {columns.map((col) => (
              <col
                key={col.id}
                style={{
                  width: isActionsColumn(col)
                    ? ACTIONS_COLUMN_WIDTH
                    : (columnWidths[col.id] ?? col.defaultWidth ?? DEFAULT_COLUMN_WIDTH),
                }}
              />
            ))}
          </colgroup>
          <TableHeader className="bg-muted/30">
            <TableRow className="hover:bg-transparent border-b border-border/50">
              {columns.map((col) => {
                const minW = col.minWidth ?? (isActionsColumn(col) ? ACTIONS_COLUMN_WIDTH : DEFAULT_MIN_WIDTH);
                const resizable = enableColumnResize && col.resizable !== false && !isActionsColumn(col);
                const align = columnAlign(col);
                const stickyActions = isActionsColumn(col);
                return (
                  <TableHead
                    key={col.id}
                    className={cn(
                      "relative font-semibold select-none bg-muted/30",
                      align === "right" ? "text-right" : "text-left",
                      stickyActions && STICKY_ACTIONS_HEAD_CLASS,
                      stickyActions && "pr-2 pl-2",
                      !stickyActions && "pr-3",
                      col.className,
                    )}
                  >
                    <div className={cn(stickyActions ? "flex justify-center" : "truncate", align === "right" && !stickyActions && "flex justify-end", !stickyActions && align !== "right" && "pr-2")}>
                      {col.header}
                    </div>
                    {resizable && (
                      <button
                        type="button"
                        aria-label={`Resize ${typeof col.header === "string" ? col.header : col.id} column`}
                        className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize border-r border-transparent hover:border-border/80"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleResizeStart(col.id, minW, e.clientX);
                        }}
                      />
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedData.map((row, i) => (
              <TableRow
                key={i}
                onClick={() => onRowClick?.(row)}
                className={cn(
                  "transition-colors",
                  hasActionsColumn && "group",
                  onRowClick ? "cursor-pointer hover:bg-muted/50" : "",
                  getRowClassName?.(row),
                )}
              >
                {columns.map((col) => {
                  const align = columnAlign(col);
                  const stickyActions = isActionsColumn(col);
                  return (
                    <TableCell
                      key={col.id}
                      className={cn(
                        stickyActions ? "overflow-visible p-1" : "truncate",
                        align === "right" ? "text-right" : "text-left",
                        stickyActions && STICKY_ACTIONS_CELL_CLASS,
                        !stickyActions && "pr-3",
                        col.className,
                      )}
                    >
                      <div className={cn(stickyActions ? "flex justify-center" : "truncate", align === "right" && !stickyActions && "flex justify-end")}>
                        {col.cell ? col.cell(row) : col.accessorKey ? String(row[col.accessorKey] ?? "") : null}
                      </div>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
            {data.length === 0 && (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-left text-cool-slate">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {enablePagination && data.length > 0 && (
        <TablePagination
          page={safePage}
          pageSize={pageSize}
          totalItems={data.length}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
