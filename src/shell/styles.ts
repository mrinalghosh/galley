// Shell styles, injected once at startup. Kept in TS so the shell needs no CSS loader types.
export const styles = `
:root {
  --g-bg: #0e0f11;
  --g-stage: #0a0b0c;
  --g-panel: #16171a;
  --g-raised: #1f2125;
  --g-border: #2a2c31;
  --g-text: #e3e5e9;
  --g-muted: #8b9099;
  --g-accent: #8ab4ff;
  --g-accent-bg: rgba(138, 180, 255, 0.14);
  --g-warn: #f2c14e;
  --g-warn-bg: #2b2412;
  --g-danger: #f26b6b;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--g-bg); color: var(--g-text);
  font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
button, select { font: inherit; color: inherit; }
kbd { font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--g-muted); }

.g-shell { display: flex; flex-direction: column; height: 100vh; }

.g-toolbar { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 8px;
  background: var(--g-panel); border-bottom: 1px solid var(--g-border); flex: none; min-width: 0; }
.g-brand { font-weight: 600; letter-spacing: 0.02em; padding: 0 6px 0 4px; color: var(--g-text); }
.g-group { display: flex; align-items: center; gap: 2px; }
.g-group + .g-group, .g-brand + .g-group { padding-left: 8px; border-left: 1px solid var(--g-border); }

.g-btn { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 8px;
  background: transparent; border: 1px solid transparent; border-radius: 6px; cursor: pointer; color: var(--g-muted); position: relative; }
.g-btn:hover { background: var(--g-raised); color: var(--g-text); }
.g-btn:focus-visible, .g-target select:focus-visible { outline: 2px solid var(--g-accent); outline-offset: 1px; }
.g-btn[aria-pressed="true"] { background: var(--g-accent-bg); color: var(--g-accent); border-color: rgba(138, 180, 255, 0.35); }
.g-btn[aria-pressed="true"] kbd { color: var(--g-accent); }
.g-icon { flex: none; }

.g-badge { min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--g-danger); color: #fff;
  font-size: 10px; font-weight: 600; line-height: 16px; text-align: center; }

.g-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center;
  color: var(--g-muted); font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }

.g-target { display: flex; align-items: center; gap: 6px; color: var(--g-muted); font-size: 12px; }
.g-target select { height: 28px; padding: 0 6px; background: var(--g-raised); border: 1px solid var(--g-border);
  border-radius: 6px; color: var(--g-text); max-width: 160px; }

.g-seg { padding: 0 7px; font-size: 12px; font-variant-numeric: tabular-nums; }

.g-banner { display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 12px; flex: none;
  background: var(--g-warn-bg); color: var(--g-warn); border-bottom: 1px solid rgba(242, 193, 78, 0.25); font-size: 12px; }
.g-banner span { flex: 1; }
.g-banner .g-btn { color: var(--g-warn); }

.g-main { flex: 1; display: flex; min-height: 0; }
.g-stage { flex: 1; min-width: 0; position: relative; background: var(--g-stage); overflow: auto; display: flex; }
.g-frame { flex: 1; width: 100%; height: 100%; border: 0; background: #fff; display: block; }
.g-stage-fixed { justify-content: safe center; }
.g-stage-fixed .g-frame { flex: none; box-shadow: 0 0 0 1px var(--g-border), 0 8px 32px rgba(0, 0, 0, 0.5); }
.g-dragging .g-frame { pointer-events: none; }
.g-size { position: absolute; right: 10px; bottom: 8px; padding: 2px 6px; border-radius: 4px; pointer-events: none;
  background: rgba(0, 0, 0, 0.6); color: var(--g-muted); font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; }

.g-drawer { position: relative; flex: none; display: flex; flex-direction: column; background: var(--g-panel);
  border-left: 1px solid var(--g-border); min-width: 0; }
.g-drawer-collapsed { width: 32px; align-items: center; padding-top: 6px; }
.g-drawer-tab { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 8px 4px; border: 0;
  border-radius: 6px; background: transparent; color: var(--g-muted); cursor: pointer; }
.g-drawer-tab:hover { background: var(--g-raised); color: var(--g-text); }
.g-drawer-tab span { writing-mode: vertical-rl; font-size: 12px; letter-spacing: 0.04em; }
.g-drawer-handle { position: absolute; left: -3px; top: 0; bottom: 0; width: 6px; cursor: col-resize; z-index: 1; }
.g-drawer-handle:hover, .g-drawer-handle:active { background: var(--g-accent-bg); }
.g-drawer-head { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 4px 0 12px; flex: none;
  border-bottom: 1px solid var(--g-border); color: var(--g-muted); font-size: 12px; }
.g-drawer-head span { flex: 1; }
.g-drawer-body { flex: 1; min-height: 0; padding: 12px; background: var(--g-stage); overflow: auto; }
.g-muted { color: var(--g-muted); margin: 0 0 6px; }
.g-mono { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }

@media (max-width: 900px) { .g-viewports .g-seg:not([aria-pressed="true"]) { display: none; } .g-target > span { display: none; } }
`;
