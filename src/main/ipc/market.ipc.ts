// ============================================================
// CSInventoryPorter — Market IPC handlers
// Bridges renderer ↔ main process for market listing operations
// ============================================================

import { ipcMain, type BrowserWindow } from 'electron';
import { AccountManager } from '../services/AccountManager';
import { IPC, type ListItemRequest } from '../../shared/types';

/**
 * Register market i p c.
 *
 * Characteristics:
 * - @param accountManager - The parameter for accountManager
 * - @param getMainWindow - The parameter for getMainWindow
 * - @returns Nothing (void)
 *
 */
export function registerMarketIPC(
  accountManager: AccountManager,
  getMainWindow: () => BrowserWindow | null,
): void {
  const sendToRenderer = (channel: string, ...args: any[]) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  };

  // ---- Forward market events to renderer ----

  accountManager.onMarketProgress((progress) => {
    sendToRenderer(IPC.MARKET_PROGRESS, progress);
  });

  accountManager.onMarketListingsUpdated((listings) => {
    sendToRenderer(IPC.MARKET_LISTINGS_UPDATED, listings);
  });

  // ---- Handle requests from renderer ----

  // Fetch active market listings
  ipcMain.handle(IPC.MARKET_GET_LISTINGS, async () => {
    try {
      const listings = await accountManager.fetchMarketListings();
      return { success: true, listings };
    } catch (err: any) {
      return { success: false, error: err.message, listings: [] };
    }
  });

  // List a single item for sale
  ipcMain.handle(IPC.MARKET_LIST_ITEM, async (_event, assetId: string, priceInCents: number) => {
    try {
      return await accountManager.listItemForSale(assetId, priceInCents);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // List multiple items for sale
  ipcMain.handle(IPC.MARKET_LIST_MULTIPLE, async (_event, requests: ListItemRequest[]) => {
    try {
      return await accountManager.listMultipleItems(requests);
    } catch (err: any) {
      return { success: false, succeeded: 0, failed: 0, errors: [err.message] };
    }
  });

  // Remove a listing from the market
  ipcMain.handle(IPC.MARKET_DELIST, async (_event, listingId: string) => {
    try {
      return await accountManager.delistItem(listingId);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Remove all active listings
  ipcMain.handle(IPC.MARKET_DELIST_ALL, async () => {
    try {
      return await accountManager.delistAll();
    } catch (err: any) {
      return { success: false, succeeded: 0, failed: 0 };
    }
  });
}
