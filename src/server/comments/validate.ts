// Request body validation. Returns a clean copy with only known fields, or an
// error message naming the first bad field.
import { MAX_SELECTED_ELEMENTS } from '../../shared/constants.js';
import type { CapturedError, ElementInfo, ElementStyles, NewComment, Rect, Viewport } from '../../shared/protocol.js';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

class Invalid extends Error {}

const MAX_TEXT = 20_000;
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=\s]+$/;
const MAX_SHORT = 2_000;
const MAX_ERRORS = 20;
const EMPTY_REGION: Rect = { x: 0, y: 0, w: 0, h: 0 };
const STYLE_KEYS: (keyof ElementStyles)[] = [
  'fontSize',
  'fontWeight',
  'lineHeight',
  'color',
  'backgroundColor',
  'padding',
  'margin',
  'gap',
  'borderRadius',
];

type Obj = Record<string, unknown>;

function object(value: unknown, field: string): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Invalid(`${field} must be an object`);
  return value as Obj;
}

function string(value: unknown, field: string, max: number, { allowEmpty = true } = {}): string {
  if (typeof value !== 'string') throw new Invalid(`${field} must be a string`);
  if (!allowEmpty && !value.trim()) throw new Invalid(`${field} must not be empty`);
  if (value.length > max) throw new Invalid(`${field} is longer than ${max} characters`);
  return value;
}

function optionalString(value: unknown, field: string, max: number): string | undefined {
  return value === undefined || value === null ? undefined : string(value, field, max);
}

function number(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Invalid(`${field} must be a finite number`);
  return value;
}

function array(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw new Invalid(`${field} must be an array`);
  if (value.length > max) throw new Invalid(`${field} has more than ${max} items`);
  return value;
}

function rect(value: unknown, field: string): Rect {
  const o = object(value, field);
  return { x: number(o.x, `${field}.x`), y: number(o.y, `${field}.y`), w: number(o.w, `${field}.w`), h: number(o.h, `${field}.h`) };
}

function viewport(value: unknown): Viewport {
  const o = object(value, 'viewport');
  return { w: number(o.w, 'viewport.w'), h: number(o.h, 'viewport.h'), dpr: number(o.dpr, 'viewport.dpr') };
}

function styles(value: unknown, field: string): ElementStyles {
  const o = object(value, field);
  const out = {} as ElementStyles;
  for (const key of STYLE_KEYS) out[key] = string(o[key] ?? '', `${field}.${key}`, 200);
  return out;
}

function element(value: unknown, index: number): ElementInfo {
  const field = `elements[${index}]`;
  const o = object(value, field);
  const info: ElementInfo = {
    selector: string(o.selector, `${field}.selector`, MAX_SHORT, { allowEmpty: false }),
    tag: string(o.tag, `${field}.tag`, 100, { allowEmpty: false }),
    classes: array(o.classes ?? [], `${field}.classes`, 100).map((c, i) => string(c, `${field}.classes[${i}]`, 200)),
    text: string(o.text ?? '', `${field}.text`, 1_000),
    rect: rect(o.rect, `${field}.rect`),
    styles: styles(o.styles, `${field}.styles`),
  };
  const src = optionalString(o.src, `${field}.src`, MAX_SHORT);
  if (src) info.src = src;
  return info;
}

function capturedError(value: unknown, index: number): CapturedError {
  const field = `errors[${index}]`;
  const o = object(value, field);
  const out: CapturedError = { message: string(o.message, `${field}.message`, MAX_TEXT), at: string(o.at, `${field}.at`, 100) };
  const stack = optionalString(o.stack, `${field}.stack`, MAX_TEXT);
  if (stack) out.stack = stack;
  return out;
}

function guard<T>(fn: () => T): Result<T> {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.message };
    throw error;
  }
}

export function validateNewComment(body: unknown): Result<NewComment> {
  return guard(() => {
    const o = object(body, 'body');
    const mode = o.mode;
    if (mode !== 'pick' && mode !== 'lasso') throw new Invalid('mode must be "pick" or "lasso"');
    const elements = array(o.elements, 'elements', MAX_SELECTED_ELEMENTS).map(element);
    const errors = o.errors === undefined ? undefined : array(o.errors, 'errors', MAX_ERRORS).map(capturedError);
    // A comment points at something: elements, or (a "fix this error" request) console errors.
    if (elements.length === 0 && !errors?.length) throw new Invalid('elements must not be empty unless errors are attached');
    const comment: NewComment = {
      text: string(o.text, 'text', MAX_TEXT, { allowEmpty: false }),
      url: string(o.url, 'url', MAX_SHORT),
      viewport: viewport(o.viewport),
      mode,
      // Nothing on the page to box in: an elementless comment may leave the region out.
      region: elements.length === 0 && o.region === undefined ? { ...EMPTY_REGION } : rect(o.region, 'region'),
      elements,
      target: string(o.target, 'target', 200, { allowEmpty: false }),
    };
    const commonAncestor = optionalString(o.commonAncestor, 'commonAncestor', MAX_SHORT);
    if (commonAncestor) comment.commonAncestor = commonAncestor;
    const batch = optionalString(o.batch, 'batch', 200);
    if (batch) comment.batch = batch;
    if (errors) comment.errors = errors;
    if (o.screenshotDataUrl !== undefined) {
      const shot = string(o.screenshotDataUrl, 'screenshotDataUrl', Number.MAX_SAFE_INTEGER);
      if (!PNG_DATA_URL.test(shot)) throw new Invalid('screenshotDataUrl must be a base64 PNG data URL');
      comment.screenshotDataUrl = shot;
    }
    return comment;
  });
}

/** Body of POST /comments/:id/send: optional new target. */
export function validateSend(body: unknown): Result<{ target?: string }> {
  return guard(() => {
    const o = object(body ?? {}, 'body');
    const target = optionalString(o.target, 'target', 200);
    if (target !== undefined && !target.trim()) throw new Invalid('target must not be empty');
    return target === undefined ? {} : { target };
  });
}

/** Body of POST /comments/:id/done ({note}) or /fail ({reason}). */
export function validateNote(body: unknown, key: 'note' | 'reason'): Result<string | undefined> {
  return guard(() => optionalString(object(body ?? {}, 'body')[key], key, MAX_SHORT));
}
