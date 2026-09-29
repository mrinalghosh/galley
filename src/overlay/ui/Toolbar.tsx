import type { Tool } from './App.js';

interface Props {
  tool: Tool;
  commentCount: number;
  panelOpen: boolean;
  errorCount: number;
  errorsOpen: boolean;
  onTool(tool: Tool): void;
  onTogglePanel(): void;
  onToggleErrors(): void;
}

/** Floating toolbar, shown only when the page is opened without the shell. */
export function Toolbar({ tool, commentCount, panelOpen, errorCount, errorsOpen, onTool, onTogglePanel, onToggleErrors }: Props) {
  return (
    <div class="toolbar" role="toolbar" aria-label="galley">
      <button
        type="button"
        class={`tool ${tool === 'pick' ? 'tool-active' : ''}`}
        title="Pick an element (C)"
        aria-pressed={tool === 'pick'}
        data-galley="pick"
        onClick={() => onTool(tool === 'pick' ? 'none' : 'pick')}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2l10 5-4.2 1.3L7 12.5z" /></svg>
        Pick
      </button>
      <button
        type="button"
        class={`tool ${tool === 'lasso' ? 'tool-active' : ''}`}
        title="Lasso a region (L)"
        aria-pressed={tool === 'lasso'}
        data-galley="lasso"
        onClick={() => onTool(tool === 'lasso' ? 'none' : 'lasso')}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><ellipse cx="8" cy="7" rx="6" ry="4" fill="none" /></svg>
        Lasso
      </button>
      <button
        type="button"
        class={`tool ${panelOpen ? 'tool-active' : ''}`}
        title="Comments"
        aria-pressed={panelOpen}
        data-galley="comments"
        onClick={onTogglePanel}
      >
        Comments{commentCount > 0 && <span class="count">{commentCount}</span>}
      </button>
      {errorCount > 0 && (
        <button
          type="button"
          class={`tool ${errorsOpen ? 'tool-active' : ''}`}
          title={`${errorCount} error${errorCount === 1 ? '' : 's'} on this page`}
          aria-pressed={errorsOpen}
          data-galley="errors-badge"
          onClick={onToggleErrors}
        >
          Errors<span class="count count-error">{errorCount}</span>
        </button>
      )}
    </div>
  );
}
