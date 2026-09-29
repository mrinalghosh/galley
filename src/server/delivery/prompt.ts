// The prompt a chat receives for one or more comments. Pure: the listener
// module (M3) and the browser terminal (M4) both deliver this text as-is.
import type { CapturedError, Comment, ElementInfo, ElementStyles } from '../../shared/protocol.js';

export interface PromptContext {
  /** How to invoke the CLI from any directory, e.g. "galley" or "node /abs/bin/galley.js". */
  cli: string;
  /** Absolute project folder, passed as --cwd so the done command works from anywhere. */
  cwd: string;
  /** Proxy origin, e.g. "http://localhost:5300", used to turn stored paths into URLs. */
  origin: string;
}

export const CLOSING_LINE = 'Make the change, then run the done command with a one-line note.';

const MAX_ELEMENT_TEXT = 120;
const MAX_CLASSES = 3;
const MAX_STACK_LINES = 4;

export function formatPrompt(comments: Comment[], ctx: PromptContext): string {
  if (comments.length === 0) throw new Error('formatPrompt needs at least one comment');
  const blocks = comments.map((comment, i) => formatComment(comment, ctx, comments.length > 1 ? i + 1 : undefined));
  return [promptHeader(comments), ...blocks, CLOSING_LINE].join('\n\n');
}

function promptHeader(comments: Comment[]): string {
  // Worded as the user's own request: in the terminal it arrives as a paste,
  // and a third-person header made Claude treat it as someone else's text.
  if (comments.length === 1) return 'I left this comment on my page in the browser with galley. Please make the change:';
  const batch = sharedBatch(comments);
  if (batch) {
    return (
      `I left ${comments.length} related comments on my page in the browser with galley, sent together as one request (batch ${batch}). ` +
      'Read them all before editing, since they may touch the same code, then handle each one:'
    );
  }
  return `I left ${comments.length} comments on my page in the browser with galley. Please handle each one:`;
}

/** The batch id every comment carries, if they all carry the same one. */
function sharedBatch(comments: Comment[]): string | undefined {
  const first = comments[0]?.batch;
  return first && comments.every((c) => c.batch === first) ? first : undefined;
}

function formatComment(comment: Comment, ctx: PromptContext, number: number | undefined): string {
  const lines: string[] = [];
  lines.push(`${number === undefined ? '' : `${number}. `}[${comment.id}] ${quoteBlock(comment.text)}`);
  lines.push(`Page: ${pageUrl(comment.url, ctx.origin)} (viewport ${formatViewport(comment)})`);
  if (comment.mode === 'lasso') {
    const inside = comment.commonAncestor ? ` inside ${comment.commonAncestor}` : '';
    lines.push(`Lasso selection: ${comment.elements.length} element${comment.elements.length === 1 ? '' : 's'}${inside}`);
  }
  comment.elements.forEach((element, i) => lines.push(...formatElement(element, comment.elements.length > 1 ? i + 1 : undefined)));
  if (comment.errors?.length) lines.push(...formatErrors(comment.errors));
  if (comment.screenshot) lines.push(`Screenshot: ${comment.screenshot}`);
  lines.push(`Done: ${cliCommand(ctx, 'done', comment.id, '<note>')}`);
  lines.push(`Fail: ${cliCommand(ctx, 'fail', comment.id, '<reason>')}`);
  return lines.join('\n');
}

function formatElement(element: ElementInfo, number: number | undefined): string[] {
  const label = number === undefined ? 'Element' : `Element ${number}`;
  const where = element.src ? `${element.src}` : 'no source location';
  const lines = [`${label}: <${describeTag(element)}> ${where}`, `  selector: ${element.selector}`];
  const text = compactText(element.text);
  if (text) lines.push(`  text: "${text}"`);
  const styles = compactStyles(element.styles);
  if (styles) lines.push(`  styles: ${styles}`);
  return lines;
}

function formatErrors(errors: CapturedError[]): string[] {
  const lines = [`Console errors (${errors.length}):`];
  for (const error of errors) {
    lines.push(`  - ${compactText(error.message)}`);
    const stack = (error.stack ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && line !== error.message)
      .slice(0, MAX_STACK_LINES);
    for (const line of stack) lines.push(`    ${line}`);
  }
  return lines;
}

/** "h1.title.big" with at most a few classes, since utility-class lists get long. */
function describeTag(element: ElementInfo): string {
  const classes = element.classes.slice(0, MAX_CLASSES).map((c) => `.${c}`).join('');
  const more = element.classes.length > MAX_CLASSES ? '…' : '';
  return `${element.tag}${classes}${more}`;
}

// Styles at their browser defaults say nothing, so they're left out.
const DEFAULTS: Partial<Record<keyof ElementStyles, string[]>> = {
  backgroundColor: ['rgba(0, 0, 0, 0)', 'transparent'],
  padding: ['0px'],
  margin: ['0px'],
  gap: ['normal', '0px'],
  borderRadius: ['0px'],
};

const STYLE_LABELS: [keyof ElementStyles, string][] = [
  ['color', 'color'],
  ['backgroundColor', 'bg'],
  ['padding', 'padding'],
  ['margin', 'margin'],
  ['gap', 'gap'],
  ['borderRadius', 'radius'],
];

export function compactStyles(styles: ElementStyles): string {
  const parts: string[] = [];
  const font = [styles.fontSize && styles.lineHeight ? `${styles.fontSize}/${styles.lineHeight}` : styles.fontSize, styles.fontWeight]
    .filter(Boolean)
    .join(' ');
  if (font) parts.push(`font ${font}`);
  for (const [key, label] of STYLE_LABELS) {
    const value = styles[key];
    if (!value || DEFAULTS[key]?.includes(value)) continue;
    parts.push(`${label} ${value.replace(/,\s+/g, ',')}`);
  }
  return parts.join('; ');
}

function formatViewport(comment: Comment): string {
  const { w, h, dpr } = comment.viewport;
  return dpr && dpr !== 1 ? `${w}x${h} @${dpr}x` : `${w}x${h}`;
}

function pageUrl(url: string, origin: string): string {
  if (/^[a-z]+:\/\//i.test(url)) return url;
  return origin + (url.startsWith('/') ? url : `/${url}`);
}

/** Multi-line comment text is indented so it reads as one quoted block. */
function quoteBlock(text: string): string {
  const trimmed = text.trim();
  return trimmed.includes('\n') ? `\n  ${trimmed.split('\n').join('\n  ')}` : trimmed;
}

function compactText(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_ELEMENT_TEXT ? `${flat.slice(0, MAX_ELEMENT_TEXT).trimEnd()}…` : flat;
}

export function cliCommand(ctx: PromptContext, action: 'done' | 'fail', id: string, placeholder: string): string {
  return `${ctx.cli} ${action} ${id} "${placeholder}" --cwd ${shellQuote(ctx.cwd)}`;
}

/** Quotes a word for POSIX shells, only when it needs it. */
export function shellQuote(word: string): string {
  if (/^[A-Za-z0-9_\-./:@%+=,]+$/.test(word)) return word;
  return `'${word.replace(/'/g, `'\\''`)}'`;
}
