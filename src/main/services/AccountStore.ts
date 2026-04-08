// ============================================================
// CSInventoryPorter — AccountStore
// Persists saved accounts with encrypted refresh tokens
// Uses Electron's safeStorage for encryption
// ============================================================

import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import { type SavedAccount } from '../../shared/types';
import { ACCOUNTS_FILE } from '../../shared/constants';

interface StoredAccount {
  accountName: string;
  steamID: string;
  personaName: string;
  avatarHash?: string;
  /** Base64-encoded encrypted refresh token */
  encryptedRefreshToken?: string;
  lastLogin?: number;
}

export class AccountStore {
  private filePath: string;
  private accounts: Map<string, StoredAccount> = new Map();

  constructor() {
    this.filePath = path.join(app.getPath('userData'), ACCOUNTS_FILE);
    this.load();
  }

  // ---- Persistence ----

  /**
     * Loads.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data: StoredAccount[] = JSON.parse(raw);
        let cleaned = 0;
        for (const account of data) {
          // Validate steamID: must be a numeric string (Steam64 IDs are 17-digit numbers).
          // Skip bogus entries created by previous QR login bug where refresh token
          // was accidentally stored as the steamID.
          if (!account.steamID || !/^\d{10,20}$/.test(account.steamID)) {
            console.warn(`[AccountStore] Removing invalid account entry (bad steamID: ${account.steamID?.substring(0, 20)}...)`);
            cleaned++;
            continue;
          }
          this.accounts.set(account.steamID, account);
        }
        console.log(`[AccountStore] Loaded ${this.accounts.size} saved account(s)${cleaned ? ` (removed ${cleaned} invalid)` : ''}`);
        if (cleaned > 0) this.save(); // Persist the cleanup
      }
    } catch (err) {
      console.error('[AccountStore] Failed to load accounts:', err);
    }
  }

  /**
     * Save.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    private save(): void {
    try {
      const data = Array.from(this.accounts.values());
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[AccountStore] Failed to save accounts:', err);
    }
  }

  // ---- Encryption helpers ----

  /**
     * Encrypt token.
     *
     * Characteristics:
     * - @param token - The parameter for token
     * - @returns string
     *
     */
    private encryptToken(token: string): string | undefined {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(token);
        return encrypted.toString('base64');
      }
      // Fallback: store as plain base64 (not ideal, but functional)
      console.warn('[AccountStore] Encryption not available, storing token in base64');
      return Buffer.from(token, 'utf-8').toString('base64');
    } catch (err) {
      console.error('[AccountStore] Failed to encrypt token:', err);
      return undefined;
    }
  }

  /**
     * Decrypt token.
     *
     * Characteristics:
     * - @param encrypted - The parameter for encrypted
     * - @returns string
     *
     */
    private decryptToken(encrypted: string): string | undefined {
    try {
      const buf = Buffer.from(encrypted, 'base64');
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(buf);
      }
      // Fallback: plain base64
      return buf.toString('utf-8');
    } catch (err) {
      console.error('[AccountStore] Failed to decrypt token:', err);
      return undefined;
    }
  }

  // ---- Public API ----

  /** List all saved accounts (without exposing raw refresh tokens) */
  listAccounts(): SavedAccount[] {
    return Array.from(this.accounts.values()).map((a) => ({
      accountName: a.accountName,
      steamID: a.steamID,
      personaName: a.personaName,
      avatarHash: a.avatarHash,
      refreshToken: a.encryptedRefreshToken ? '(saved)' : undefined,
      lastLogin: a.lastLogin,
    }));
  }

  /** Get a single account by steamID, decrypting the refresh token */
  getAccount(steamID: string): SavedAccount | null {
    const stored = this.accounts.get(steamID);
    if (!stored) return null;

    return {
      accountName: stored.accountName,
      steamID: stored.steamID,
      personaName: stored.personaName,
      avatarHash: stored.avatarHash,
      refreshToken: stored.encryptedRefreshToken
        ? this.decryptToken(stored.encryptedRefreshToken)
        : undefined,
      lastLogin: stored.lastLogin,
    };
  }

  /** Save (add or update) an account */
  saveAccount(
    account: Omit<SavedAccount, 'refreshToken'> & { refreshToken?: string },
  ): void {
    const stored: StoredAccount = {
      accountName: account.accountName,
      steamID: account.steamID,
      personaName: account.personaName,
      avatarHash: account.avatarHash,
      encryptedRefreshToken: account.refreshToken
        ? this.encryptToken(account.refreshToken)
        : this.accounts.get(account.steamID)?.encryptedRefreshToken,
      lastLogin: Date.now(),
    };

    this.accounts.set(account.steamID, stored);
    this.save();
    console.log(`[AccountStore] Saved account ${account.accountName} (${account.steamID})`);
  }

  /** Update the refresh token for an existing account */
  updateRefreshToken(steamID: string, refreshToken: string): void {
    const existing = this.accounts.get(steamID);
    if (existing) {
      existing.encryptedRefreshToken = this.encryptToken(refreshToken);
      existing.lastLogin = Date.now();
      this.accounts.set(steamID, existing);
      this.save();
      console.log(`[AccountStore] Updated refresh token for ${existing.accountName}`);
    }
  }

  /** Remove a saved account */
  removeAccount(steamID: string): boolean {
    const existed = this.accounts.delete(steamID);
    if (existed) {
      this.save();
      console.log(`[AccountStore] Removed account ${steamID}`);
    }
    return existed;
  }

  /** Check if we have a saved refresh token for an account */
  hasRefreshToken(steamID: string): boolean {
    return !!this.accounts.get(steamID)?.encryptedRefreshToken;
  }
}
