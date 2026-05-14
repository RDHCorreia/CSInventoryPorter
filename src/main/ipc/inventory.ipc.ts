// ============================================================
// CSInventoryPorter — Inventory IPC handlers
// Bridges renderer ↔ main process for inventory data
// ============================================================

import { dialog, ipcMain, type BrowserWindow } from 'electron';
import fs from 'fs';
import { AccountManager } from '../services/AccountManager';
import {
  IPC,
  type CasketOperation,
  type InventoryExportColumn,
  type InventoryExportOptions,
} from '../../shared/types';

const EXPORT_COLUMN_LABELS: Record<InventoryExportColumn, string> = {
  accountName: 'Account',
  itemName: 'Item Name',
  quantity: 'Quantity',
  storageUnitName: 'Storage Unit',
  wear: 'Float',
  paintIndex: 'Paint Index',
  price: 'Price',
  totalPrice: 'Total Price',
};

const DEFAULT_EXPORT_COLUMNS: InventoryExportColumn[] = [
  'accountName',
  'itemName',
  'quantity',
  'price',
  'totalPrice',
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: Array<Record<string, unknown>>, columns: InventoryExportColumn[]): string {
  const header = columns.map((column) => csvCell(EXPORT_COLUMN_LABELS[column])).join(',');
  const body = rows.map((row) => columns.map((column) => csvCell(row[column])).join(','));
  return [header, ...body].join('\r\n');
}

function sanitizeFilename(value: string): string {
  return value.replace(/[<>:"/\\|?*]+/g, '-').replace(/\s+/g, '-').slice(0, 80);
}

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

  ipcMain.handle(IPC.INVENTORY_EXPORT, async (_event, options: InventoryExportOptions) => {
    try {
      const columns = options.columns?.length ? options.columns : DEFAULT_EXPORT_COLUMNS;
      const rows = accountManager.getInventoryExportRows(options);
      if (rows.length === 0) {
        return { success: false, error: 'No inventory data is available for this export.' };
      }

      const content = toCsv(rows, columns);
      const scopeLabel = options.scope === 'all'
        ? 'all-accounts'
        : options.steamID || 'active-account';
      const baseName = options.exportName?.trim() || `csinventoryporter-${scopeLabel}-${new Date().toISOString().slice(0, 10)}`;
      const defaultPath = `${sanitizeFilename(baseName)}.csv`;
      const win = getMainWindow();
      const result = await dialog.showSaveDialog(win ?? undefined, {
        title: 'Export inventory items',
        defaultPath,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: true, rowCount: 0 };
      }

      fs.writeFileSync(result.filePath, content, 'utf-8');
      return { success: true, filePath: result.filePath, rowCount: rows.length };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
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
