// ============================================================
// CSInventoryPorter — InvestmentService
// Persists user investment entries (purchased items) to disk.
// Single global file — shared across all accounts.
// ============================================================

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { InvestmentEntry } from '../../shared/types';

interface InvestmentFile {
  version: number;
  entries: InvestmentEntry[];
}

const FILE_VERSION = 1;
const INVESTMENTS_FILENAME = 'investments.json';

export class InvestmentService {
  private filePath: string;
  private entries: InvestmentEntry[] = [];

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, INVESTMENTS_FILENAME);
    this.loadFromDisk();
  }

  // ---- CRUD ----

  /** Get all entries */
  getEntries(): InvestmentEntry[] {
    return [...this.entries];
  }

  /** Add a new investment entry */
  addEntry(entry: Omit<InvestmentEntry, 'id' | 'createdAt'>): InvestmentEntry {
    const newEntry: InvestmentEntry = {
      ...entry,
      id: randomUUID(),
      createdAt: Date.now(),
    };
    this.entries.push(newEntry);
    this.saveToDisk();
    return newEntry;
  }

  /** Update an existing entry */
  updateEntry(id: string, updates: Partial<Omit<InvestmentEntry, 'id' | 'createdAt'>>): InvestmentEntry | null {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    this.entries[idx] = { ...this.entries[idx], ...updates };
    this.saveToDisk();
    return this.entries[idx];
  }

  /** Remove an entry by ID */
  removeEntry(id: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length < before) {
      this.saveToDisk();
      return true;
    }
    return false;
  }

  /** Clear all entries */
  clearAll(): void {
    this.entries = [];
    this.saveToDisk();
  }

  // ---- Persistence ----

  /**
     * Loads from disk.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data: InvestmentFile = JSON.parse(raw);
        if (data.version === FILE_VERSION && Array.isArray(data.entries)) {
          this.entries = data.entries;
        }
      }
    } catch (err) {
      console.error('[InvestmentService] Failed to load investments:', err);
    }
    console.log(`[InvestmentService] Loaded ${this.entries.length} investment entries`);
  }

  /**
     * Save to disk.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    private saveToDisk(): void {
    try {
      const data: InvestmentFile = {
        version: FILE_VERSION,
        entries: this.entries,
      };
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[InvestmentService] Failed to save investments:', err);
    }
  }
}
