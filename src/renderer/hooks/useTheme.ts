// ============================================================
// CSInventoryPorter — useTheme hook
// Manages visual theme customization with CSS custom properties.
// Persists user preferences to localStorage.
// ============================================================

import { useState, useEffect, useCallback } from 'react';

// ---- Theme configuration ----

export interface ThemeConfig {
  preset: string;       // Preset name or 'custom'
  bgPrimary: string;    // Main page background (#0f172a)
  bgSurface: string;    // Header, sidebar, card backgrounds (#1e293b)
  bgCard: string;       // Borders, muted card backgrounds (#334155)
  accent: string;       // Active buttons, highlights (#2563eb)
  accentHover: string;  // Accent hover state (#3b82f6)
  accentLight: string;  // Accent text, links (#60a5fa)
}

const THEME_STORAGE_KEY = 'csinventoryporter-theme';

// ---- Theme presets ──────────────────────────────────────────

export const THEME_PRESETS: Record<string, ThemeConfig> = {
  'Dark Blue': {
    preset: 'Dark Blue',
    bgPrimary: '#0f172a',
    bgSurface: '#1e293b',
    bgCard: '#334155',
    accent: '#2563eb',
    accentHover: '#3b82f6',
    accentLight: '#60a5fa',
  },
  'Dark Gray': {
    preset: 'Dark Gray',
    bgPrimary: '#111827',
    bgSurface: '#1f2937',
    bgCard: '#374151',
    accent: '#6366f1',
    accentHover: '#818cf8',
    accentLight: '#a5b4fc',
  },
  'Midnight': {
    preset: 'Midnight',
    bgPrimary: '#020617',
    bgSurface: '#0f172a',
    bgCard: '#1e293b',
    accent: '#8b5cf6',
    accentHover: '#a78bfa',
    accentLight: '#c4b5fd',
  },
  'Ocean': {
    preset: 'Ocean',
    bgPrimary: '#0c1220',
    bgSurface: '#162032',
    bgCard: '#1e3044',
    accent: '#0ea5e9',
    accentHover: '#38bdf8',
    accentLight: '#7dd3fc',
  },
  'Forest': {
    preset: 'Forest',
    bgPrimary: '#0a1512',
    bgSurface: '#1a2e26',
    bgCard: '#2a4038',
    accent: '#10b981',
    accentHover: '#34d399',
    accentLight: '#6ee7b7',
  },
  'Rose': {
    preset: 'Rose',
    bgPrimary: '#1a0a14',
    bgSurface: '#2e1a26',
    bgCard: '#442a38',
    accent: '#e11d48',
    accentHover: '#f43f5e',
    accentLight: '#fb7185',
  },
};

export const DEFAULT_THEME = THEME_PRESETS['Dark Blue'];

// ---- CSS variable application ----

/**
 * Apply theme to d o m.
 *
 * Characteristics:
 * - @param theme - The parameter for theme
 * - @returns Nothing (void)
 *
 */
function applyThemeToDOM(theme: ThemeConfig): void {
  const root = document.documentElement;
  root.style.setProperty('--sp-bg', theme.bgPrimary);
  root.style.setProperty('--sp-surface', theme.bgSurface);
  root.style.setProperty('--sp-card', theme.bgCard);
  root.style.setProperty('--sp-accent', theme.accent);
  root.style.setProperty('--sp-accent-hover', theme.accentHover);
  root.style.setProperty('--sp-accent-light', theme.accentLight);
}

// ---- Hook ----

/**
 * Hook for theme.
 *
 * Characteristics:
 * - @returns { theme: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/renderer/hooks/useTheme").ThemeConfig; setTheme: (config: Partial<import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/renderer/hooks/useTheme").ThemeConfig>) => void; selectPreset: (presetName: string) => void; resetTheme: () => void; }
 *
 */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeConfig>(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved) {
        return { ...DEFAULT_THEME, ...JSON.parse(saved) };
      }
    } catch { /* ignore corrupt data */ }
    return DEFAULT_THEME;
  });

  // Apply CSS variables on mount and whenever theme changes
  useEffect(() => {
    applyThemeToDOM(theme);
  }, [theme]);

  /** Update one or more theme properties (merges into current) */
  const setTheme = useCallback((config: Partial<ThemeConfig>) => {
    setThemeState((prev) => {
      const next = { ...prev, ...config, preset: config.preset ?? 'custom' };
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  /** Switch to a named preset */
  const selectPreset = useCallback((presetName: string) => {
    const preset = THEME_PRESETS[presetName];
    if (preset) {
      setThemeState(preset);
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(preset));
    }
  }, []);

  /** Reset to default theme */
  const resetTheme = useCallback(() => {
    setThemeState(DEFAULT_THEME);
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(DEFAULT_THEME));
  }, []);

  return { theme, setTheme, selectPreset, resetTheme };
}
