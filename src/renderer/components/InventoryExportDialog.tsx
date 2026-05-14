import { useMemo, useState } from 'react';
import type {
  InventoryExportColumn,
  InventoryExportItemType,
  InventoryExportOptions,
  InventoryExportScope,
} from '../../shared/types';

export const EXPORT_COLUMNS: Array<{ id: InventoryExportColumn; label: string; price?: boolean }> = [
  { id: 'accountName', label: 'Account' },
  { id: 'itemName', label: 'Item Name' },
  { id: 'quantity', label: 'Quantity' },
  { id: 'storageUnitName', label: 'Storage Unit' },
  { id: 'wear', label: 'Float' },
  { id: 'paintIndex', label: 'Paint Index' },
  { id: 'price', label: 'Price', price: true },
  { id: 'totalPrice', label: 'Total Price', price: true },
];

const DEFAULT_COLUMNS: InventoryExportColumn[] = [
  'accountName',
  'itemName',
  'quantity',
  'price',
  'totalPrice',
];

const ITEM_TYPE_FILTERS: Array<{ id: InventoryExportItemType; label: string }> = [
  { id: 'weapon', label: 'Weapons' },
  { id: 'case', label: 'Cases' },
  { id: 'sticker', label: 'Stickers' },
  { id: 'graffiti', label: 'Graffiti' },
  { id: 'charm', label: 'Charms' },
  { id: 'agent', label: 'Agents' },
  { id: 'container', label: 'Storage Units' },
  { id: 'music', label: 'Music' },
  { id: 'tool', label: 'Tools' },
  { id: 'collectible', label: 'Collectibles' },
  { id: 'other', label: 'Other' },
];

interface Props {
  open: boolean;
  title: string;
  scope: InventoryExportScope;
  steamID?: string;
  onClose: () => void;
  onExport: (options: InventoryExportOptions) => Promise<void>;
}

export default function InventoryExportDialog({ open, title, scope, steamID, onClose, onExport }: Props) {
  const [exportName, setExportName] = useState('');
  const [includePrices, setIncludePrices] = useState(true);
  const [selectedColumns, setSelectedColumns] = useState<Set<InventoryExportColumn>>(() => new Set(DEFAULT_COLUMNS));
  const [selectedItemTypes, setSelectedItemTypes] = useState<Set<InventoryExportItemType>>(
    () => new Set(ITEM_TYPE_FILTERS.map((filter) => filter.id)),
  );
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleColumns = useMemo(
    () => EXPORT_COLUMNS.filter((column) => includePrices || !column.price),
    [includePrices],
  );

  if (!open) return null;

  const toggleColumn = (column: InventoryExportColumn) => {
    setSelectedColumns((current) => {
      const next = new Set(current);
      if (next.has(column)) next.delete(column);
      else next.add(column);
      return next;
    });
  };

  const toggleItemType = (itemType: InventoryExportItemType) => {
    setSelectedItemTypes((current) => {
      const next = new Set(current);
      if (next.has(itemType)) next.delete(itemType);
      else next.add(itemType);
      return next;
    });
  };

  const handleExport = async () => {
    const columns = [...selectedColumns].filter((column) => includePrices || !EXPORT_COLUMNS.find((c) => c.id === column)?.price);
    if (columns.length === 0) {
      setError('Pick at least one column.');
      return;
    }
    if (selectedItemTypes.size === 0) {
      setError('Pick at least one item filter.');
      return;
    }

    setIsExporting(true);
    setError(null);
    try {
      await onExport({
        scope,
        steamID,
        exportName: exportName.trim() || undefined,
        format: 'csv',
        includePrices,
        columns,
        itemTypes: [...selectedItemTypes],
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
            <p className="text-xs text-slate-500">Choose the name, filters, price fields, and columns to save as CSV.</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 p-1" title="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2" htmlFor="inventory-export-name">
              Export name
            </label>
            <input
              id="inventory-export-name"
              value={exportName}
              onChange={(event) => setExportName(event.target.value)}
              placeholder="Use default file name"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500"
              maxLength={80}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={includePrices}
                onChange={(event) => setIncludePrices(event.target.checked)}
                className="accent-blue-600"
              />
              Include prices
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-slate-300">Item filters</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedItemTypes(new Set(['case']))}
                  className="text-xs text-slate-400 hover:text-slate-300"
                >
                  Cases
                </button>
                <button
                  onClick={() => setSelectedItemTypes(new Set(['weapon']))}
                  className="text-xs text-slate-400 hover:text-slate-300"
                >
                  Weapons
                </button>
                <button
                  onClick={() => setSelectedItemTypes(new Set(ITEM_TYPE_FILTERS.map((filter) => filter.id)))}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  All
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {ITEM_TYPE_FILTERS.map((filter) => (
                <label
                  key={filter.id}
                  className="flex items-center gap-2 text-xs text-slate-300 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 cursor-pointer hover:border-slate-600"
                >
                  <input
                    type="checkbox"
                    checked={selectedItemTypes.has(filter.id)}
                    onChange={() => toggleItemType(filter.id)}
                    className="accent-blue-600"
                  />
                  <span className="truncate">{filter.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-slate-300">Columns</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedColumns(new Set(visibleColumns.map((column) => column.id)))}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Select all
                </button>
                <button
                  onClick={() => setSelectedColumns(new Set(DEFAULT_COLUMNS.filter((column) => includePrices || !EXPORT_COLUMNS.find((c) => c.id === column)?.price)))}
                  className="text-xs text-slate-400 hover:text-slate-300"
                >
                  Defaults
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {visibleColumns.map((column) => (
                <label
                  key={column.id}
                  className="flex items-center gap-2 text-xs text-slate-300 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 cursor-pointer hover:border-slate-600"
                >
                  <input
                    type="checkbox"
                    checked={selectedColumns.has(column.id)}
                    onChange={() => toggleColumn(column.id)}
                    className="accent-blue-600"
                  />
                  <span className="truncate">{column.label}</span>
                </label>
              ))}
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-700 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 7H7a2 2 0 01-2-2V5a2 2 0 012-2h5l5 5v10a2 2 0 01-2 2z" />
            </svg>
            {isExporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
