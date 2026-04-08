// ============================================================
// CSInventoryPorter — Pricing IPC handlers
// Bridges renderer ↔ main process for price data
// ============================================================

import { ipcMain, type BrowserWindow } from 'electron';
import { AccountManager } from '../services/AccountManager';
import { IPC, type PriceServerConfig } from '../../shared/types';
import type { CurrencyCode } from '../../shared/constants';

/**
 * Register pricing i p c.
 *
 * Characteristics:
 * - @param accountManager - The parameter for accountManager
 * - @param getMainWindow - The parameter for getMainWindow
 * - @returns Nothing (void)
 *
 */
export function registerPricingIPC(
  accountManager: AccountManager,
  getMainWindow: () => BrowserWindow | null,
): void {
  const sendToRenderer = (channel: string, ...args: any[]) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  };

  // ---- Forward pricing progress events to renderer ----

  accountManager.onPricingProgress((progress) => {
    sendToRenderer(IPC.PRICING_PROGRESS, progress);
  });

  // ---- Forward full-load progress events to renderer ----

  accountManager.onFullLoadProgress((progress) => {
    sendToRenderer(IPC.FULL_LOAD_PROGRESS, progress);
  });

  // ---- Handle requests from renderer ----

  // Fetch prices for all inventory items
  ipcMain.handle(IPC.PRICING_FETCH, async () => {
    try {
      await accountManager.fetchAllPrices();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Cancel in-progress price fetch
  ipcMain.on(IPC.PRICING_CANCEL, () => {
    accountManager.cancelPriceFetch();
  });

  // Get cached portfolio data (prices + portfolio history)
  ipcMain.handle(IPC.PRICING_GET, async () => {
    return accountManager.getPortfolioData();
  });

  // ---- Currency settings (Phase 6) ----

  ipcMain.handle(IPC.SETTINGS_GET_CURRENCY, async () => {
    return accountManager.getCurrency();
  });

  ipcMain.handle(IPC.SETTINGS_SET_CURRENCY, async (_event, currency: CurrencyCode) => {
    accountManager.setCurrency(currency);
    return { success: true };
  });

  // ---- Forward wallet-driven currency changes to renderer ----
  accountManager.on('currency-changed', (code: string) => {
    sendToRenderer(IPC.SETTINGS_CURRENCY_CHANGED, code);
  });

  // ---- Full-load (Phase 6) ----

  ipcMain.handle(IPC.FULL_LOAD, async () => {
    try {
      await accountManager.fullLoad();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ---- Price Server settings (Phase 11) ----

  ipcMain.handle(IPC.PRICE_SERVER_GET, async () => {
    return accountManager.getPriceServerConfig();
  });

  ipcMain.handle(IPC.PRICE_SERVER_SET, async (_event, config: PriceServerConfig | null) => {
    accountManager.setPriceServerConfig(config);
    return { success: true };
  });

  ipcMain.handle(IPC.PRICE_SERVER_TEST, async (_event, config: PriceServerConfig) => {
    return accountManager.testPriceServer(config);
  });
}
