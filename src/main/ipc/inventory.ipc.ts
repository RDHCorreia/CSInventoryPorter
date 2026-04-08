// ============================================================
// CSInventoryPorter — Inventory IPC handlers
// Bridges renderer ↔ main process for inventory data
// ============================================================

import { ipcMain, type BrowserWindow } from 'electron';
import { AccountManager } from '../services/AccountManager';
import { IPC, type CasketOperation } from '../../shared/types';

/**
 * Register inventory i p c.
 *
 * Characteristics:
 * - @param accountManager - The parameter for accountManager
 * - @param getMainWindow - The parameter for getMainWindow
 * - @returns Nothing (void)
 *
 */
export function registerInventoryIPC(
  accountManager: AccountManager,
  getMainWindow: () => BrowserWindow | null,
): void {
  const sendToRenderer = (channel: string, ...args: any[]) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  };

  // ---- Forward events to renderer ----

  accountManager.onInventoryUpdated((data) => {
    sendToRenderer(IPC.INVENTORY_UPDATED, data);
  });

  accountManager.onCasketContentsLoaded((casketId, items) => {
    sendToRenderer(IPC.CASKET_CONTENTS_LOADED, casketId, items);
  });

  accountManager.onCasketOperationProgress((progress) => {
    sendToRenderer(IPC.CASKET_OPERATION_PROGRESS, progress);
  });

  // ---- Handle requests from renderer ----

  // Get current inventory snapshot
  ipcMain.handle(IPC.INVENTORY_GET, async () => {
    return accountManager.getInventoryData();
  });

  // Trigger inventory reload
  ipcMain.handle(IPC.INVENTORY_LOAD, async () => {
    try {
      accountManager.reloadInventory();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Load contents of a specific storage unit
  ipcMain.handle(IPC.CASKET_CONTENTS, async (_event, casketId: string) => {
    try {
      const items = await accountManager.loadCasketContents(casketId);
      return { success: true, items };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Execute bulk casket operations (add/remove items)
  ipcMain.handle(IPC.CASKET_ADD, async (_event, operations: CasketOperation[], delayMs?: number, itemCount?: number) => {
    try {
      await accountManager.executeBulkOperation(operations, delayMs, itemCount);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Cancel in-progress bulk operation
  ipcMain.on(IPC.CASKET_REMOVE, () => {
    accountManager.cancelBulkOperation();
  });

  // Rename a storage unit
  ipcMain.handle(IPC.CASKET_RENAME, async (_event, casketId: string, name: string) => {
    try {
      await accountManager.renameCasket(casketId, name);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}
