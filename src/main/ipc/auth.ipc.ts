// ============================================================
// CSInventoryPorter — Auth IPC handlers
// Bridges renderer ↔ main process for authentication
// ============================================================

import { ipcMain, type BrowserWindow } from 'electron';
import { AccountManager } from '../services/AccountManager';
import { IPC } from '../../shared/types';

/**
 * Register auth i p c.
 *
 * Characteristics:
 * - @param accountManager - The parameter for accountManager
 * - @param getMainWindow - The parameter for getMainWindow
 * - @returns Nothing (void)
 *
 */
export function registerAuthIPC(
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

  accountManager.onStatusChanged((status) => {
    sendToRenderer(IPC.AUTH_STATUS_CHANGED, status);
  });

  accountManager.onSteamGuard((request) => {
    sendToRenderer(IPC.AUTH_STEAM_GUARD, request);
  });

  accountManager.onQRUpdate((status) => {
    sendToRenderer(IPC.AUTH_QR_UPDATE, status);
  });

  // ---- Handle requests from renderer ----

  // Login with credentials, refresh token, or browser token
  ipcMain.handle(IPC.AUTH_LOGIN, async (_event, details) => {
    try {
      await accountManager.login(details);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Submit Steam Guard code
  ipcMain.on(IPC.AUTH_SUBMIT_STEAM_GUARD, (_event, code: string) => {
    accountManager.submitSteamGuardCode(code);
  });

  // Logout
  ipcMain.handle(IPC.AUTH_LOGOUT, async () => {
    accountManager.logout();
    return { success: true };
  });

  // Start QR code login
  ipcMain.handle(IPC.AUTH_QR_START, async () => {
    try {
      const status = await accountManager.startQRLogin();
      return { success: true, ...status };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Cancel QR code login
  ipcMain.on(IPC.AUTH_QR_CANCEL, () => {
    accountManager.cancelQRLogin();
  });

  // Get current connection status
  ipcMain.handle(IPC.AUTH_STATUS, async () => {
    const steam = accountManager.steam;
    return {
      state: steam.state,
      accountName: steam.accountInfo?.accountName,
      personaName: steam.accountInfo?.personaName,
      steamID: steam.accountInfo?.steamID,
    };
  });

  // ---- Account management ----

  // List saved accounts
  ipcMain.handle(IPC.ACCOUNTS_LIST, async () => {
    return accountManager.listAccounts();
  });

  // Login with a saved account
  ipcMain.handle(IPC.ACCOUNTS_GET, async (_event, steamID: string) => {
    try {
      await accountManager.loginWithSavedAccount(steamID);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Remove a saved account
  ipcMain.handle(IPC.ACCOUNTS_REMOVE, async (_event, steamID: string) => {
    return { success: accountManager.removeAccount(steamID) };
  });

  // ---- Multi-account (Phase 5) ----

  // Switch to a different saved account
  ipcMain.handle(IPC.ACCOUNTS_SWITCH, async (_event, steamID: string) => {
    try {
      await accountManager.switchAccount(steamID);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Get combined portfolio data for all accounts
  ipcMain.handle(IPC.ACCOUNTS_MULTI_SUMMARY, async () => {
    return accountManager.getCombinedPortfolioData();
  });

  // Manually save current account snapshot
  ipcMain.on(IPC.ACCOUNTS_SAVE_SNAPSHOT, () => {
    accountManager.saveCurrentSnapshot();
  });
}
