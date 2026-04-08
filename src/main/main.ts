// ============================================================
// CSInventoryPorter — Main process entry point
// ============================================================

import { app, BrowserWindow, shell, ipcMain } from 'electron';
import path from 'path';
import { AccountManager } from './services/AccountManager';
import { registerAuthIPC } from './ipc/auth.ipc';
import { registerInventoryIPC } from './ipc/inventory.ipc';
import { registerPricingIPC } from './ipc/pricing.ipc';
import { registerMarketIPC } from './ipc/market.ipc';
import { registerTradeIPC } from './ipc/trade.ipc';
import { registerInvestmentIPC } from './ipc/investment.ipc';
import { registerTradeupIPC } from './ipc/tradeup.ipc';
import { registerArmoryIPC } from './ipc/armory.ipc';

let mainWindow: BrowserWindow | null = null;
let accountManager: AccountManager;

/**
 * Create window.
 *
 * Characteristics:
 * - @returns Nothing (void)
 *
 */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'CSInventoryPorter',
    backgroundColor: '#0f172a', // slate-900
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false, // Needed for steam-user native modules
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Show window when ready to prevent visual flash
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Load renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    // Dev: vite dev server
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    // Prod: built files
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Register window IPC controls
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.on('window:close', () => mainWindow?.close());
}

// ---- App lifecycle ----

app.whenReady().then(() => {
  // Initialize account manager (SteamService + AccountStore)
  accountManager = new AccountManager();

  // Register IPC handlers
  registerAuthIPC(accountManager, () => mainWindow);
  registerInventoryIPC(accountManager, () => mainWindow);
  registerPricingIPC(accountManager, () => mainWindow);
  registerMarketIPC(accountManager, () => mainWindow);
  registerTradeIPC(accountManager, () => mainWindow);
  registerInvestmentIPC(accountManager, () => mainWindow);
  registerTradeupIPC(accountManager, () => mainWindow);
  registerArmoryIPC(accountManager, () => mainWindow);

  // Create the main window
  createWindow();

  app.on('activate', () => {
    // macOS: re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Cleanup Steam connection
  if (accountManager) {
    accountManager.destroy();
  }

  // On macOS, apps typically stay open until Cmd+Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (accountManager) {
    accountManager.destroy();
  }
});
