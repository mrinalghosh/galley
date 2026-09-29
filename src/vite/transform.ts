import { parse, type ParserPlugin } from '@babel/parser';
import MagicString, { type SourceMap } from 'magic-string';
import { SRC_ATTR } from '../shared/constants.js';

export interface TransformResult {
  code: string;
  map: SourceMap;
}

/** The subset of a Babel AST node the walker reads. */
interface AstNode {
  type: string;
  start?: number | null;
  end?: number | null;
  loc?: { start: { line: number; column: number } } | null;
  [key: string]: unknown;
}

// Keys that never lead to JSX, skipped so the walker doesn't wander into position data or comments.
const SKIP_KEYS = new Set(['loc', 'start', 'end', 'extra', 'range', 'leadingComments', 'trailingComments', 'innerComments', 'comments', 'tokens', 'errors']);

/**
 * Adds `data-galley-src="<file>:<line>:<col>"` to every host (lowercase) JSX element.
 * `file` is the path already relative to the Vite root, with POSIX separators.
 * Line and column are both 1-based, so `col` counts characters from 1 and points at the `<`.
 * Returns null when there is nothing to change or the file doesn't parse; the next
 * plugin in the chain then reports any syntax error itself.
 */
export function addSourceAttributes(code: string, id: string, file: string): TransformResult | null {
  const program = parseModule(code, id);
  if (!program) return null;

  const s = new MagicString(code);
  const prefix = escapeAttribute(file);

  walk(program, (node) => {
    if (node.type !== 'JSXOpeningElement') return;
    const name = node.name as AstNode;
    if (!isHostElementName(name) || hasSourceAttribute(node) || !node.loc || name.end == null) return;

    const { line, column } = node.loc.start;
    s.appendLeft(name.end, ` ${SRC_ATTR}="${prefix}:${line}:${column + 1}"`);
  });

  if (!s.hasChanged()) return null;
  return { code: s.toString(), map: s.generateMap({ hires: true, source: id, includeContent: true }) };
}

function parseModule(code: string, id: string): AstNode | null {
  const plugins: ParserPlugin[] = ['jsx'];
  // TypeScript syntax only for TS files, so generic-looking JSX in plain .jsx isn't misread.
  if (/\.tsx$/.test(id)) plugins.push('typescript');
  try {
    return parse(code, { sourceType: 'module', plugins }).program as unknown as AstNode;
  } catch {
    return null;
  }
}

function walk(node: AstNode, visit: (node: AstNode) => void): void {
  visit(node);
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) if (isNode(child)) walk(child, visit);
    } else if (isNode(value)) {
      walk(value, visit);
    }
  }
}

function isNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && typeof (value as AstNode).type === 'string';
}

/** `div` yes; `Card`, `ui.Button`, `svg:rect` and fragments no. */
function isHostElementName(name: AstNode | undefined): boolean {
  return name?.type === 'JSXIdentifier' && /^[a-z]/.test(name.name as string);
}

function hasSourceAttribute(opening: AstNode): boolean {
  const attributes = opening.attributes as AstNode[];
  return attributes.some((attribute) => {
    if (attribute.type !== 'JSXAttribute') return false;
    const name = attribute.name as AstNode;
    return name.type === 'JSXIdentifier' && name.name === SRC_ATTR;
  });
}

// JSX string attributes decode HTML entities, so these two characters must be encoded.
function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
