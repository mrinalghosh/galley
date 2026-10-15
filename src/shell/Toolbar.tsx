import type { Tool } from './bridge.js';
import { VIEWPORTS, type ViewportId } from './viewports.js';
import { CommentsIcon, ErrorIcon, LassoIcon, PickIcon, ReloadIcon } from './icons.js';

/** A place comments can be sent. M3 fills this from GET /targets and the events socket. */
export interface TargetOption {
  value: string;
  label: string;
}

interface ToolbarProps {
  tool: Tool;
  onTool(tool: Tool): void;
  onToggleComments(): void;
  errorCount: number;
  /** The error badge was clicked: the overlay shows its recent-errors list. */
  onToggleErrors(): void;
  target: string;
  targets: TargetOption[];
  onTarget(target: string): void;
  viewport: ViewportId;
  onViewport(viewport: ViewportId): void;
  onReload(): void;
  path: string;
}

export function Toolbar(props: ToolbarProps) {
  const toggle = (tool: Tool) => props.onTool(props.tool === tool ? 'none' : tool);
  return (
    <header class="g-toolbar">
      <span class="g-brand">galley</span>

      <div class="g-group" role="group" aria-label="Tools">
        <button class="g-btn" aria-pressed={props.tool === 'pick'} title="Pick an element (C)" onClick={() => toggle('pick')}>
          <PickIcon />
          <kbd>C</kbd>
        </button>
        <button class="g-btn" aria-pressed={props.tool === 'lasso'} title="Lasso a region (L)" onClick={() => toggle('lasso')}>
          <LassoIcon />
          <kbd>L</kbd>
        </button>
        <button class="g-btn" title="Comments" onClick={props.onToggleComments}>
          <CommentsIcon />
        </button>
        {props.errorCount > 0 && (
          <button
            class="g-btn"
            title={`${props.errorCount} error${props.errorCount === 1 ? '' : 's'} on this page: show them`}
            data-galley="errors-badge"
            onClick={props.onToggleErrors}
          >
            <ErrorIcon />
            <span class="g-badge">{props.errorCount}</span>
          </button>
        )}
      </div>

      <span class="g-path" title={props.path}>
        {props.path}
      </span>

      <label class="g-target" title="Where new comments go">
        <span>Send to</span>
        <select value={props.target} onChange={(e) => props.onTarget(e.currentTarget.value)}>
          {props.targets.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div class="g-group g-viewports" role="group" aria-label="Viewport">
        {VIEWPORTS.map((preset) => (
          <button
            key={preset.id}
            class="g-btn g-seg"
            aria-pressed={props.viewport === preset.id}
            title={preset.title}
            onClick={() => props.onViewport(preset.id)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <button class="g-btn" title="Reload the page" onClick={props.onReload}>
        <ReloadIcon />
      </button>
    </header>
  );
}
