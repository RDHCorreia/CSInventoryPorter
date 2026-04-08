// ============================================================
// CSInventoryPorter — Home Page
// Combined portfolio chart for all accounts + account cards
// ============================================================

import { useState, useMemo, useCallback, useEffect, useContext } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { useAuth } from '../hooks/useAuth';
import { useMultiAccount } from '../hooks/useMultiAccount';
import type { PortfolioSnapshot, AccountSnapshotSummary } from '../../shared/types';
import { STEAM_AVATAR_BASE } from '../../shared/constants';
import { CurrencyContext } from '../App';
import NavBar from '../components/NavBar';
import { type AppPage, type TimeRange, TIME_RANGE_LABELS, TIME_RANGE_MS, timeAgo } from '../utils/itemUtils';

interface Props {
  auth: ReturnType<typeof useAuth>;
  onNavigate: (page: AppPage) => void;
}

// ---- Chart tooltip ----

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
      <p className="text-xs text-slate-400">
        {new Date(label).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </p>
      <p className="text-sm font-bold text-green-400">{formatPrice(payload[0].value)}</p>
    </div>
  );
}

// ---- Value change ----

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

// timeAgo is now imported from ../utils/itemUtils

// ---- Account Card ----

/**
 * Account card.
 *
 * Characteristics:
 * - @param {
 *   account,
 *   isSwitching,
 *   onSwitch,
 *   onViewPortfolio,
 *   formatPrice,
 * } - The parameter for {
 *   account,
 *   isSwitching,
 *   onSwitch,
 *   onViewPortfolio,
 *   formatPrice,
 * }
 * - @returns React.JSX.Element
 *
 */
function AccountCard({
  account,
  isSwitching,
  onSwitch,
  onViewPortfolio,
  formatPrice,
}: {
  account: AccountSnapshotSummary;
  isSwitching: boolean;
  onSwitch: () => void;
  onViewPortfolio: () => void;
  formatPrice: (value: number) => string;
}) {
  const avatarUrl = account.avatarHash
    ? `${STEAM_AVATAR_BASE}${account.avatarHash}_medium.jpg`
    : null;

  return (
    <div
      className={`bg-slate-800/50 border rounded-xl p-4 transition-all ${account.isActive
          ? 'border-green-500/50 ring-1 ring-green-500/20'
          : 'border-slate-700 hover:border-slate-600'
        }`}
    >
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center shrink-0 overflow-hidden">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-sm font-bold text-slate-400 uppercase">
              {account.personaName?.charAt(0) || '?'}
            </span>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">{account.personaName || account.accountName}</p>
            {account.isActive && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 font-medium shrink-0">
                Active
              </span>
            )}
          </div>
        </div>

        {/* Status dot */}
        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${account.isActive ? 'bg-green-400' : 'bg-slate-600'
          }`} />
      </div>

      {/* Value row */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-700/50">
        <div>
          <p className="text-lg font-bold text-slate-100">
            {formatPrice(account.totalValue)}
          </p>
          <p className="text-[10px] text-slate-500">
            {account.totalItems} items · {timeAgo(account.lastUpdated)}
          </p>
        </div>

        {/* Action button */}
        {account.isActive ? (
          <button
            onClick={onViewPortfolio}
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 transition-colors font-medium"
          >
            View Portfolio
          </button>
        ) : account.hasRefreshToken ? (
          <button
            onClick={onSwitch}
            disabled={isSwitching}
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50 transition-colors font-medium"
          >
            {isSwitching ? 'Switching...' : 'Switch'}
          </button>
        ) : (
          <span className="text-[10px] text-slate-600">No saved login</span>
        )}
      </div>
    </div>
  );
}

// ---- Main Component ----

/**
 * Home page.
 *
 * Characteristics:
 * - @param { auth, onNavigate } - The parameter for { auth, onNavigate }
 * - @returns React.JSX.Element
 *
 */
export default function HomePage({ auth, onNavigate }: Props) {
  const { status, logout } = auth;
  const { summary, loading, refresh, switchAccount } = useMultiAccount();
  const { currency, symbol, formatPrice, formatPriceShort, currencyVersion } = useContext(CurrencyContext);
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const isConnected =
    status.state === 'loggedIn' ||
    status.state === 'gcConnecting' ||
    status.state === 'gcConnected';

  const isConnecting = status.state === 'connecting' || status.state === 'gcConnecting';

  // Clear switching state when connection completes
  const handleSwitch = useCallback(async (steamID: string) => {
    setSwitchingId(steamID);
    try {
      await switchAccount(steamID);
    } catch (err) {
      console.error('Switch failed:', err);
    }
    // switchingId cleared when gcConnected status arrives
  }, [switchAccount]);

  // Clear switching indicator when connected
  useEffect(() => {
    if (switchingId && status.state === 'gcConnected') {
      setSwitchingId(null);
    }
  }, [switchingId, status.state]);

  // Refresh data when currency changes
  useEffect(() => {
    if (currencyVersion > 0) {
      refresh();
    }
  }, [currencyVersion]);

  // Chart data
  const chartData = useMemo(() => {
    if (!summary?.combinedHistory?.length) return [];
    const history = summary.combinedHistory;
    const cutoffMs = TIME_RANGE_MS[timeRange];
    if (cutoffMs === Infinity) return history;
    const cutoff = Date.now() - cutoffMs;
    return history.filter((s) => s.time >= cutoff);
  }, [summary, timeRange]);

  const change = useMemo(() => {
    if (!summary?.combinedHistory?.length) return { amount: 0, percent: 0 };
    return computeChange(summary.combinedHistory, TIME_RANGE_MS[timeRange]);
  }, [summary, timeRange]);

  const combinedValue = summary?.combinedValue ?? 0;
  const accounts = summary?.accounts ?? [];
  const hasAccounts = accounts.length > 0;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <NavBar activePage="home" onNavigate={onNavigate} status={status} onLogout={logout} />

      {/* Content: split layout */}
      <main className="flex-1 flex min-h-0 overflow-hidden">
        {/* ---- Left: Portfolio Chart ---- */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Combined value header */}
          <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-sm text-slate-400 mb-1">
                  Combined Portfolio Value
                  {accounts.length > 0 && (
                    <span className="text-slate-600 ml-1">({accounts.length} account{accounts.length > 1 ? 's' : ''})</span>
                  )}
                </p>
                <p className="text-4xl font-bold text-slate-100">
                  {formatPrice(combinedValue)}
                </p>
                {change.amount !== 0 && (
                  <p className={`text-sm mt-1 ${change.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {change.amount >= 0 ? '+' : ''}{symbol}{Math.abs(change.amount).toFixed(2)} ({change.percent >= 0 ? '+' : ''}{change.percent.toFixed(1)}%)
                    <span className="text-slate-500 ml-1">{TIME_RANGE_LABELS[timeRange]}</span>
                  </p>
                )}
              </div>

              <button
                onClick={refresh}
                disabled={loading}
                className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors disabled:opacity-50"
              >
                <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            </div>

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
                      <linearGradient id="homeGradient" x1="0" y1="0" x2="0" y2="1">
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
                      fill="url(#homeGradient)"
                      dot={false}
                      activeDot={{ r: 4, fill: '#3b82f6', stroke: '#1e293b', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-slate-500">
                {!hasAccounts ? (
                  <div className="text-center space-y-3">
                    <svg className="w-12 h-12 mx-auto text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <p>Add an account to get started</p>
                  </div>
                ) : (
                  <div className="text-center space-y-3">
                    <svg className="w-12 h-12 mx-auto text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                    </svg>
                    <p>No price history yet</p>
                    <p className="text-xs text-slate-600">Log into an account and fetch prices to see the chart</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Connecting indicator */}
          {(isConnecting || switchingId) && (
            <div className="mt-4 bg-blue-500/10 border border-blue-500/30 rounded-lg px-4 py-3 flex items-center gap-3">
              <svg className="animate-spin h-4 w-4 text-blue-400 shrink-0" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm text-blue-400">
                {status.state === 'connecting' && 'Connecting to Steam...'}
                {status.state === 'gcConnecting' && 'Connecting to CS2 Game Coordinator...'}
                {status.state === 'loggedIn' && 'Logged in, waiting for GC...'}
              </span>
            </div>
          )}
        </div>

        {/* ---- Right: Account Cards ---- */}
        <div className="w-80 border-l border-slate-700 bg-slate-800/30 p-4 overflow-y-auto shrink-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">
              Accounts
            </h2>
            <span className="text-[10px] text-slate-600">{accounts.length} saved</span>
          </div>

          <div className="space-y-3">
            {/* Account cards */}
            {accounts.map((account) => (
              <AccountCard
                key={account.steamID}
                account={account}
                isSwitching={switchingId === account.steamID || (isConnecting && switchingId === account.steamID)}
                onSwitch={() => handleSwitch(account.steamID)}
                onViewPortfolio={() => onNavigate('portfolio')}
                formatPrice={formatPrice}
              />
            ))}

            {/* Add Account button */}
            <button
              onClick={() => onNavigate('login')}
              className="w-full bg-slate-800/50 border-2 border-dashed border-slate-700 hover:border-slate-500 rounded-xl p-4 transition-colors group"
            >
              <div className="flex items-center justify-center gap-2 text-slate-500 group-hover:text-slate-300">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                <span className="text-sm font-medium">Add Account</span>
              </div>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
