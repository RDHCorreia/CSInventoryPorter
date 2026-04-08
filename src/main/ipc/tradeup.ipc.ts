// ============================================================
// CSInventoryPorter — Trade-Up IPC handlers
// Bridges renderer ↔ main process for trade-up contracts
// Phase 8
// ============================================================

import { ipcMain, type BrowserWindow } from 'electron';
import { AccountManager } from '../services/AccountManager';
import { IPC } from '../../shared/types';
import type { InventoryItem } from '../../shared/types';

/**
 * Register tradeup i p c.
 *
 * Characteristics:
 * - @param accountManager - The parameter for accountManager
 * - @param getMainWindow - The parameter for getMainWindow
 * - @returns Nothing (void)
 *
 */
export function registerTradeupIPC(
  accountManager: AccountManager,
  getMainWindow: () => BrowserWindow | null,
): void {
  const sendToRenderer = (channel: string, ...args: any[]) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  };

  // ---- Forward tradeup progress events to renderer ----

  accountManager.onTradeupProgress((progress) => {
    sendToRenderer(IPC.TRADEUP_PROGRESS, progress);
  });

  // ---- Handle requests from renderer ----

  ipcMain.handle(IPC.TRADEUP_EXECUTE, async (_event, itemIds: string[]) => {
    try {
      return await accountManager.executeTradeup(itemIds);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(IPC.TRADEUP_PREDICT, async (_event, items: InventoryItem[]) => {
    try {
      return accountManager.predictTradeup(items);
    } catch {
      return null;
    }
  });
}
