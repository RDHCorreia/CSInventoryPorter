
import { useState, useEffect, useCallback } from 'react';
import type { useAuth } from '../hooks/useAuth';
import type { ArmoryData, ArmoryItem, ArmoryProgress } from '../../shared/types';
import NavBar from '../components/NavBar';
import type { AppPage } from '../utils/itemUtils';

interface Props {
  auth: ReturnType<typeof useAuth>;
  onNavigate: (page: AppPage) => void;
}

// ---- Star icon ----

/**
 * Star icon.
 *
 * Characteristics:
 * - @param { className } - The parameter for { className }
 * - @returns React.JSX.Element
 *
 */
function StarIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-4 h-4'} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

// ---- Category badge ----

const CATEGORY_STYLES: Record<string, { label: string; color: string }> = {
  limited:    { label: 'Limited',    color: 'text-red-400 bg-red-900/30' },
  charm:      { label: 'Charm',      color: 'text-purple-400 bg-purple-900/30' },
  case:       { label: 'Case',       color: 'text-blue-400 bg-blue-900/30' },
  sticker:    { label: 'Sticker',    color: 'text-yellow-400 bg-yellow-900/30' },
  collection: { label: 'Collection', color: 'text-green-400 bg-green-900/30' },
};

/**
 * Category badge.
 *
 * Characteristics:
 * - @param { category } - The parameter for { category }
 * - @returns React.JSX.Element
 *
 */
function CategoryBadge({ category }: { category?: string }) {
  const style = CATEGORY_STYLES[category ?? ''] ?? { label: category ?? 'Item', color: 'text-slate-400 bg-slate-700' };
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${style.color}`}>
      {style.label}
    </span>
  );
}

// ---- Armory item card ----

/**
 * Armory item card.
 *
 * Characteristics:
 * - @param {
 *   item,
 *   maxRedeemable,
 *   onRedeem,
 *   isRedeeming,
 * } - The parameter for {
 *   item,
 *   maxRedeemable,
 *   onRedeem,
 *   isRedeeming,
 * }
 * - @returns React.JSX.Element
 *
 */
function ArmoryItemCard({
  item,
  maxRedeemable,
  onRedeem,
  isRedeeming,
}: {
  item: ArmoryItem;
  maxRedeemable: number;
  onRedeem: (item: ArmoryItem, count: number) => void;
  isRedeeming: boolean;
}) {
  const [isSelectingQuantity, setIsSelectingQuantity] = useState(false);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    if (isRedeeming || maxRedeemable < 1) setIsSelectingQuantity(false);
  }, [isRedeeming, maxRedeemable]);

  return (
    <div
      className="flex flex-col rounded-xl p-4 gap-3 transition-all"
      style={{ backgroundColor: 'var(--sp-card)', border: '1px solid var(--sp-surface)' }}
    >
      {/* Item image or placeholder */}
      <div className="w-full aspect-square rounded-lg bg-slate-800/60 flex items-center justify-center overflow-hidden">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.name}
            className="w-full h-full object-contain p-2"
            loading="lazy"
          />
        ) : (
          <StarIcon className="w-12 h-12 text-slate-600" />
        )}
      </div>

      {/* Name + category */}
      <div className="flex flex-col gap-1 min-h-[44px]">
        <p className="text-xs font-semibold text-slate-100 leading-tight line-clamp-2">{item.name}</p>
        <CategoryBadge category={item.category} />
      </div>

      {/* Cost + redeem button */}
      <div className="flex items-center justify-between gap-2 mt-auto relative">
        <div className="flex items-center gap-1 text-yellow-400 shrink-0">
          <StarIcon className="w-3.5 h-3.5" />
          <span className="text-sm font-bold">{item.cost}</span>
        </div>
        
        {isSelectingQuantity && !isRedeeming ? (
          <div className="flex items-center gap-1 z-10 bg-slate-800 rounded-lg p-0.5 overflow-hidden flex-1 justify-end ml-1">
            <button 
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
              className="px-2 py-1 text-slate-300 hover:bg-slate-700 rounded-md text-xs font-bold shrink-0"
            >-</button>
            <input 
              type="number"
              min={1}
              max={maxRedeemable}
              value={quantity || ''}
              onChange={(e) => {
                const num = parseInt(e.target.value, 10);
                if (isNaN(num)) setQuantity('' as any);
                else setQuantity(Math.min(Math.max(1, num), maxRedeemable));
              }}
              onBlur={() => {
                if (!quantity || quantity < 1) setQuantity(1);
              }}
              className="w-8 text-center text-xs font-bold bg-transparent text-white focus:outline-none appearance-none"
              style={{ MozAppearance: 'textfield' }}
            />
            <button 
              onClick={() => setQuantity(Math.min(maxRedeemable, quantity + 1))}
              className="px-2 py-1 text-slate-300 hover:bg-slate-700 rounded-md text-xs font-bold shrink-0"
            >+</button>
            <button
              onClick={() => { onRedeem(item, quantity || 1); setIsSelectingQuantity(false); }}
              className="px-2 py-1 ml-0.5 bg-green-600 hover:bg-green-500 text-white rounded-md text-xs font-bold shrink-0"
            >✓</button>
            <button
              onClick={() => setIsSelectingQuantity(false)}
              className="px-2 py-1 ml-0.5 text-red-400 hover:bg-slate-700 rounded-md text-xs font-bold shrink-0"
            >✕</button>
          </div>
        ) : (
          <button
            onClick={() => {
              setIsSelectingQuantity(true);
              setQuantity(1);
            }}
            disabled={maxRedeemable < 1 || isRedeeming}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all w-full flex-1 ml-2 shrink-0 max-w-[80px] ${
              maxRedeemable >= 1 && !isRedeeming
                ? 'text-white hover:opacity-90 active:scale-95'
                : 'text-slate-500 bg-slate-700 cursor-not-allowed'
            }`}
            style={maxRedeemable >= 1 && !isRedeeming ? { backgroundColor: 'var(--sp-accent)' } : undefined}
          >
            {isRedeeming ? '...' : 'Redeem'}
          </button>
        )}
      </div>
    </div>
  );
}

// ---- Main page ----

/**
 * Armory page.
 *
 * Characteristics:
 * - @param { auth, onNavigate } - The parameter for { auth, onNavigate }
 * - @returns React.JSX.Element
 *
 */
export default function ArmoryPage({ auth, onNavigate }: Props) {
  const [armoryData, setArmoryData] = useState<ArmoryData | null>(null);
  const [progress, setProgress] = useState<ArmoryProgress>({ state: 'idle' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await window.csinventoryporter.getArmoryData();
        if (cancelled) return;
        if (res.success && res.data) {
          setArmoryData(res.data as ArmoryData);
        } else {
          setError(res.error ?? 'Failed to load armory data.');
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? 'Unknown error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const unsub = window.csinventoryporter.onArmoryProgress((p: ArmoryProgress) => {
      setProgress(p);
      if (p.currentStars !== undefined) {
        setArmoryData((prev) => prev ? { ...prev, stars: p.currentStars! } : null);
      }
      if (p.state === 'completed' || p.state === 'error') {
        setTimeout(async () => {
          const res = await window.csinventoryporter.getArmoryData();
          if (res.success && res.data) setArmoryData(res.data as ArmoryData);
        }, 500);
      }
    });
    return unsub;
  }, []);

  const handleRedeem = useCallback(async (item: ArmoryItem, count: number = 1) => {
    if (progress.state === 'redeeming') return;
    setProgress({ state: 'redeeming', message: `Redeeming ${item.name}…` });
    await window.csinventoryporter.redeemArmoryItem(Number(item.itemId), count);
  }, [progress.state]);

  const isRedeeming = progress.state === 'redeeming';
  const stars = armoryData?.stars ?? 0;
  const items = armoryData?.items ?? [];

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--sp-bg)' }}>
      <NavBar
        activePage="armory"
        onNavigate={onNavigate}
        status={auth.status}
        onLogout={auth.logout}
      />

      <div className="flex-1 overflow-y-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-slate-100">Armory</h2>
            <p className="text-sm text-slate-400 mt-0.5">
              Redeem stars earned from Operations for exclusive items.
            </p>
          </div>

          {/* Star balance */}
          <div
            className="flex items-center gap-2 px-4 py-2 rounded-xl"
            style={{ backgroundColor: 'var(--sp-card)' }}
          >
            <StarIcon className="w-5 h-5 text-yellow-400" />
            <span className="text-lg font-bold text-yellow-400">{stars}</span>
            <span className="text-sm text-slate-400">stars</span>
          </div>
        </div>

        {/* Progress banner */}
        {progress.state !== 'idle' && (
          <div
            className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium flex items-center gap-2 ${
              progress.state === 'completed'
                ? 'bg-green-900/40 text-green-300'
                : progress.state === 'error'
                  ? 'bg-red-900/40 text-red-300'
                  : 'bg-blue-900/40 text-blue-300'
            }`}
          >
            {progress.state === 'redeeming' && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {progress.message ?? progress.state}
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-24 text-slate-500">
            <svg className="w-6 h-6 animate-spin mr-3" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading armory…
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-400">
            <svg className="w-10 h-10 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p className="text-sm">{error}</p>
            <p className="text-xs text-slate-600">Make sure you are connected to the GC and have previously participated in an Operation.</p>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-400">
            <StarIcon className="w-10 h-10 text-slate-600" />
            <p className="text-sm">No items available in your personal store.</p>
            <p className="text-xs text-slate-600">Your personal store refreshes periodically. Check back later.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {items.map((item) => (
              <ArmoryItemCard
                key={item.itemId}
                item={item}
                maxRedeemable={Math.floor(stars / item.cost)}
                onRedeem={handleRedeem}
                isRedeeming={isRedeeming}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
