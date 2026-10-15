// Terminal drawer styles and xterm theme, matched to the shell's dark chrome (src/shell/styles.ts).
import type { ITheme } from '@xterm/xterm';
import xtermCss from '@xterm/xterm/css/xterm.css';

export const theme: ITheme = {
  background: '#0a0b0c',
  foreground: '#e3e5e9',
  cursor: '#8ab4ff',
  cursorAccent: '#0a0b0c',
  selectionBackground: 'rgba(138, 180, 255, 0.3)',
  black: '#1f2125',
  red: '#f26b6b',
  green: '#7fd18b',
  yellow: '#f2c14e',
  blue: '#8ab4ff',
  magenta: '#c49bff',
  cyan: '#6fd3e0',
  white: '#c9ccd2',
  brightBlack: '#5c616b',
  brightRed: '#ff8a8a',
  brightGreen: '#9be3a5',
  brightYellow: '#ffd479',
  brightBlue: '#a9c8ff',
  brightMagenta: '#d7b8ff',
  brightCyan: '#94e6f0',
  brightWhite: '#ffffff',
};

export const fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const panelCss = `
#galley-terminal { padding: 0; overflow: hidden; display: flex; flex-direction: column; }
.g-term { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.g-term-bar { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 4px 0 12px; flex: none;
  border-bottom: 1px solid var(--g-border); background: var(--g-panel); color: var(--g-muted); font-size: 12px; }
.g-term-state { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.g-term-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--g-muted); }
.g-term-state[data-state="running"] .g-term-dot { background: #7fd18b; }
.g-term-state[data-state="starting"] .g-term-dot, .g-term-state[data-state="connecting"] .g-term-dot { background: var(--g-warn); }
.g-term-state[data-state="exited"] .g-term-dot, .g-term-state[data-state="disabled"] .g-term-dot { background: var(--g-danger); }
.g-term-screen { flex: 1; min-height: 0; padding: 6px 0 0 8px; background: #0a0b0c; position: relative; }
.g-term-xterm { width: 100%; height: 100%; }
.g-term-xterm .xterm { height: 100%; }
.g-term-note { position: absolute; left: 12px; right: 12px; bottom: 12px; padding: 10px 12px; border-radius: 6px;
  background: var(--g-raised); border: 1px solid var(--g-border); color: var(--g-text); font-size: 12px; z-index: 5;
  display: flex; align-items: center; gap: 10px; }
.g-term-note p { flex: 1; margin: 0; }
.g-term-note[data-kind="disabled"] { border-color: rgba(242, 107, 107, 0.4); }
.g-term-restart { border-color: var(--g-border); color: var(--g-text); }
`;

let injected = false;

export function injectTerminalStyles(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = `${xtermCss}\n${panelCss}`;
  document.head.append(style);
}
