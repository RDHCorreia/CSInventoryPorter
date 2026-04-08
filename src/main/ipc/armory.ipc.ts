
import { ipcMain, type BrowserWindow } from 'electron';
import { AccountManager } from '../services/AccountManager';
import { IPC } from '../../shared/types';

/**
 * Register armory i p c.
 *
 * Characteristics:
 * - @param accountManager - The parameter for accountManager
 * - @param getMainWindow - The parameter for getMainWindow
 * - @returns Nothing (void)
 *
 */
export function registerArmoryIPC(
  accountManager: AccountManager,
  getMainWindow: () => BrowserWindow | null,
): void {
  const sendToRenderer = (channel: string, ...args: any[]) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  };

  accountManager.onArmoryProgress((progress) => {
    sendToRenderer(IPC.ARMORY_PROGRESS, progress);
  });

  ipcMain.handle(IPC.ARMORY_GET_DATA, async () => {
    try {
      return { success: true, data: accountManager.getArmoryData() };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(IPC.ARMORY_REDEEM, async (_event, armoryId: number, count?: number) => {
    try {
      return await accountManager.redeemArmoryItem(armoryId, count);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}
