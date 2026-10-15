// Types shared by the server, shell and overlay. Additive changes only: other
// parts of galley depend on these shapes.

export type CommentStatus = 'queued' | 'sent' | 'done' | 'failed';

export type SelectionMode = 'pick' | 'lasso';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Viewport {
  w: number;
  h: number;
  dpr: number;
}

/** Computed styles captured for each selected element. */
export interface ElementStyles {
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  color: string;
  backgroundColor: string;
  padding: string;
  margin: string;
  gap: string;
  borderRadius: string;
}

export interface ElementInfo {
  selector: string;
  tag: string;
  classes: string[];
  /** Visible text, first 200 characters. */
  text: string;
  /** Page coordinates. */
  rect: Rect;
  /** "file:line:col" from the nearest ancestor carrying the source attribute. */
  src?: string;
  styles: ElementStyles;
}

export interface CapturedError {
  message: string;
  stack?: string;
  at: string;
}

/** What the overlay sends to create a comment. */
export interface NewComment {
  text: string;
  url: string;
  viewport: Viewport;
  mode: SelectionMode;
  region: Rect;
  elements: ElementInfo[];
  commonAncestor?: string;
  /** PNG as a data URL. The server writes it to disk and stores the path. */
  screenshotDataUrl?: string;
  errors?: CapturedError[];
  batch?: string;
  /** 'terminal', a listener name, or 'queue'. */
  target: string;
}

/** A stored comment: one line in .galley/comments.jsonl, folded with its events. */
export interface Comment extends Omit<NewComment, 'screenshotDataUrl'> {
  id: string;
  createdAt: string;
  /** Absolute path to the PNG, when a screenshot was taken. */
  screenshot?: string;
  status: CommentStatus;
  /** Claude's one-line note on done, or the reason on failed. */
  note?: string;
}

export interface TargetInfo {
  /** 'terminal' or a listener name. */
  name: string;
  kind: 'terminal' | 'listener';
}

/** Messages pushed on WS PREFIX/events to every open shell and overlay. */
export type ServerEvent =
  | { type: 'comment'; comment: Comment }
  | { type: 'comment-deleted'; id: string }
  | { type: 'targets'; targets: TargetInfo[] };

/** postMessage between the shell (parent) and the overlay (site iframe). */
export type ShellToOverlay =
  | { source: 'galley-shell'; type: 'set-tool'; tool: 'pick' | 'lasso' | 'none' }
  | { source: 'galley-shell'; type: 'set-target'; target: string }
  | { source: 'galley-shell'; type: 'toggle-comments' }
  /** The shell's error badge was clicked: open or close the overlay's recent-errors list. */
  | { source: 'galley-shell'; type: 'toggle-errors' };

export type OverlayToShell =
  | { source: 'galley-overlay'; type: 'ready'; url: string }
  | { source: 'galley-overlay'; type: 'tool-changed'; tool: 'pick' | 'lasso' | 'none' }
  | { source: 'galley-overlay'; type: 'error-count'; count: number }
  /** The user picked a target in the overlay's composer; the shell remembers it. */
  | { source: 'galley-overlay'; type: 'target-changed'; target: string };
