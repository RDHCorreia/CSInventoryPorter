// ============================================================
// CSInventoryPorter — Trade IPC handlers
// Bridges renderer ↔ main process for friend trading
// ============================================================

import { ipcMain, type BrowserWindow } from 'electron';
import { AccountManager } from '../services/AccountManager';
import { IPC, type SendTradeOfferRequest } from '../../shared/types';

/**
 * Register trade i p c.
 *
 * Characteristics:
 * - @param accountManager - The parameter for accountManager
 * - @param getMainWindow - The parameter for getMainWindow
 * - @returns Nothing (void)
 *
 */
export function registerTradeIPC(
  accountManager: AccountManager,
  getMainWindow: () => BrowserWindow | null,
): void {
  const sendToRenderer = (channel: string, ...args: any[]) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  };

  // ---- Forward trade events to renderer ----

  accountManager.onTradeProgress((progress) => {
    sendToRenderer(IPC.TRADE_PROGRESS, progress);
  });

  accountManager.onNewTradeOffer((offer) => {
    sendToRenderer(IPC.TRADE_NEW_OFFER, offer);
  });

  accountManager.onTradeOfferChanged((offer) => {
    sendToRenderer(IPC.TRADE_OFFER_CHANGED, offer);
  });

  // ---- Handle requests from renderer ----

  // Get our own tradable asset IDs
  ipcMain.handle(IPC.TRADE_GET_MY_TRADABLE_IDS, async () => {
    try {
      const ids = await accountManager.getMyTradableAssetIds();
      return { success: true, ids };
    } catch (err: any) {
      return { success: false, error: err.message, ids: [] };
    }
  });

  // Get friends list
  ipcMain.handle(IPC.TRADE_GET_FRIENDS, async () => {
    try {
      const friends = await accountManager.getFriends();
      return { success: true, friends };
    } catch (err: any) {
      return { success: false, error: err.message, friends: [] };
    }
  });

  // Get a friend's CS2 inventory
  ipcMain.handle(IPC.TRADE_GET_FRIEND_INVENTORY, async (_event, steamID: string) => {
    try {
      const items = await accountManager.getFriendInventory(steamID);
      return { success: true, items };
    } catch (err: any) {
      return { success: false, error: err.message, items: [] };
    }
  });

  // Send a trade offer
  ipcMain.handle(IPC.TRADE_SEND_OFFER, async (_event, request: SendTradeOfferRequest) => {
    try {
      return await accountManager.sendTradeOffer(request);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Get active trade offers (sent + received)
  ipcMain.handle(IPC.TRADE_GET_OFFERS, async () => {
    try {
      const offers = await accountManager.getTradeOffers();
      return { success: true, ...offers };
    } catch (err: any) {
      return { success: false, error: err.message, sent: [], received: [] };
    }
  });

  // Accept a trade offer
  ipcMain.handle(IPC.TRADE_ACCEPT, async (_event, offerId: string) => {
    try {
      return await accountManager.acceptTradeOffer(offerId);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Decline a trade offer
  ipcMain.handle(IPC.TRADE_DECLINE, async (_event, offerId: string) => {
    try {
      return await accountManager.declineTradeOffer(offerId);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Cancel a sent trade offer
  ipcMain.handle(IPC.TRADE_CANCEL, async (_event, offerId: string) => {
    try {
      return await accountManager.cancelTradeOffer(offerId);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}
