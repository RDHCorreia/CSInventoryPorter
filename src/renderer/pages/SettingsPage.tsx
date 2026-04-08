// ============================================================
// CSInventoryPorter — Settings Page
// Theme customization with presets and custom color pickers.
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import type { AuthState } from '../hooks/useAuth';
import { useTheme, THEME_PRESETS, DEFAULT_THEME, type ThemeConfig } from '../hooks/useTheme';
import NavBar from '../components/NavBar';
import type { AppPage } from '../utils/itemUtils';

const api = (window as any).csinventoryporter;

interface Props {
  auth: { status: AuthState['status']; logout: () => void };
  onNavigate: (page: AppPage) => void;
}

// ── Color swatch with label ──────────────────────────────────

/**
 * Color picker.
 *
 * Characteristics:
 * - @param {
 *   label,
 *   value,
 *   onChange,
 * } - The parameter for {
 *   label,
 *   value,
 *   onChange,
 * }
 * - @returns React.JSX.Element
 *
 */
function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <label className="flex items-center gap-3 group cursor-pointer">
      <div className="relative">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        <div
          className="w-10 h-10 rounded-lg border-2 border-slate-600 group-hover:border-slate-400 transition-colors shadow-inner"
          style={{ backgroundColor: value }}
        />
      </div>
      <div className="flex flex-col">
        <span className="text-sm text-slate-200">{label}</span>
        <span className="text-xs text-slate-500 font-mono uppercase">{value}</span>
      </div>
    </label>
  );
}

// ── Preset card ──────────────────────────────────────────────

/**
 * Preset card.
 *
 * Characteristics:
 * - @param {
 *   name,
 *   config,
 *   isActive,
 *   onClick,
 * } - The parameter for {
 *   name,
 *   config,
 *   isActive,
 *   onClick,
 * }
 * - @returns React.JSX.Element
 *
 */
function PresetCard({
  name,
  config,
  isActive,
  onClick,
}: {
  name: string;
  config: ThemeConfig;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col rounded-xl overflow-hidden border-2 transition-all ${
        isActive ? 'border-white shadow-lg scale-105' : 'border-transparent hover:border-slate-500'
      }`}
      style={{ width: 140 }}
    >
      {/* Mini preview */}
      <div className="h-20 p-2 flex flex-col gap-1" style={{ backgroundColor: config.bgPrimary }}>
        {/* Fake navbar */}
        <div className="h-3 rounded-sm flex items-center gap-1 px-1" style={{ backgroundColor: config.bgSurface }}>
          <div className="w-4 h-1.5 rounded-sm" style={{ backgroundColor: config.accent }} />
          <div className="w-3 h-1.5 rounded-sm" style={{ backgroundColor: config.bgCard }} />
          <div className="w-3 h-1.5 rounded-sm" style={{ backgroundColor: config.bgCard }} />
        </div>
        {/* Fake content cards */}
        <div className="flex gap-1 flex-1">
          <div className="flex-1 rounded-sm" style={{ backgroundColor: config.bgSurface }} />
          <div className="flex-1 rounded-sm" style={{ backgroundColor: config.bgSurface }} />
        </div>
      </div>
      {/* Label */}
      <div className="py-1.5 text-center text-xs font-medium" style={{ backgroundColor: config.bgSurface, color: config.accentLight }}>
        {name}
      </div>
      {/* Active check */}
      {isActive && (
        <div className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center text-white text-xs" style={{ backgroundColor: config.accent }}>
          ✓
        </div>
      )}
    </button>
  );
}

// ── Price Server configuration section ───────────────────────

interface PriceServerForm {
  enabled: boolean;
  url: string;
  apiKey: string;
}

const DEFAULT_PRICE_SERVER: PriceServerForm = {
  enabled: false,
  url: 'http://localhost:3456',
  apiKey: '',
};

/**
 * Price server section.
 *
 * Characteristics:
 * - @returns React.JSX.Element
 *
 */
function PriceServerSection() {
  const [form, setForm] = useState<PriceServerForm>(DEFAULT_PRICE_SERVER);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    totalPrices?: number;
    latencyMs?: number;
    error?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api?.getPriceServerConfig?.().then((cfg: any) => {
      if (cfg) {
        setForm({
          enabled: cfg.enabled ?? false,
          url: cfg.url ?? 'http://localhost:3456',
          apiKey: cfg.apiKey ?? '',
        });
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const buildConfig = useCallback(() => ({
    enabled: form.enabled,
    url: form.url.trim().replace(/\/+$/, ''),
    ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
  }), [form]);

  const handleSave = useCallback(async () => {
    setSaved(false);
    setTestResult(null);
    try {
      await api?.setPriceServerConfig?.(buildConfig());
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { /* ignore */ }
  }, [buildConfig]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api?.testPriceServer?.(buildConfig());
      setTestResult(result);
    } catch (err: any) {
      setTestResult({ success: false, error: err?.message ?? 'Unknown error' });
    } finally {
      setTesting(false);
    }
  }, [buildConfig]);

  const update = (patch: Partial<PriceServerForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setSaved(false);
    setTestResult(null);
  };

  if (loading) {
    return (
      <section className="rounded-xl p-6" style={{ backgroundColor: 'var(--sp-surface)' }}>
        <h3 className="text-lg font-semibold text-white mb-4">Price Server</h3>
        <p className="text-sm text-slate-400">Loading…</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl p-6" style={{ backgroundColor: 'var(--sp-surface)' }}>
      <h3 className="text-lg font-semibold text-white mb-1">Price Server</h3>
      <p className="text-xs text-slate-400 mb-5">
        Connect to your own price scraper server to get prices instantly without hitting Steam rate limits.
      </p>

      {/* Enable toggle */}
      <label className="flex items-center gap-3 cursor-pointer mb-5">
        <button
          onClick={() => update({ enabled: !form.enabled })}
          className={`relative w-11 h-6 rounded-full transition-colors ${
            form.enabled ? '' : 'bg-slate-600'
          }`}
          style={form.enabled ? { backgroundColor: 'var(--sp-accent)' } : undefined}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              form.enabled ? 'translate-x-5' : ''
            }`}
          />
        </button>
        <span className="text-sm text-slate-200">Enable Price Server</span>
      </label>

      {form.enabled && (
        <div className="space-y-4">
          {/* URL */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Server URL</label>
            <input
              type="text"
              placeholder="http://localhost:3456"
              value={form.url}
              onChange={(e) => update({ url: e.target.value })}
              className="w-full px-3 py-2 rounded-lg text-sm text-slate-200 placeholder-slate-500 outline-none focus:ring-1"
              style={{ backgroundColor: 'var(--sp-card)' }}
            />
          </div>

          {/* API Key */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">API Key</label>
            <input
              type="password"
              placeholder="Required by most price-server deployments"
              value={form.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
              className="w-full px-3 py-2 rounded-lg text-sm text-slate-200 placeholder-slate-500 outline-none focus:ring-1"
              style={{ backgroundColor: 'var(--sp-card)' }}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={!form.url.trim()}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-40"
              style={{ backgroundColor: 'var(--sp-accent)' }}
            >
              Save
            </button>
            <button
              onClick={handleTest}
              disabled={!form.url.trim() || testing}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white transition-colors disabled:opacity-40"
              style={{ backgroundColor: 'var(--sp-card)' }}
            >
              {testing ? 'Testing…' : 'Test Connection'}
            </button>

            {saved && <span className="text-xs text-green-400 font-medium">✓ Saved</span>}
          </div>

          {/* Test result */}
          {testResult && (
            <div
              className={`rounded-lg px-4 py-3 text-sm ${
                testResult.success
                  ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                  : 'bg-red-500/10 text-red-400 border border-red-500/20'
              }`}
            >
              {testResult.success ? (
                <>✓ Connected — {testResult.totalPrices} prices cached, latency: {testResult.latencyMs}ms</>
              ) : (
                <>✗ Connection failed: {testResult.error}</>
              )}
            </div>
          )}

          {/* Info */}
          <div className="rounded-lg px-4 py-3 text-xs text-blue-400/80 bg-blue-500/5 border border-blue-500/10">
            <strong>How it works:</strong> When fetching prices, the app first tries your server.
            Items found there are loaded instantly. Missing items are queued on the server for scraping
            and fetched directly from Steam as a fallback.
          </div>
        </div>
      )}
    </section>
  );
}

// ── Settings Page ────────────────────────────────────────────

/**
 * Settings page.
 *
 * Characteristics:
 * - @param { auth, onNavigate } - The parameter for { auth, onNavigate }
 * - @returns React.JSX.Element
 *
 */
export default function SettingsPage({ auth, onNavigate }: Props) {
  const { status, logout } = auth;
  const { theme, setTheme, selectPreset, resetTheme } = useTheme();
  const [showCustom, setShowCustom] = useState(theme.preset === 'custom');

  const isCustom = theme.preset === 'custom' || !THEME_PRESETS[theme.preset];

  return (
    <>
      <NavBar activePage="settings" onNavigate={onNavigate} status={status} onLogout={logout} />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-8">
          {/* ── Header ── */}
          <div>
            <h2 className="text-2xl font-bold text-white">Settings</h2>
            <p className="text-sm text-slate-400 mt-1">Customize how CSInventoryPorter looks and feels.</p>
          </div>

          {/* ── Theme Presets ── */}
          <section className="rounded-xl p-6" style={{ backgroundColor: 'var(--sp-surface)' }}>
            <h3 className="text-lg font-semibold text-white mb-4">Theme Presets</h3>
            <div className="flex flex-wrap gap-4">
              {Object.entries(THEME_PRESETS).map(([name, config]) => (
                <PresetCard
                  key={name}
                  name={name}
                  config={config}
                  isActive={theme.preset === name}
                  onClick={() => {
                    selectPreset(name);
                    setShowCustom(false);
                  }}
                />
              ))}
            </div>
          </section>

          {/* ── Custom Colors ── */}
          <section className="rounded-xl p-6" style={{ backgroundColor: 'var(--sp-surface)' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Custom Colors</h3>
              <button
                onClick={() => setShowCustom(!showCustom)}
                className="text-sm px-3 py-1 rounded-lg transition-colors"
                style={{
                  backgroundColor: showCustom ? 'var(--sp-accent)' : 'var(--sp-card)',
                  color: showCustom ? 'white' : '#94a3b8',
                }}
              >
                {showCustom ? 'Editing' : 'Customize'}
              </button>
            </div>

            {showCustom && (
              <div className="space-y-6">
                <p className="text-xs text-slate-400">
                  Pick your own colors. Changes are applied instantly and saved automatically.
                </p>

                <div className="grid grid-cols-2 gap-6">
                  <ColorPicker
                    label="Background"
                    value={theme.bgPrimary}
                    onChange={(c) => setTheme({ bgPrimary: c })}
                  />
                  <ColorPicker
                    label="Surface"
                    value={theme.bgSurface}
                    onChange={(c) => setTheme({ bgSurface: c })}
                  />
                  <ColorPicker
                    label="Card / Border"
                    value={theme.bgCard}
                    onChange={(c) => setTheme({ bgCard: c })}
                  />
                  <ColorPicker
                    label="Accent"
                    value={theme.accent}
                    onChange={(c) => setTheme({ accent: c })}
                  />
                  <ColorPicker
                    label="Accent Hover"
                    value={theme.accentHover}
                    onChange={(c) => setTheme({ accentHover: c })}
                  />
                  <ColorPicker
                    label="Accent Light"
                    value={theme.accentLight}
                    onChange={(c) => setTheme({ accentLight: c })}
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={resetTheme}
                    className="text-sm px-4 py-2 rounded-lg text-slate-300 hover:text-white transition-colors"
                    style={{ backgroundColor: 'var(--sp-card)' }}
                  >
                    Reset to Default
                  </button>
                  {isCustom && (
                    <span className="text-xs text-slate-500 italic">Using custom theme</span>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* ── Price Server ── */}
          <PriceServerSection />

          {/* ── Live Preview ── */}
          <section className="rounded-xl p-6" style={{ backgroundColor: 'var(--sp-surface)' }}>
            <h3 className="text-lg font-semibold text-white mb-4">Preview</h3>
            <div className="rounded-lg p-4 space-y-3" style={{ backgroundColor: 'var(--sp-bg)' }}>
              {/* Fake navbar preview */}
              <div
                className="rounded-lg px-4 py-2 flex items-center gap-2"
                style={{ backgroundColor: 'var(--sp-surface)', border: '1px solid var(--sp-card)' }}
              >
                <span className="text-sm font-bold" style={{ color: 'var(--sp-accent-light)' }}>
                  CSInventoryPorter
                </span>
                <div className="flex gap-1 ml-4">
                  <span
                    className="px-3 py-1 rounded text-xs text-white"
                    style={{ backgroundColor: 'var(--sp-accent)' }}
                  >
                    Active
                  </span>
                  <span
                    className="px-3 py-1 rounded text-xs text-slate-400"
                    style={{ backgroundColor: 'var(--sp-card)' }}
                  >
                    Tab
                  </span>
                  <span
                    className="px-3 py-1 rounded text-xs text-slate-400"
                    style={{ backgroundColor: 'var(--sp-card)' }}
                  >
                    Tab
                  </span>
                </div>
              </div>

              {/* Fake content cards */}
              <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="rounded-lg p-3 space-y-2"
                    style={{ backgroundColor: 'var(--sp-surface)' }}
                  >
                    <div className="h-2 w-16 rounded" style={{ backgroundColor: 'var(--sp-card)' }} />
                    <div className="h-6 rounded" style={{ backgroundColor: 'var(--sp-card)' }} />
                    <div
                      className="h-2 w-12 rounded text-xs"
                      style={{ backgroundColor: 'var(--sp-accent)', opacity: 0.6 }}
                    />
                  </div>
                ))}
              </div>

              {/* Fake button row */}
              <div className="flex gap-2 pt-1">
                <button
                  className="px-4 py-1.5 rounded-lg text-sm text-white transition-colors"
                  style={{ backgroundColor: 'var(--sp-accent)' }}
                >
                  Primary Button
                </button>
                <button
                  className="px-4 py-1.5 rounded-lg text-sm text-slate-300 transition-colors"
                  style={{ backgroundColor: 'var(--sp-card)' }}
                >
                  Secondary
                </button>
              </div>
            </div>
          </section>

          {/* ── About ── */}
          <section className="rounded-xl p-6" style={{ backgroundColor: 'var(--sp-surface)' }}>
            <h3 className="text-lg font-semibold text-white mb-2">About</h3>
            <p className="text-sm text-slate-400">
              CSInventoryPorter — CS2 inventory management tool.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Theme preferences are saved locally and persist across sessions.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
