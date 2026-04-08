// ============================================================
// CSInventoryPorter — Shared Navigation Bar
// Extracted from per-page duplication into a single component
// ============================================================

import { useCallback, useContext, useState } from 'react';
import { CurrencyContext, CustomizationContext } from '../App';
import type { AppPage } from '../utils/itemUtils';
import type { ConnectionStatus } from '../../shared/types';
import type { CurrencyCode } from '../../shared/constants';

interface NavBarProps {
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
  status: ConnectionStatus;
  onLogout?: () => void;
}

const NAV_ITEMS: { page: AppPage; label: string; requiresConnection?: boolean }[] = [
  { page: 'home', label: 'Home' },
  { page: 'portfolio', label: 'Portfolio', requiresConnection: true },
  { page: 'investments', label: 'Investments', requiresConnection: true },
  { page: 'inventory', label: 'Inventory', requiresConnection: true },
  { page: 'market', label: 'Market', requiresConnection: true },
  { page: 'trade', label: 'Trade', requiresConnection: true },
  { page: 'tradeup', label: 'Tradeup', requiresConnection: true },
  { page: 'armory', label: 'Armory', requiresConnection: true },
];

/**
 * Nav bar.
 *
 * Characteristics:
 * - @param { activePage, onNavigate, status, onLogout } - The parameter for { activePage, onNavigate, status, onLogout }
 * - @returns React.JSX.Element
 *
 */
export default function NavBar({ activePage, onNavigate, status, onLogout }: NavBarProps) {
  const { currency } = useContext(CurrencyContext);
  const { setCurrency } = useContext(CurrencyContext);
  const { openPanel: openCustomize } = useContext(CustomizationContext);
  const [switchingCurrency, setSwitchingCurrency] = useState(false);

  const handleSetCurrency = useCallback(async (next: CurrencyCode) => {
    if (switchingCurrency || next === currency) return;
    setSwitchingCurrency(true);
    try {
      await setCurrency(next);
    } finally {
      setSwitchingCurrency(false);
    }
  }, [currency, setCurrency, switchingCurrency]);

  const isConnected =
    status.state === 'loggedIn' ||
    status.state === 'gcConnecting' ||
    status.state === 'gcConnected';

  return (
    <header
      className="flex w-full relative items-center justify-between pl-6 pr-[140px] py-3 shrink-0 select-none z-[9999]"
      style={{ backgroundColor: 'var(--sp-surface)', borderBottom: '1px solid var(--sp-card)', WebkitAppRegion: 'drag' } as any}
    >
      {/* Brand */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold bg-clip-text text-transparent" style={{ backgroundImage: `linear-gradient(to right, var(--sp-accent-light), var(--sp-accent))` }}>
          CSInventoryPorter
        </h1>
        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-400">
          v1.0.0
        </span>
      </div>

      {/* Navigation tabs */}
      <div className="flex items-center gap-1 rounded-lg p-0.5 min-w-0 flex-shrink overflow-x-auto overflow-y-hidden hide-scrollbar" style={{ backgroundColor: 'var(--sp-surface)', WebkitAppRegion: 'no-drag' } as any}>
        {NAV_ITEMS.map(({ page, label, requiresConnection }) => {
          const isActive = activePage === page;
          const disabled = requiresConnection && !isConnected;

          return (
            <button
              key={page}
              onClick={() => !disabled && !isActive && onNavigate(page)}
              disabled={disabled}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                isActive
                  ? 'text-white'
                  : disabled
                    ? 'text-slate-600 cursor-not-allowed'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
              }`}
              style={isActive ? { backgroundColor: 'var(--sp-accent)' } : undefined}
            >
              {label}
            </button>
          );
        })}

        {/* Customization palette icon */}
        <button
          onClick={openCustomize}
          className="px-2.5 py-1.5 text-sm rounded-md transition-colors text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
          title="Customize theme"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
          </svg>
        </button>

        {/* Settings gear icon */}
        <button
          onClick={() => onNavigate('settings')}
          className={`px-2.5 py-1.5 text-sm rounded-md transition-colors ${
            activePage === 'settings'
              ? 'text-white'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
          }`}
          style={activePage === 'settings' ? { backgroundColor: 'var(--sp-accent)' } : undefined}
          title="Settings"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      {/* Right side: currency + connection info */}
        <div className="flex items-center gap-4" style={{ WebkitAppRegion: 'no-drag' } as any}>
          {/* Currency selector */}
          <div className="flex items-center rounded-lg p-0.5" style={{ backgroundColor: 'var(--sp-card)' }}>
          <button
            onClick={() => handleSetCurrency('EUR')}
            disabled={switchingCurrency}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors disabled:opacity-60 ${
              currency === 'EUR' ? 'text-white' : 'text-slate-300 hover:text-white'
            }`}
            style={currency === 'EUR' ? { backgroundColor: 'var(--sp-accent)' } : undefined}
            title="Switch to EUR"
          >
            EUR
          </button>
          <button
            onClick={() => handleSetCurrency('USD')}
            disabled={switchingCurrency}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors disabled:opacity-60 ${
              currency === 'USD' ? 'text-white' : 'text-slate-300 hover:text-white'
            }`}
            style={currency === 'USD' ? { backgroundColor: 'var(--sp-accent)' } : undefined}
            title="Switch to USD"
          >
            USD
          </button>
        </div>

        {/* Connection indicator */}
        {isConnected && (
          <div className="flex items-center gap-2 text-sm">
            <span
              className={`w-2 h-2 rounded-full ${
                status.state === 'gcConnected'
                  ? 'bg-green-400'
                  : status.state === 'gcConnecting'
                    ? 'bg-yellow-400 animate-pulse'
                    : 'bg-blue-400'
              }`}
            />
            <span className="text-slate-400 text-xs">
              {status.personaName || status.accountName || 'Connected'}
            </span>
          </div>
        )}

        {isConnected && onLogout && (
          <button
            onClick={onLogout}
            className="text-xs px-3 py-1.5 font-semibold rounded-lg text-slate-300 bg-slate-800 hover:bg-red-500/20 hover:text-red-400 border border-slate-700 transition-all shrink-0 ml-1"
          >
            Logout
          </button>
        )}
      </div>
      {/* Window Controls (Top Right) */}
      <div className="flex items-center absolute top-0 right-0 h-full" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <button
          onClick={() => window.csinventoryporter.windowControls.minimize()}
          className="h-[48px] w-[46px] flex items-center justify-center text-slate-400 hover:bg-slate-700/50 transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10"><path fill="currentColor" d="M0,4.5v1h10v-1Z"/></svg>
        </button>
        <button
          onClick={() => window.csinventoryporter.windowControls.maximize()}
          className="h-[48px] w-[46px] flex items-center justify-center text-slate-400 hover:bg-slate-700/50 transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10"><path fill="currentColor" fillRule="evenodd" d="M1,1h8v8H1V1ZM2,2v6h6V2H2Z"/></svg>
        </button>
        <button
          onClick={() => window.csinventoryporter.windowControls.close()}
          className="h-[48px] w-[46px] flex items-center justify-center text-slate-400 hover:bg-red-500 hover:text-white transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10"><path fill="currentColor" fillRule="evenodd" d="M8.5,1.5l1,1l-3.5,3.5l3.5,3.5l-1,1l-3.5,-3.5l-3.5,3.5l-1,-1l3.5,-3.5l-3.5,-3.5l1,-1l3.5,3.5l3.5,-3.5Z"/></svg>
        </button>
      </div>
    </header>
  );
}
