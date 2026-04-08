// ============================================================
// CSInventoryPorter — useCurrency hook
// Manages the active currency with persistence
// Phase 6
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { CURRENCY_SYMBOLS, type CurrencyCode } from '../../shared/constants';

const api = () => (window as any).csinventoryporter;

/**
 * Hook for currency.
 *
 * Characteristics:
 * - @returns { currency: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/constants").CurrencyCode; setCurrency: (code: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/constants").CurrencyCode) => Promise<void>; symbol: string; formatPrice: (value: number) => string; formatPriceShort: (value: number) => string; currencyVersion: number; }
 *
 */
export function useCurrency() {
  const [currency, setCurrencyState] = useState<CurrencyCode>('EUR');
  /** Increments every time the currency actually changes — pages use this to trigger data reloads */
  const [currencyVersion, setCurrencyVersion] = useState(0);

  // Load persisted currency on mount
  useEffect(() => {
    api().getCurrency().then((code: string) => {
      if (code === 'USD' || code === 'EUR') {
        setCurrencyState(code);
      }
    }).catch(() => {});
  }, []);

  // Listen for wallet-driven currency changes from main process
  useEffect(() => {
    const unsub = api().onCurrencyChanged((code: string) => {
      if (code === 'USD' || code === 'EUR') {
        setCurrencyState(code);
        setCurrencyVersion((v) => v + 1);
      }
    });
    return unsub;
  }, []);

  // setCurrency — persist the user's currency choice and notify the main process
  const setCurrency = useCallback(async (code: CurrencyCode) => {
    setCurrencyState(code);
    setCurrencyVersion((v) => v + 1);
    try {
      await api().setCurrency(code);
    } catch (err) {
      console.warn('[useCurrency] Failed to persist currency:', err);
    }
  }, []);

  const symbol = CURRENCY_SYMBOLS[currency];

  /** Format a number as currency string */
  const formatPrice = useCallback((value: number): string => {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }, [currency]);

  /** Format an integer value (no decimals) */
  const formatPriceShort = useCallback((value: number): string => {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }, [currency]);

  return {
    currency,
    setCurrency,
    symbol,
    formatPrice,
    formatPriceShort,
    currencyVersion,
  };
}
