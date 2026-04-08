// ============================================================
// CSInventoryPorter — Customization Panel (slide-out drawer)
// Floating theme customisation overlay accessible from any page.
// ============================================================

import { useState } from 'react';
import { useTheme, THEME_PRESETS, type ThemeConfig } from '../hooks/useTheme';

interface Props {
  open: boolean;
  onClose: () => void;
}

// ── Inline color swatch + picker ─────────────────────────────

/**
 * Color swatch.
 *
 * Characteristics:
 * - @param { label, value, onChange } - The parameter for { label, value, onChange }
 * - @returns React.JSX.Element
 *
 */
function ColorSwatch({ label, value, onChange }: { label: string; value: string; onChange: (c: string) => void }) {
  return (
    <label className="flex items-center gap-2.5 group cursor-pointer">
      <div className="relative">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        <div
          className="w-8 h-8 rounded-md border border-slate-600 group-hover:border-slate-400 transition-colors shadow-inner"
          style={{ backgroundColor: value }}
        />
      </div>
      <div className="flex flex-col">
        <span className="text-xs text-slate-200 leading-tight">{label}</span>
        <span className="text-[10px] text-slate-500 font-mono uppercase">{value}</span>
      </div>
    </label>
  );
}

// ── Mini preset preview card ─────────────────────────────────

/**
 * Mini preset.
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
function MiniPreset({
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
      className={`relative flex flex-col rounded-lg overflow-hidden border-2 transition-all ${
        isActive ? 'border-white shadow-lg scale-[1.03]' : 'border-transparent hover:border-slate-500'
      }`}
      style={{ width: 100 }}
    >
      {/* Mini preview */}
      <div className="h-14 p-1.5 flex flex-col gap-0.5" style={{ backgroundColor: config.bgPrimary }}>
        <div className="h-2 rounded-sm flex items-center gap-0.5 px-0.5" style={{ backgroundColor: config.bgSurface }}>
          <div className="w-3 h-1" style={{ backgroundColor: config.accent, borderRadius: 2 }} />
          <div className="w-2 h-1" style={{ backgroundColor: config.bgCard, borderRadius: 2 }} />
        </div>
        <div className="flex gap-0.5 flex-1">
          <div className="flex-1 rounded-sm" style={{ backgroundColor: config.bgSurface }} />
          <div className="flex-1 rounded-sm" style={{ backgroundColor: config.bgSurface }} />
        </div>
      </div>
      {/* Label */}
      <div
        className="py-1 text-center text-[10px] font-medium"
        style={{ backgroundColor: config.bgSurface, color: config.accentLight }}
      >
        {name}
      </div>
      {isActive && (
        <div
          className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px]"
          style={{ backgroundColor: config.accent }}
        >
          ✓
        </div>
      )}
    </button>
  );
}

// ── Main Drawer ──────────────────────────────────────────────

/**
 * Customization panel.
 *
 * Characteristics:
 * - @param { open, onClose } - The parameter for { open, onClose }
 * - @returns React.JSX.Element
 *
 */
export default function CustomizationPanel({ open, onClose }: Props) {
  const { theme, setTheme, selectPreset, resetTheme } = useTheme();
  const [showCustom, setShowCustom] = useState(theme.preset === 'custom');

  const isCustom = theme.preset === 'custom' || !THEME_PRESETS[theme.preset];

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 z-50 h-full w-80 shadow-2xl flex flex-col transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ backgroundColor: 'var(--sp-surface)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ borderBottom: '1px solid var(--sp-card)' }}
        >
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
            Customization
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors p-1 rounded-md hover:bg-slate-700/50"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {/* ── Presets ── */}
          <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Theme Presets</h4>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(THEME_PRESETS).map(([name, config]) => (
                <MiniPreset
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
          </div>

          {/* ── Custom Colors Toggle ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Custom Colors</h4>
              <button
                onClick={() => setShowCustom(!showCustom)}
                className="text-[11px] px-2.5 py-1 rounded-md transition-colors"
                style={{
                  backgroundColor: showCustom ? 'var(--sp-accent)' : 'var(--sp-card)',
                  color: showCustom ? 'white' : '#94a3b8',
                }}
              >
                {showCustom ? 'Editing' : 'Customize'}
              </button>
            </div>

            {showCustom && (
              <div className="space-y-3">
                <p className="text-[10px] text-slate-500">
                  Changes are applied instantly and saved automatically.
                </p>
                <div className="grid grid-cols-1 gap-2.5">
                  <ColorSwatch label="Background" value={theme.bgPrimary} onChange={(c) => setTheme({ bgPrimary: c })} />
                  <ColorSwatch label="Surface" value={theme.bgSurface} onChange={(c) => setTheme({ bgSurface: c })} />
                  <ColorSwatch label="Card / Border" value={theme.bgCard} onChange={(c) => setTheme({ bgCard: c })} />
                  <ColorSwatch label="Accent" value={theme.accent} onChange={(c) => setTheme({ accent: c })} />
                  <ColorSwatch label="Accent Hover" value={theme.accentHover} onChange={(c) => setTheme({ accentHover: c })} />
                  <ColorSwatch label="Accent Light" value={theme.accentLight} onChange={(c) => setTheme({ accentLight: c })} />
                </div>

                <button
                  onClick={resetTheme}
                  className="text-xs px-3 py-1.5 rounded-md text-slate-300 hover:text-white transition-colors"
                  style={{ backgroundColor: 'var(--sp-card)' }}
                >
                  Reset to Default
                </button>

                {isCustom && (
                  <span className="text-[10px] text-slate-500 italic block">Using custom theme</span>
                )}
              </div>
            )}
          </div>

          {/* ── Live Mini Preview ── */}
          <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Preview</h4>
            <div className="rounded-lg p-3 space-y-2" style={{ backgroundColor: 'var(--sp-bg)' }}>
              {/* Fake navbar */}
              <div
                className="rounded px-2.5 py-1 flex items-center gap-1.5"
                style={{ backgroundColor: 'var(--sp-surface)', border: '1px solid var(--sp-card)' }}
              >
                <span className="text-[10px] font-bold" style={{ color: 'var(--sp-accent-light)' }}>CSInventoryPorter</span>
                <div className="flex gap-0.5 ml-auto">
                  <span className="px-2 py-0.5 rounded text-[9px] text-white" style={{ backgroundColor: 'var(--sp-accent)' }}>Active</span>
                  <span className="px-2 py-0.5 rounded text-[9px] text-slate-400" style={{ backgroundColor: 'var(--sp-card)' }}>Tab</span>
                </div>
              </div>
              {/* Fake cards */}
              <div className="grid grid-cols-2 gap-1.5">
                {[1, 2].map((i) => (
                  <div key={i} className="rounded p-2 space-y-1" style={{ backgroundColor: 'var(--sp-surface)' }}>
                    <div className="h-1.5 w-10 rounded" style={{ backgroundColor: 'var(--sp-card)' }} />
                    <div className="h-4 rounded" style={{ backgroundColor: 'var(--sp-card)' }} />
                    <div className="h-1.5 w-8 rounded" style={{ backgroundColor: 'var(--sp-accent)', opacity: 0.6 }} />
                  </div>
                ))}
              </div>
              {/* Fake buttons */}
              <div className="flex gap-1.5">
                <span className="px-2.5 py-1 rounded text-[10px] text-white" style={{ backgroundColor: 'var(--sp-accent)' }}>Primary</span>
                <span className="px-2.5 py-1 rounded text-[10px] text-slate-300" style={{ backgroundColor: 'var(--sp-card)' }}>Secondary</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-4 py-3 shrink-0 flex items-center justify-between"
          style={{ borderTop: '1px solid var(--sp-card)' }}
        >
          <span className="text-[10px] text-slate-500">Saved automatically</span>
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md text-white transition-colors"
            style={{ backgroundColor: 'var(--sp-accent)' }}
          >
            Done
          </button>
        </div>
      </div>
    </>
  );
}
