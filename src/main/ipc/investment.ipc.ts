// ============================================================
// CSInventoryPorter — Investment IPC handlers
// Bridges renderer ↔ main process for investment tracking
// ============================================================

import { ipcMain, type BrowserWindow } from 'electron';
import { AccountManager } from '../services/AccountManager';
import { IPC, type InvestmentEntry } from '../../shared/types';

/**
 * Register investment i p c.
 *
 * Characteristics:
 * - @param accountManager - The parameter for accountManager
 * - @param _getMainWindow - The parameter for _getMainWindow
 * - @returns Nothing (void)
 *
 */
export function registerInvestmentIPC(
  accountManager: AccountManager,
  _getMainWindow: () => BrowserWindow | null,
): void {
  // Get all investment entries for the current account
  ipcMain.handle(IPC.INVESTMENTS_GET, async () => {
    try {
      const entries = accountManager.investments.getEntries();
      return { success: true, entries };
    } catch (err: any) {
      return { success: false, entries: [], error: err.message };
    }
  });

  // Add a new investment entry (auto-attaches current currency)
  ipcMain.handle(IPC.INVESTMENTS_ADD, async (_event, entry: Omit<InvestmentEntry, 'id' | 'createdAt'>) => {
    try {
      // Enforce EUR for all new writes.
      const entryWithCurrency = {
        ...entry,
        currency: 'EUR' as const,
      };
      const newEntry = accountManager.investments.addEntry(entryWithCurrency);
      return { success: true, entry: newEntry };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Update an existing investment entry
  ipcMain.handle(IPC.INVESTMENTS_UPDATE, async (_event, id: string, updates: Partial<InvestmentEntry>) => {
    try {
      const sanitizedUpdates: Partial<InvestmentEntry> = {
        ...updates,
        ...(updates.currency ? { currency: 'EUR' } : {}),
      };
      const updated = accountManager.investments.updateEntry(id, sanitizedUpdates);
      if (!updated) return { success: false, error: 'Entry not found' };
      return { success: true, entry: updated };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Remove an investment entry
  ipcMain.handle(IPC.INVESTMENTS_REMOVE, async (_event, id: string) => {
    try {
      const removed = accountManager.investments.removeEntry(id);
      return { success: removed, error: removed ? undefined : 'Entry not found' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Clear all investment entries for the current account
  ipcMain.handle(IPC.INVESTMENTS_CLEAR, async () => {
    try {
      accountManager.investments.clearAll();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ---- Exchange Rates ----

  // Get current exchange rates
  ipcMain.handle(IPC.EXCHANGE_RATES_GET, async () => {
    try {
      const rates = await accountManager.exchangeRates.getRates();
      return { success: true, rates };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Convert an amount between currencies
  ipcMain.handle(IPC.EXCHANGE_RATES_CONVERT, async (_event, amount: number, from: string, to: string) => {
    try {
      if (String(from).toUpperCase() !== 'USD' || String(to).toUpperCase() !== 'EUR') {
        throw new Error('Only USD->EUR conversion is supported for legacy investment entries');
      }
      const converted = await accountManager.exchangeRates.convert(amount, 'USD', 'EUR');
      return { success: true, converted };
    } catch (err: any) {
      return { success: false, error: err.message, converted: amount };
    }
  });
}
