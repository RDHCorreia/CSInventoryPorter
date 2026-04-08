// ============================================================
// CSInventoryPorter — Investments Page
// Track item purchases: cost basis, current value & profit/loss
// ============================================================

import { useState, useMemo, useCallback, useEffect, useContext } from 'react';
import type { useAuth } from '../hooks/useAuth';
import { useInventory } from '../hooks/useInventory';
import { usePricing } from '../hooks/usePricing';
import { useInvestments } from '../hooks/useInvestments';
import type { InventoryItem, InvestmentEntry, InvestmentSummary } from '../../shared/types';
import { CurrencyContext } from '../App';
import NavBar from '../components/NavBar';
import { type AppPage, getWearCondition, getMarketHashName } from '../utils/itemUtils';

interface Props {
  auth: ReturnType<typeof useAuth>;
  onNavigate: (page: AppPage) => void;
}

// ---- Unique inventory item groups for the picker ----

interface ItemOption {
  marketHashName: string;
  displayName: string;
  imageUrl?: string;
  rarityColor?: string;
  count: number;
}

/**
 * Build item options.
 *
 * Characteristics:
 * - @param items - The parameter for items
 * - @returns ItemOption[]
 *
 */
function buildItemOptions(items: InventoryItem[]): ItemOption[] {
  const map = new Map<string, ItemOption>();
  for (const item of items) {
    const mhn = getMarketHashName(item);
    if (!mhn) continue;
    const existing = map.get(mhn);
    if (existing) {
      existing.count++;
    } else {
      map.set(mhn, {
        marketHashName: mhn,
        displayName: item.market_name ?? mhn,
        imageUrl: item.image_url,
        rarityColor: item.rarity_color,
        count: 1,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// ---- Component ----

/**
 * Investments page.
 *
 * Characteristics:
 * - @param { auth, onNavigate } - The parameter for { auth, onNavigate }
 * - @returns React.JSX.Element
 *
 */
export default function InvestmentsPage({ auth, onNavigate }: Props) {
  const { status, logout } = auth;
  const { state: invState, items, storageUnits } = useInventory();
  const { portfolioData, fetchPrices, loadPortfolioData } = usePricing();
  const { entries, loading, addEntry, removeEntry, buildSummaries, loadEntries } = useInvestments();
  const { formatPrice, symbol, currency, currencyVersion } = useContext(CurrencyContext);

  // ---- Exchange rates for currency conversion ----
  const [exchangeRates, setExchangeRates] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    const api = (window as any).csinventoryporter;
    if (api?.getExchangeRates) {
      api.getExchangeRates().then((result: any) => {
        if (result.success && result.rates?.rates) {
          setExchangeRates(result.rates.rates);
        }
      }).catch(() => { });
    }
  }, [currencyVersion]);

  // ---- Add form state ----
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<ItemOption | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  // ---- Edit state ----
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQuantity, setEditQuantity] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editDate, setEditDate] = useState('');

  // ---- Sort state ----
  const [sortBy, setSortBy] = useState<'profit' | 'totalCost' | 'name' | 'date'>('date');

  // ---- Confirm delete ----
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Reload portfolio data when currency changes
  useEffect(() => {
    if (currencyVersion > 0) loadPortfolioData();
  }, [currencyVersion]);

  // Build all inventory items (including caskets)
  const allItems = useMemo(() => {
    const result = [...items.filter((i) => !i.is_storage_unit)];
    for (const unit of storageUnits) {
      if (unit.items?.length) result.push(...unit.items);
    }
    return result;
  }, [items, storageUnits]);

  // Item options for the picker
  const itemOptions = useMemo(() => buildItemOptions(allItems), [allItems]);

  // Filtered options based on search query
  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return itemOptions.slice(0, 50);
    const q = searchQuery.toLowerCase();
    return itemOptions.filter((o) => o.displayName.toLowerCase().includes(q) || o.marketHashName.toLowerCase().includes(q)).slice(0, 50);
  }, [itemOptions, searchQuery]);

  // Investment summaries with current prices
  const summaries = useMemo<InvestmentSummary[]>(() => {
    const raw = buildSummaries(portfolioData?.itemPrices ?? null, currency, exchangeRates);
    // Sort
    switch (sortBy) {
      case 'profit': return raw.sort((a, b) => b.profit - a.profit);
      case 'totalCost': return raw.sort((a, b) => b.totalCost - a.totalCost);
      case 'name': return raw.sort((a, b) => a.entry.displayName.localeCompare(b.entry.displayName));
      case 'date': return raw.sort((a, b) => b.entry.createdAt - a.entry.createdAt);
      default: return raw;
    }
  }, [buildSummaries, portfolioData, sortBy, currency, exchangeRates]);

  // Portfolio totals
  const totals = useMemo(() => {
    let totalInvested = 0;
    let totalCurrentValue = 0;
    for (const s of summaries) {
      totalInvested += s.totalCost;
      totalCurrentValue += s.currentValue;
    }
    const totalProfit = totalCurrentValue - totalInvested;
    const totalProfitPercent = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
    return { totalInvested, totalCurrentValue, totalProfit, totalProfitPercent };
  }, [summaries]);

  // ---- Handlers ----

  const handleSelectItem = useCallback((item: ItemOption) => {
    setSelectedItem(item);
    setSearchQuery(item.displayName);
    setShowDropdown(false);
  }, []);

  const handleAddInvestment = useCallback(async () => {
    if (!selectedItem) return;
    const qty = parseInt(quantity, 10);
    const price = parseFloat(purchasePrice);
    if (isNaN(qty) || qty <= 0 || isNaN(price) || price < 0) return;

    await addEntry({
      marketHashName: selectedItem.marketHashName,
      displayName: selectedItem.displayName,
      imageUrl: selectedItem.imageUrl,
      rarityColor: selectedItem.rarityColor,
      quantity: qty,
      purchasePrice: price,
      purchaseDate,
      currency,  // Save the active currency at time of purchase
      notes: notes.trim() || undefined,
    });

    // Reset form
    setSelectedItem(null);
    setSearchQuery('');
    setQuantity('1');
    setPurchasePrice('');
    setPurchaseDate(new Date().toISOString().split('T')[0]);
    setNotes('');
    setShowAddForm(false);
  }, [selectedItem, quantity, purchasePrice, purchaseDate, notes, addEntry]);

  const handleDelete = useCallback(async (id: string) => {
    await removeEntry(id);
    setDeletingId(null);
  }, [removeEntry]);

  const handleStartEdit = useCallback((entry: InvestmentEntry) => {
    setEditingId(entry.id);
    setEditQuantity(String(entry.quantity));
    setEditPrice(String(entry.purchasePrice));
    setEditDate(entry.purchaseDate);
  }, []);

  const handleSaveEdit = useCallback(async (id: string) => {
    const qty = parseInt(editQuantity, 10);
    const price = parseFloat(editPrice);
    if (isNaN(qty) || qty <= 0 || isNaN(price) || price < 0) return;

    const api = (window as any).csinventoryporter;
    const result = await api.updateInvestment(id, {
      quantity: qty,
      purchasePrice: price,
      purchaseDate: editDate,
    });
    if (result.success) {
      await loadEntries();
    }
    setEditingId(null);
  }, [editQuantity, editPrice, editDate, loadEntries]);

  const isGCConnected = status.state === 'gcConnected';
  const isInventoryLoaded = invState === 'loaded';

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      {/* Top bar */}
      <NavBar activePage="investments" onNavigate={onNavigate} status={status} onLogout={logout} />

      {/* Content */}
      <main className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        <div className="p-6 space-y-6">
          {/* ---- Summary cards ---- */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4">
              <p className="text-xs text-slate-400 mb-1">Total Invested</p>
              <p className="text-xl font-bold text-slate-100">{formatPrice(totals.totalInvested)}</p>
            </div>
            <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4">
              <p className="text-xs text-slate-400 mb-1">Current Value</p>
              <p className="text-xl font-bold text-slate-100">{formatPrice(totals.totalCurrentValue)}</p>
            </div>
            <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4">
              <p className="text-xs text-slate-400 mb-1">Total Profit</p>
              <p className={`text-xl font-bold ${totals.totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {totals.totalProfit >= 0 ? '+' : ''}{formatPrice(totals.totalProfit)}
              </p>
            </div>
            <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4">
              <p className="text-xs text-slate-400 mb-1">ROI</p>
              <p className={`text-xl font-bold ${totals.totalProfitPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {totals.totalProfitPercent >= 0 ? '+' : ''}{totals.totalProfitPercent.toFixed(1)}%
              </p>
            </div>
          </div>

          {/* ---- Add Investment button / form ---- */}
          {!showAddForm ? (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowAddForm(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Investment
              </button>
              <button
                onClick={fetchPrices}
                className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh Prices
              </button>
              <span className="text-xs text-slate-500">{summaries.length} investment{summaries.length !== 1 ? 's' : ''} tracked</span>
            </div>
          ) : (
            <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-slate-200">Add Investment</h2>
                <button
                  onClick={() => { setShowAddForm(false); setSelectedItem(null); setSearchQuery(''); }}
                  className="text-slate-400 hover:text-slate-200 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="grid grid-cols-[1fr_120px_160px_160px] gap-4 items-end">
                {/* Item Picker */}
                <div className="relative">
                  <label className="block text-xs text-slate-400 mb-1">Item</label>
                  <input
                    type="text"
                    placeholder="Search items from inventory..."
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setShowDropdown(true); setSelectedItem(null); }}
                    onFocus={() => setShowDropdown(true)}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-blue-500 transition-colors"
                  />
                  {showDropdown && filteredOptions.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-slate-800 border border-slate-600 rounded-lg shadow-xl">
                      {filteredOptions.map((opt) => (
                        <button
                          key={opt.marketHashName}
                          onClick={() => handleSelectItem(opt)}
                          className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-700 transition-colors text-left"
                        >
                          <div className="w-8 h-8 bg-slate-700/50 rounded flex items-center justify-center shrink-0 overflow-hidden">
                            {opt.imageUrl ? (
                              <img src={opt.imageUrl} alt="" className="max-w-full max-h-full object-contain" loading="lazy" />
                            ) : (
                              <div className="w-4 h-4 bg-slate-600 rounded" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-slate-200 truncate">{opt.displayName}</p>
                            <p className="text-[10px] text-slate-500 truncate">{opt.marketHashName}</p>
                          </div>
                          {opt.rarityColor && (
                            <div className="w-1.5 h-4 rounded-full shrink-0" style={{ backgroundColor: opt.rarityColor }} />
                          )}
                          <span className="text-xs text-slate-500 shrink-0">x{opt.count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Quantity */}
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Quantity</label>
                  <input
                    type="number"
                    min="1"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 outline-none focus:border-blue-500 transition-colors"
                  />
                </div>

                {/* Purchase Price */}
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Price per item ({symbol})</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={purchasePrice}
                    onChange={(e) => setPurchasePrice(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 outline-none focus:border-blue-500 transition-colors"
                  />
                </div>

                {/* Purchase Date */}
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Purchase Date</label>
                  <input
                    type="date"
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 outline-none focus:border-blue-500 transition-colors [color-scheme:dark]"
                  />
                </div>
              </div>

              {/* Notes + Save button */}
              <div className="flex items-end gap-4 mt-4">
                <div className="flex-1">
                  <label className="block text-xs text-slate-400 mb-1">Notes (optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Bought during major sale"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-blue-500 transition-colors"
                  />
                </div>

                {/* Selected item preview */}
                {selectedItem && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-slate-700/50 rounded-lg shrink-0">
                    {selectedItem.imageUrl && (
                      <img src={selectedItem.imageUrl} alt="" className="w-6 h-6 object-contain" />
                    )}
                    <span className="text-xs text-slate-300 max-w-[150px] truncate">{selectedItem.displayName}</span>
                    {purchasePrice && quantity && (
                      <span className="text-xs text-slate-500">
                        = {formatPrice(parseFloat(purchasePrice) * parseInt(quantity || '0', 10))}
                      </span>
                    )}
                  </div>
                )}

                <button
                  onClick={handleAddInvestment}
                  disabled={!selectedItem || !purchasePrice || !quantity}
                  className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-lg transition-colors shrink-0"
                >
                  Save
                </button>
              </div>
            </div>
          )}

          {/* ---- Investments Table ---- */}
          <div className="bg-slate-800/50 rounded-xl border border-slate-700">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
              <h2 className="text-lg font-semibold text-slate-200">Investment Tracker</h2>
              <div className="flex items-center gap-2">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-300 outline-none"
                >
                  <option value="date">Sort by Date</option>
                  <option value="profit">Sort by Profit</option>
                  <option value="totalCost">Sort by Total Cost</option>
                  <option value="name">Sort by Name</option>
                </select>
              </div>
            </div>

            {/* Table header */}
            <div className="grid grid-cols-[1fr_60px_90px_90px_90px_100px_90px_80px] gap-3 px-6 py-2 text-xs font-medium text-slate-500 uppercase tracking-wider border-b border-slate-700/50">
              <span>Item</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Buy Price</span>
              <span className="text-right">Total Cost</span>
              <span className="text-right">Cur. Price</span>
              <span className="text-right">Cur. Value</span>
              <span className="text-right">Profit</span>
              <span className="text-right">Actions</span>
            </div>

            {/* Table rows */}
            <div className="max-h-[500px] overflow-y-auto">
              {summaries.length === 0 ? (
                <div className="px-6 py-12 text-center text-slate-500">
                  <svg className="w-12 h-12 mx-auto mb-3 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  <p className="text-sm">No investments tracked yet</p>
                  <p className="text-xs text-slate-600 mt-1">Click "Add Investment" to start tracking your purchases</p>
                </div>
              ) : (
                summaries.map((s) => {
                  const isEditing = editingId === s.entry.id;
                  const isDeleting = deletingId === s.entry.id;

                  return (
                    <div
                      key={s.entry.id}
                      className="grid grid-cols-[1fr_60px_90px_90px_90px_100px_90px_80px] gap-3 px-6 py-2.5 border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors items-center"
                    >
                      {/* Item name + image */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 bg-slate-700/50 rounded flex items-center justify-center shrink-0 overflow-hidden">
                          {s.entry.imageUrl ? (
                            <img src={s.entry.imageUrl} alt="" className="max-w-full max-h-full object-contain" loading="lazy" />
                          ) : (
                            <div className="w-4 h-4 bg-slate-600 rounded" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm text-slate-200 truncate">{s.entry.displayName}</p>
                          <div className="flex items-center gap-2">
                            <p className="text-[10px] text-slate-500">{s.entry.purchaseDate}</p>
                            {s.entry.notes && (
                              <p className="text-[10px] text-slate-600 truncate max-w-[120px]" title={s.entry.notes}>
                                {s.entry.notes}
                              </p>
                            )}
                          </div>
                        </div>
                        {s.entry.rarityColor && (
                          <div className="w-1.5 h-4 rounded-full shrink-0" style={{ backgroundColor: s.entry.rarityColor }} />
                        )}
                      </div>

                      {/* Quantity */}
                      {isEditing ? (
                        <input
                          type="number"
                          min="1"
                          value={editQuantity}
                          onChange={(e) => setEditQuantity(e.target.value)}
                          className="w-full px-1 py-0.5 bg-slate-700 border border-blue-500 rounded text-xs text-slate-200 text-right outline-none"
                        />
                      ) : (
                        <span className="text-sm text-slate-400 text-right">{s.entry.quantity}</span>
                      )}

                      {/* Buy price */}
                      {isEditing ? (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          className="w-full px-1 py-0.5 bg-slate-700 border border-blue-500 rounded text-xs text-slate-200 text-right outline-none"
                        />
                      ) : (
                        <span className="text-sm text-slate-300 text-right">{formatPrice(s.entry.purchasePrice)}</span>
                      )}

                      {/* Total cost */}
                      <span className="text-sm text-slate-300 text-right">{formatPrice(s.totalCost)}</span>

                      {/* Current price */}
                      <span className="text-sm text-slate-300 text-right">
                        {s.currentPrice > 0 ? formatPrice(s.currentPrice) : <span className="text-slate-500">—</span>}
                      </span>

                      {/* Current value */}
                      <span className="text-sm text-slate-200 text-right font-medium">
                        {s.currentPrice > 0 ? formatPrice(s.currentValue) : <span className="text-slate-500">—</span>}
                      </span>

                      {/* Profit */}
                      <div className="text-right">
                        {s.currentPrice > 0 ? (
                          <>
                            <p className={`text-sm font-medium ${s.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {s.profit >= 0 ? '+' : ''}{formatPrice(s.profit)}
                            </p>
                            <p className={`text-[10px] ${s.profitPercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {s.profitPercent >= 0 ? '+' : ''}{s.profitPercent.toFixed(1)}%
                            </p>
                          </>
                        ) : (
                          <span className="text-sm text-slate-500">—</span>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-end gap-1">
                        {isEditing ? (
                          <>
                            <button
                              onClick={() => handleSaveEdit(s.entry.id)}
                              className="p-1 text-green-400 hover:text-green-300 transition-colors"
                              title="Save"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
                              title="Cancel"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </>
                        ) : isDeleting ? (
                          <>
                            <button
                              onClick={() => handleDelete(s.entry.id)}
                              className="p-1 text-red-400 hover:text-red-300 transition-colors"
                              title="Confirm delete"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            </button>
                            <button
                              onClick={() => setDeletingId(null)}
                              className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
                              title="Cancel"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleStartEdit(s.entry)}
                              className="p-1 text-slate-400 hover:text-blue-400 transition-colors"
                              title="Edit"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => setDeletingId(s.entry.id)}
                              className="p-1 text-slate-400 hover:text-red-400 transition-colors"
                              title="Delete"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Table footer — totals */}
            {summaries.length > 0 && (
              <div className="grid grid-cols-[1fr_60px_90px_90px_90px_100px_90px_80px] gap-3 px-6 py-3 border-t border-slate-600 bg-slate-800/80">
                <span className="text-sm font-semibold text-slate-300">Totals</span>
                <span className="text-sm font-medium text-slate-300 text-right">
                  {summaries.reduce((sum, s) => sum + s.entry.quantity, 0)}
                </span>
                <span />
                <span className="text-sm font-medium text-slate-200 text-right">
                  {formatPrice(totals.totalInvested)}
                </span>
                <span />
                <span className="text-sm font-bold text-slate-100 text-right">
                  {formatPrice(totals.totalCurrentValue)}
                </span>
                <div className="text-right">
                  <p className={`text-sm font-bold ${totals.totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {totals.totalProfit >= 0 ? '+' : ''}{formatPrice(totals.totalProfit)}
                  </p>
                  <p className={`text-[10px] ${totals.totalProfitPercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {totals.totalProfitPercent >= 0 ? '+' : ''}{totals.totalProfitPercent.toFixed(1)}%
                  </p>
                </div>
                <span />
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
