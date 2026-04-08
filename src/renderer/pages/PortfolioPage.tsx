// ============================================================
// CSInventoryPorter — Portfolio Page
// Shows inventory value history chart + item price breakdown
// ============================================================

import { useState, useEffect, useMemo, useCallback, useContext } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { useAuth } from '../hooks/useAuth';
import { useInventory } from '../hooks/useInventory';
import { usePricing } from '../hooks/usePricing';
import type { InventoryItem, StorageUnit, PortfolioSnapshot, ItemPriceData, SkinportPriceData } from '../../shared/types';
import { CurrencyContext } from '../App';
import NavBar from '../components/NavBar';
import { type AppPage, type TimeRange, TIME_RANGE_LABELS, TIME_RANGE_MS, getWearCondition, getMarketHashName } from '../utils/itemUtils';

interface Props {
  auth: ReturnType<typeof useAuth>;
  onNavigate: (page: AppPage) => void;
}

// ---- Custom tooltip ----

/**
 * Chart tooltip.
 *
 * Characteristics:
 * - @param { active, payload, label, formatPrice } - The parameter for { active, payload, label, formatPrice }
 * - @returns React.JSX.Element
 *
 */
function ChartTooltip({ active, payload, label, formatPrice }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs text-slate-400">{new Date(label).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
      <p className="text-sm font-bold text-green-400">{formatPrice(payload[0].value)}</p>
    </div>
  );
}

// ---- Value change helpers ----

/**
 * Compute change.
 *
 * Characteristics:
 * - @param history - The parameter for history
 * - @param rangeMs - The parameter for rangeMs
 * - @returns { amount: number; percent: number; }
 *
 */
function computeChange(history: PortfolioSnapshot[], rangeMs: number): { amount: number; percent: number } {
  if (history.length < 2) return { amount: 0, percent: 0 };
  const now = history[history.length - 1];
  const cutoff = now.time - rangeMs;
  const earlier = history.find((s) => s.time >= cutoff) ?? history[0];
  const amount = now.value - earlier.value;
  const percent = earlier.value > 0 ? (amount / earlier.value) * 100 : 0;
  return { amount: Math.round(amount * 100) / 100, percent: Math.round(percent * 100) / 100 };
}

// ---- Component ----

/**
 * Portfolio page.
 *
 * Characteristics:
 * - @param { auth, onNavigate } - The parameter for { auth, onNavigate }
 * - @returns React.JSX.Element
 *
 */
export default function PortfolioPage({ auth, onNavigate }: Props) {
  const { status, logout } = auth;
  const { state, items, storageUnits } = useInventory();
  const { pricingProgress, portfolioData, fetchPrices, cancelFetch, loadPortfolioData } = usePricing();

  const [timeRange, setTimeRange] = useState<TimeRange>('30d');
  const [sortBy, setSortBy] = useState<'value' | 'name' | 'price'>('value');
  const [autoFetched, setAutoFetched] = useState(false);
  const { currency, symbol, formatPrice, currencyVersion } = useContext(CurrencyContext);

  // Load portfolio data on mount
  useEffect(() => {
    loadPortfolioData();
  }, [loadPortfolioData]);

  // Reload portfolio data when currency changes
  useEffect(() => {
    if (currencyVersion > 0) {
      loadPortfolioData();
    }
  }, [currencyVersion]);

  // Auto-fetch prices when inventory is loaded (once)
  useEffect(() => {
    if (state === 'loaded' && !autoFetched && items.length > 0) {
      setAutoFetched(true);
      // Small delay to let UI settle, then load cached data
      // If no cached value, auto-start fetching (includes auto-loading caskets)
      const timer = setTimeout(async () => {
        const data = await (window as any).csinventoryporter.getPortfolioData();
        if (!data?.totalValue) {
          fetchPrices();
        } else {
          loadPortfolioData();
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [state, autoFetched, items.length]);

  // ---- Build item price table ----

  const allItems = useMemo(() => {
    const result = [...items.filter((i) => !i.is_storage_unit)];
    for (const unit of storageUnits) {
      if (unit.items?.length) result.push(...unit.items);
    }
    return result;
  }, [items, storageUnits]);

  // Group items by market hash name with totals
  const itemRows = useMemo(() => {
    if (!portfolioData?.itemPrices) return [];

    const groups = new Map<string, {
      name: string;
      marketHashName: string;
      count: number;
      steamPrice: number;      // -1 = not listed on Steam
      skinport?: SkinportPriceData;
      effectiveUnitPrice: number; // Steam if available, else Skinport min
      totalPrice: number;
      priceData: ItemPriceData | null;
      imageUrl?: string;
      rarityColor?: string;
    }>();

    for (const item of allItems) {
      const mhn = getMarketHashName(item);
      if (!mhn) continue;

      const existing = groups.get(mhn);
      const priceData = portfolioData.itemPrices[mhn] ?? null;
      const steamPrice = priceData?.currentPrice ?? 0;
      const skinport = priceData?.skinport;
      const effectiveUnitPrice = steamPrice === -1
        ? (skinport?.minPrice ?? 0)
        : Math.max(0, steamPrice);

      if (existing) {
        existing.count++;
        existing.totalPrice = existing.count * effectiveUnitPrice;
      } else {
        groups.set(mhn, {
          name: item.market_name ?? mhn,
          marketHashName: mhn,
          count: 1,
          steamPrice,
          skinport,
          effectiveUnitPrice,
          totalPrice: effectiveUnitPrice,
          priceData,
          imageUrl: item.image_url,
          rarityColor: item.rarity_color,
        });
      }
    }

    const rows = [...groups.values()];

    // Sort
    if (sortBy === 'value') rows.sort((a, b) => b.totalPrice - a.totalPrice);
    else if (sortBy === 'price') rows.sort((a, b) => b.effectiveUnitPrice - a.effectiveUnitPrice);
    else rows.sort((a, b) => a.name.localeCompare(b.name));

    return rows;
  }, [allItems, portfolioData, sortBy]);

  // ---- Chart data ----

  const chartData = useMemo(() => {
    if (!portfolioData?.portfolioHistory?.length) return [];
    const history = portfolioData.portfolioHistory;
    const cutoffMs = TIME_RANGE_MS[timeRange];
    if (cutoffMs === Infinity) return history;
    const cutoff = Date.now() - cutoffMs;
    return history.filter((s) => s.time >= cutoff);
  }, [portfolioData, timeRange]);

  const change = useMemo(() => {
    if (!portfolioData?.portfolioHistory?.length) return { amount: 0, percent: 0 };
    return computeChange(portfolioData.portfolioHistory, TIME_RANGE_MS[timeRange]);
  }, [portfolioData, timeRange]);

  const totalValue = portfolioData?.totalValue ?? 0;
  const isFetching = pricingProgress?.state === 'loading';
  const isGCConnected = status.state === 'gcConnected';
  const isInventoryLoaded = state === 'loaded';

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      {/* Blocking loading overlay — forces user to wait until inventory is loaded */}
      {(state === 'loading' || state === 'idle') && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm">
          <div className="text-center space-y-4">
            <svg className="animate-spin h-10 w-10 mx-auto text-blue-400" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-slate-300 text-sm font-medium">
              {state === 'idle' ? 'Waiting for Game Coordinator...' : 'Loading inventory...'}
            </p>
            <p className="text-slate-500 text-xs">This may take a moment</p>
          </div>
        </div>
      )}

      <NavBar activePage="portfolio" onNavigate={onNavigate} status={status} onLogout={logout} />

      {/* Content */}
      <main className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        {/* Waiting for GC */}
        {!isGCConnected && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-4">
              <div className="w-20 h-20 mx-auto rounded-full bg-blue-500/20 flex items-center justify-center">
                <svg className="w-10 h-10 text-blue-400 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
              <p className="text-slate-400">Connecting to CS2 Game Coordinator...</p>
            </div>
          </div>
        )}

        {/* Inventory loading */}
        {isGCConnected && !isInventoryLoaded && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-4">
              <div className="w-20 h-20 mx-auto rounded-full bg-blue-500/20 flex items-center justify-center">
                <svg className="w-10 h-10 text-blue-400 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
              <p className="text-slate-400">Loading inventory...</p>
            </div>
          </div>
        )}

        {/* Portfolio content */}
        {isGCConnected && isInventoryLoaded && (
          <div className="p-6 space-y-6">
            {/* ---- Value overview card ---- */}
            <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <p className="text-sm text-slate-400 mb-1">Total Portfolio Value</p>
                  <p className="text-4xl font-bold text-slate-100">
                    {formatPrice(totalValue)}
                  </p>
                  {change.amount !== 0 && (
                    <p className={`text-sm mt-1 ${change.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {change.amount >= 0 ? '+' : ''}{symbol}{Math.abs(change.amount).toFixed(2)} ({change.percent >= 0 ? '+' : ''}{change.percent.toFixed(1)}%)
                      <span className="text-slate-500 ml-1">{TIME_RANGE_LABELS[timeRange]}</span>
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {/* Refresh button */}
                  <button
                    onClick={fetchPrices}
                    disabled={isFetching}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors disabled:opacity-50"
                  >
                    <svg className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    {isFetching ? 'Fetching...' : 'Refresh Prices'}
                  </button>
                  {isFetching && (
                    <button
                      onClick={cancelFetch}
                      className="px-3 py-1.5 text-sm rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>

              {/* Pricing progress */}
              {isFetching && pricingProgress && (
                <div className="mb-4">
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                    <span>
                      Fetching prices... {pricingProgress.current}/{pricingProgress.total}
                    </span>
                    {pricingProgress.currentItem && (
                      <span className="text-slate-500 truncate ml-2 max-w-xs">
                        {pricingProgress.currentItem}
                      </span>
                    )}
                  </div>
                  <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-300"
                      style={{ width: `${pricingProgress.total > 0 ? (pricingProgress.current / pricingProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Time range selector */}
              <div className="flex items-center gap-1 mb-4">
                {(Object.keys(TIME_RANGE_LABELS) as TimeRange[]).map((range) => (
                  <button
                    key={range}
                    onClick={() => setTimeRange(range)}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${timeRange === range
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                      }`}
                  >
                    {TIME_RANGE_LABELS[range]}
                  </button>
                ))}
              </div>

              {/* Chart */}
              {chartData.length > 0 ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 10, bottom: 5 }}>
                      <defs>
                        <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis
                        dataKey="time"
                        type="number"
                        domain={['auto', 'auto']}
                        tickFormatter={(t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        stroke="#64748b"
                        fontSize={11}
                        tickLine={false}
                      />
                      <YAxis
                        tickFormatter={(v) => `${symbol}${v.toFixed(0)}`}
                        stroke="#64748b"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        width={60}
                      />
                      <Tooltip content={<ChartTooltip formatPrice={formatPrice} />} />
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        fill="url(#portfolioGradient)"
                        dot={false}
                        activeDot={{ r: 4, fill: '#3b82f6', stroke: '#1e293b', strokeWidth: 2 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-slate-500">
                  {isFetching
                    ? 'Fetching price data...'
                    : totalValue === 0
                      ? (
                        <div className="text-center space-y-3">
                          <svg className="w-12 h-12 mx-auto text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                          </svg>
                          <p>No price data available yet</p>
                          <button
                            onClick={fetchPrices}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
                          >
                            Fetch Prices
                          </button>
                        </div>
                      )
                      : 'No chart data for this time range'}
                </div>
              )}
            </div>

            {/* ---- Item breakdown table ---- */}
            <div className="bg-slate-800/50 rounded-xl border border-slate-700">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
                <h2 className="text-lg font-semibold text-slate-200">Item Prices</h2>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">
                    {itemRows.length} unique items · {allItems.length} total
                  </span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-300 outline-none"
                  >
                    <option value="value">Sort by Total Value</option>
                    <option value="price">Sort by Unit Price</option>
                    <option value="name">Sort by Name</option>
                  </select>
                </div>
              </div>

              {/* Table header */}
              <div className="grid grid-cols-[1fr_60px_110px_100px_90px] gap-3 px-6 py-2 text-xs font-medium text-slate-500 uppercase tracking-wider border-b border-slate-700/50">
                <span>Item</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Steam</span>
                <span className="text-right">Skinport</span>
                <span className="text-right">Total</span>
              </div>

              {/* Table rows */}
              <div className="max-h-96 overflow-y-auto">
                {itemRows.length === 0 ? (
                  <div className="px-6 py-8 text-center text-slate-500">
                    {isFetching
                      ? 'Loading prices...'
                      : 'No priced items yet. Click "Refresh Prices" to fetch market data.'}
                  </div>
                ) : (
                  itemRows.map((row) => (
                    <div
                      key={row.marketHashName}
                      className="grid grid-cols-[1fr_60px_110px_100px_90px] gap-3 px-6 py-2.5 border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors items-center"
                    >
                      {/* Item name + image */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 bg-slate-700/50 rounded flex items-center justify-center shrink-0 overflow-hidden">
                          {row.imageUrl ? (
                            <img
                              src={row.imageUrl}
                              alt=""
                              className="max-w-full max-h-full object-contain"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-4 h-4 bg-slate-600 rounded" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm text-slate-200 truncate">{row.name}</p>
                          {row.marketHashName !== row.name && (
                            <p className="text-[10px] text-slate-500 truncate">{row.marketHashName}</p>
                          )}
                        </div>
                        {row.rarityColor && (
                          <div className="w-1.5 h-4 rounded-full shrink-0" style={{ backgroundColor: row.rarityColor }} />
                        )}
                      </div>

                      {/* Quantity */}
                      <span className="text-sm text-slate-400 text-right">{row.count}</span>

                      {/* Steam price */}
                      <div className="text-right">
                        {row.steamPrice === -1 ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Not on Steam
                          </span>
                        ) : (
                          <span className="text-sm text-slate-300">
                            {row.steamPrice > 0 ? formatPrice(row.steamPrice) : '—'}
                          </span>
                        )}
                      </div>

                      {/* Skinport price */}
                      <div className="text-right">
                        {row.skinport?.minPrice != null ? (
                          <span className="text-sm text-orange-300">
                            {formatPrice(row.skinport.minPrice)}
                          </span>
                        ) : (
                          <span className="text-sm text-slate-600">—</span>
                        )}
                      </div>

                      {/* Total */}
                      <span className="text-sm font-medium text-slate-200 text-right">
                        {row.totalPrice > 0 ? formatPrice(row.totalPrice) : '—'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
