// ============================================================
// CSInventoryPorter — Loading Page
// Full-screen loading overlay shown after login
// Loads inventory + storage units + prices before showing UI
// ============================================================

import { useState, useEffect, useRef } from 'react';
import type { FullLoadProgress, PricingProgress } from '../../shared/types';

const api = () => (window as any).csinventoryporter;

interface Props {
  onComplete: () => void;
}

/**
 * Loading page.
 *
 * Characteristics:
 * - @param { onComplete } - The parameter for { onComplete }
 * - @returns React.JSX.Element
 *
 */
export default function LoadingPage({ onComplete }: Props) {
  const [loadProgress, setLoadProgress] = useState<FullLoadProgress>({
    phase: 'inventory',
    message: 'Initializing...',
  });
  const [pricingProgress, setPricingProgress] = useState<PricingProgress | null>(null);
  const triggered = useRef(false);

  useEffect(() => {
    // Subscribe to full-load progress
    const unsubLoad = api().onFullLoadProgress((progress: FullLoadProgress) => {
      setLoadProgress(progress);
      if (progress.phase === 'ready' || progress.phase === 'done') {
        // Small delay so user sees "All loaded!" briefly
        setTimeout(onComplete, 600);
      }
    });

    // Subscribe to pricing progress for detailed price-fetch info
    const unsubPricing = api().onPricingProgress((progress: PricingProgress) => {
      setPricingProgress(progress);
    });

    // Trigger the full load sequence once
    if (!triggered.current) {
      triggered.current = true;
      api().fullLoad().catch((err: any) => {
        console.error('[LoadingPage] fullLoad failed:', err);
        // Navigate away even on error
        setTimeout(onComplete, 1000);
      });
    }

    return () => {
      unsubLoad();
      unsubPricing();
    };
  }, [onComplete]);

  // Determine what to show
  const phase = loadProgress.phase;
  const isPricing = phase === 'prices' && pricingProgress;

  // Progress percentage for the circular indicator
  let progressPercent = 0;
  if (phase === 'inventory') progressPercent = 10;
  else if (phase === 'caskets') {
    const c = loadProgress.current ?? 0;
    const t = loadProgress.total ?? 1;
    progressPercent = 20 + (c / t) * 30;
  } else if (phase === 'prices') {
    if (pricingProgress && pricingProgress.total > 0) {
      progressPercent = 50 + (pricingProgress.current / pricingProgress.total) * 48;
    } else {
      progressPercent = 55;
    }
  } else if (phase === 'ready') {
    progressPercent = 100;
  } else if (phase === 'done') {
    progressPercent = 100;
  }

  const phaseLabel = {
    inventory: 'Loading Inventory',
    caskets: 'Loading Storage Units',
    ready: 'Almost Ready',
    prices: 'Fetching Prices',
    done: 'Ready!',
  }[phase];

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-slate-900 text-slate-100">
      {/* Animated logo / spinner area */}
      <div className="relative mb-8">
        {/* Outer spinning ring */}
        <svg className="w-24 h-24 animate-spin-slow" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="#1e293b"
            strokeWidth="6"
          />
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="url(#loadingGradient)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${progressPercent * 2.83} ${283 - progressPercent * 2.83}`}
            className="transition-all duration-500 ease-out"
            transform="rotate(-90 50 50)"
          />
          <defs>
            <linearGradient id="loadingGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#06b6d4" />
            </linearGradient>
          </defs>
        </svg>
        {/* Center percentage */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-bold text-blue-400">
            {Math.round(progressPercent)}%
          </span>
        </div>
      </div>

      {/* Title */}
      <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent mb-2">
        CSInventoryPorter
      </h1>

      {/* Phase label */}
      <p className="text-lg font-semibold text-slate-300 mb-2">
        {phaseLabel}
      </p>

      {/* Detail message */}
      <p className="text-sm text-slate-500 mb-4 max-w-md text-center">
        {loadProgress.message}
      </p>

      {/* Pricing detail bar */}
      {isPricing && pricingProgress && pricingProgress.total > 0 && (
        <div className="w-80">
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>{pricingProgress.currentItem || 'Fetching...'}</span>
            <span>{pricingProgress.current}/{pricingProgress.total}</span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-all duration-300"
              style={{ width: `${(pricingProgress.current / pricingProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Caskets detail bar */}
      {phase === 'caskets' && loadProgress.total && loadProgress.total > 0 && (
        <div className="w-80">
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>{loadProgress.message}</span>
            <span>{loadProgress.current ?? 0}/{loadProgress.total}</span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-all duration-300"
              style={{ width: `${((loadProgress.current ?? 0) / loadProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
