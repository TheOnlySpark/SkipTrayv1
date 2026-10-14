import React, { useState, useMemo } from 'react';
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Inbox,
  Loader2
} from 'lucide-react';

export interface Column<T = any> {
  key: string;
  header: React.ReactNode;
  accessor?: keyof T | ((row: T) => any);
  render?: (value: any, row: T, index: number) => React.ReactNode;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  width?: string;
  className?: string;
  headerClassName?: string;
}

export interface TableProps<T = any> {
  data: T[];
  columns: Column<T>[];
  keyExtractor?: (row: T, index: number) => string | number;
  loading?: boolean;
  emptyMessage?: React.ReactNode;
  emptyIcon?: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchFilter?: (row: T, query: string) => boolean;
  pagination?: boolean;
  pageSize?: number;
  pageSizeOptions?: number[];
  selectable?: boolean;
  selectedKeys?: (string | number)[];
  onSelectionChange?: (selectedKeys: (string | number)[], selectedRows: T[]) => void;
  onRowClick?: (row: T, index: number) => void;
  hoverable?: boolean;
  striped?: boolean;
  compact?: boolean;
  className?: string;
  containerClassName?: string;
}

export function Table<T = any>({
  data = [],
  columns = [],
  keyExtractor,
  loading = false,
  emptyMessage = 'No records found',
  emptyIcon,
  title,
  subtitle,
  actions,
  searchable = false,
  searchPlaceholder = 'Search records...',
  searchFilter,
  pagination = false,
  pageSize: initialPageSize = 10,
  pageSizeOptions = [5, 10, 25, 50],
  selectable = false,
  selectedKeys: controlledSelectedKeys,
  onSelectionChange,
  onRowClick,
  hoverable = true,
  striped = false,
  compact = false,
  className = '',
  containerClassName = ''
}: TableProps<T>) {
  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Sorting state
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  // Internal selection state (uncontrolled fallback)
  const [internalSelectedKeys, setInternalSelectedKeys] = useState<(string | number)[]>([]);
  const isControlledSelection = controlledSelectedKeys !== undefined;
  const selectedKeys = isControlledSelection ? controlledSelectedKeys : internalSelectedKeys;

  // Helper to extract unique key for a row
  const getRowKey = (row: T, index: number): string | number => {
    if (keyExtractor) return keyExtractor(row, index);
    if (typeof row === 'object' && row !== null && 'id' in row) {
      return (row as any).id;
    }
    return index;
  };

  // Helper to extract value from row for a column
  const getCellValue = (row: T, col: Column<T>) => {
    if (typeof col.accessor === 'function') {
      return col.accessor(row);
    }
    if (typeof col.accessor === 'string' || typeof col.accessor === 'number') {
      return (row as any)[col.accessor];
    }
    if (col.key in (row as any)) {
      return (row as any)[col.key];
    }
    return undefined;
  };

  // 1. Filtered Data (Search)
  const filteredData = useMemo(() => {
    if (!searchQuery.trim()) return data;

    const query = searchQuery.toLowerCase().trim();

    if (searchFilter) {
      return data.filter(row => searchFilter(row, query));
    }

    // Default search across all visible columns
    return data.filter(row => {
      return columns.some(col => {
        const val = getCellValue(row, col);
        if (val === null || val === undefined) return false;
        return String(val).toLowerCase().includes(query);
      });
    });
  }, [data, searchQuery, searchFilter, columns]);

  // 2. Sorted Data
  const sortedData = useMemo(() => {
    if (!sortKey || !sortOrder) return filteredData;

    const column = columns.find(c => c.key === sortKey);
    if (!column) return filteredData;

    return [...filteredData].sort((a, b) => {
      const valA = getCellValue(a, column);
      const valB = getCellValue(b, column);

      if (valA === valB) return 0;
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortOrder === 'asc' ? valA - valB : valB - valA;
      }

      const strA = String(valA).toLowerCase();
      const strB = String(valB).toLowerCase();
      if (strA < strB) return sortOrder === 'asc' ? -1 : 1;
      if (strA > strB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortKey, sortOrder, columns]);

  // 3. Paginated Data
  const totalItems = sortedData.length;
  const totalPages = pagination ? Math.max(1, Math.ceil(totalItems / pageSize)) : 1;

  const paginatedData = useMemo(() => {
    if (!pagination) return sortedData;
    const start = (currentPage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, pagination, currentPage, pageSize]);

  // Handle column header sort click
  const handleSort = (col: Column<T>) => {
    if (!col.sortable) return;

    if (sortKey !== col.key) {
      setSortKey(col.key);
      setSortOrder('asc');
    } else if (sortOrder === 'asc') {
      setSortOrder('desc');
    } else if (sortOrder === 'desc') {
      setSortKey(null);
      setSortOrder(null);
    }
  };

  // Handle Selection
  const allCurrentPageKeys = paginatedData.map(getRowKey);
  const isAllSelected =
    allCurrentPageKeys.length > 0 &&
    allCurrentPageKeys.every(k => selectedKeys.includes(k));
  const isPartiallySelected =
    allCurrentPageKeys.some(k => selectedKeys.includes(k)) && !isAllSelected;

  const handleSelectAll = () => {
    let nextKeys: (string | number)[];
    if (isAllSelected) {
      nextKeys = selectedKeys.filter(k => !allCurrentPageKeys.includes(k));
    } else {
      const merged = new Set([...selectedKeys, ...allCurrentPageKeys]);
      nextKeys = Array.from(merged);
    }

    if (!isControlledSelection) {
      setInternalSelectedKeys(nextKeys);
    }

    const nextRows = data.filter((row, idx) => nextKeys.includes(getRowKey(row, idx)));
    onSelectionChange?.(nextKeys, nextRows);
  };

  const handleSelectRow = (e: React.SyntheticEvent, row: T, index: number) => {
    e.stopPropagation();
    const key = getRowKey(row, index);
    const isSelected = selectedKeys.includes(key);
    const nextKeys = isSelected
      ? selectedKeys.filter(k => k !== key)
      : [...selectedKeys, key];

    if (!isControlledSelection) {
      setInternalSelectedKeys(nextKeys);
    }

    const nextRows = data.filter((r, idx) => nextKeys.includes(getRowKey(r, idx)));
    onSelectionChange?.(nextKeys, nextRows);
  };

  return (
    <div className={`w-full bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden flex flex-col ${containerClassName}`}>
      {/* 1. Header Toolbar (Title, Subtitle, Search, Actions) */}
      {(title || subtitle || actions || searchable) && (
        <div className="p-4 sm:p-5 border-b border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 bg-white">
          {(title || subtitle) && (
            <div className="min-w-0">
              {title && (
                <h3 className="text-base sm:text-lg font-bold text-slate-800 tracking-tight truncate">
                  {title}
                </h3>
              )}
              {subtitle && (
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5 truncate">
                  {subtitle}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5 sm:ml-auto">
            {/* Search Input */}
            {searchable && (
              <div className="relative flex items-center min-w-[200px] max-w-xs flex-1 sm:flex-initial">
                <Search size={15} className="absolute left-3 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder={searchPlaceholder}
                  className="w-full pl-9 pr-3 py-1.5 text-xs sm:text-sm bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:border-indigo-600 text-slate-800 placeholder:text-slate-400 transition"
                />
              </div>
            )}

            {/* Custom Toolbar Actions */}
            {actions}
          </div>
        </div>
      )}

      {/* 2. Responsive Table Scroll View */}
      <div className="overflow-x-auto custom-scrollbar flex-1">
        <table className={`w-full text-left border-collapse ${className}`}>
          {/* Table Header */}
          <thead>
            <tr className="bg-slate-50/80 border-b border-slate-200/80 text-[11px] font-medium uppercase tracking-wider text-slate-500 select-none">
              {/* Checkbox column */}
              {selectable && (
                <th className={`w-10 px-4 ${compact ? 'py-2.5' : 'py-3.5'}`}>
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={input => {
                      if (input) input.indeterminate = isPartiallySelected;
                    }}
                    onChange={handleSelectAll}
                    aria-label="Select all rows"
                    className="w-4 h-4 rounded-sm border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                </th>
              )}

              {/* Column headers */}
              {columns.map(col => {
                const isSorted = sortKey === col.key;
                const alignClass =
                  col.align === 'center'
                    ? 'text-center'
                    : col.align === 'right'
                    ? 'text-right'
                    : 'text-left';

                return (
                  <th
                    key={col.key}
                    style={{ width: col.width }}
                    onClick={() => handleSort(col)}
                    className={`
                      ${alignClass}
                      ${compact ? 'py-2.5 px-3' : 'py-3.5 px-4'}
                      ${col.sortable ? 'cursor-pointer hover:bg-slate-100/80 hover:text-slate-700 transition-colors' : ''}
                      ${col.headerClassName || ''}
                    `}
                  >
                    <div className={`inline-flex items-center gap-1.5 ${alignClass === 'text-right' ? 'justify-end' : alignClass === 'text-center' ? 'justify-center' : 'justify-start'}`}>
                      <span>{col.header}</span>
                      {col.sortable && (
                        <span className="shrink-0 text-slate-400">
                          {isSorted ? (
                            sortOrder === 'asc' ? (
                              <ChevronUp size={14} className="text-indigo-600" />
                            ) : (
                              <ChevronDown size={14} className="text-indigo-600" />
                            )
                          ) : (
                            <ChevronsUpDown size={13} className="opacity-50" />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          {/* Table Body */}
          <tbody className="divide-y divide-slate-100 text-xs sm:text-sm text-slate-700">
            {loading ? (
              /* Loading State */
              <tr>
                <td
                  colSpan={columns.length + (selectable ? 1 : 0)}
                  className="py-12 text-center text-slate-500"
                >
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Loader2 size={24} className="animate-spin text-indigo-600" />
                    <span className="text-xs font-medium text-slate-500">Loading data...</span>
                  </div>
                </td>
              </tr>
            ) : paginatedData.length === 0 ? (
              /* Empty State */
              <tr>
                <td
                  colSpan={columns.length + (selectable ? 1 : 0)}
                  className="py-12 text-center text-slate-500"
                >
                  <div className="flex flex-col items-center justify-center gap-2">
                    {emptyIcon || <Inbox size={32} className="text-slate-300" />}
                    <span className="text-sm font-medium text-slate-500">{emptyMessage}</span>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedData.map((row, index) => {
                const key = getRowKey(row, index);
                const isSelected = selectedKeys.includes(key);

                return (
                  <tr
                    key={key}
                    onClick={() => onRowClick?.(row, index)}
                    className={`
                      transition-colors
                      ${hoverable ? 'hover:bg-slate-50/80' : ''}
                      ${striped && index % 2 === 1 ? 'bg-slate-50/30' : 'bg-white'}
                      ${isSelected ? 'bg-indigo-50/40 hover:bg-indigo-50/70' : ''}
                      ${onRowClick ? 'cursor-pointer' : ''}
                    `}
                  >
                    {/* Selectable Checkbox */}
                    {selectable && (
                      <td className={`px-4 ${compact ? 'py-2' : 'py-3.5'}`}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={e => handleSelectRow(e, row, index)}
                          onClick={e => e.stopPropagation()}
                          aria-label={`Select row ${index + 1}`}
                          className="w-4 h-4 rounded-sm border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                      </td>
                    )}

                    {/* Cells */}
                    {columns.map(col => {
                      const value = getCellValue(row, col);
                      const alignClass =
                        col.align === 'center'
                          ? 'text-center'
                          : col.align === 'right'
                          ? 'text-right'
                          : 'text-left';

                      return (
                        <td
                          key={col.key}
                          className={`
                            ${alignClass}
                            ${compact ? 'py-2 px-3' : 'py-3.5 px-4'}
                            ${col.className || ''}
                          `}
                        >
                          {col.render ? col.render(value, row, index) : value ?? '—'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 3. Pagination Footer Bar */}
      {pagination && !loading && totalItems > 0 && (
        <div className="p-3 sm:px-5 border-t border-slate-200/80 bg-slate-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-500">
          {/* Summary & Page Size Selector */}
          <div className="flex items-center gap-3">
            <span>
              Showing{' '}
              <strong className="text-slate-700">
                {(currentPage - 1) * pageSize + 1}
              </strong>{' '}
              to{' '}
              <strong className="text-slate-700">
                {Math.min(currentPage * pageSize, totalItems)}
              </strong>{' '}
              of <strong className="text-slate-700">{totalItems}</strong> entries
            </span>

            {pageSizeOptions.length > 0 && (
              <div className="flex items-center gap-1.5 ml-2">
                <span>Per page:</span>
                <select
                  value={pageSize}
                  onChange={e => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                >
                  {pageSizeOptions.map(opt => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Navigation Controls */}
          <div className="flex items-center gap-1 ml-auto">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none transition-colors text-slate-600"
              title="Previous page"
              aria-label="Previous page"
            >
              <ChevronLeft size={15} />
            </button>

            {/* Page number indicators */}
            <div className="flex items-center gap-1 px-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(page => {
                  return (
                    page === 1 ||
                    page === totalPages ||
                    Math.abs(page - currentPage) <= 1
                  );
                })
                .map((page, idx, arr) => {
                  const prevPage = arr[idx - 1];
                  const showEllipsis = prevPage && page - prevPage > 1;

                  return (
                    <React.Fragment key={page}>
                      {showEllipsis && (
                        <span className="px-1 text-slate-400">...</span>
                      )}
                      <button
                        type="button"
                        onClick={() => setCurrentPage(page)}
                        className={`min-w-[28px] h-7 px-2 rounded-lg font-medium text-xs transition-colors ${
                          currentPage === page
                            ? 'bg-indigo-600 text-white font-bold shadow-2xs'
                            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {page}
                      </button>
                    </React.Fragment>
                  );
                })}
            </div>

            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none transition-colors text-slate-600"
              title="Next page"
              aria-label="Next page"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Table;
