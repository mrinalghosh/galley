import { describe, expect, it } from 'vitest';
import type { CapturedError } from '../../shared/protocol.js';
import { sampleComment } from './fixtures.js';
import { validateNewComment } from './validate.js';

const ERROR: CapturedError = {
  message: 'Error: Sample error thrown from a click handler',
  stack: 'Error: Sample error thrown from a click handler\n    at throwInHandler (http://localhost:5350/src/components/ErrorButtons.tsx:2:9)',
  at: '2026-09-29T10:00:00.000Z',
};

describe('validateNewComment: elementless error comments', () => {
  it('accepts a comment with no elements when it carries errors', () => {
    const viewportRegion = { x: 0, y: 120, w: 1280, h: 800 };
    const result = validateNewComment(sampleComment({ text: `Fix this error: ${ERROR.message}`, elements: [], errors: [ERROR], region: viewportRegion }));
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ elements: [], errors: [ERROR], region: viewportRegion }),
    });
  });

  it('gives an elementless comment a 0-size region when it sends none', () => {
    const { region: _omitted, ...body } = sampleComment({ elements: [], errors: [ERROR] });
    const result = validateNewComment(body);
    expect(result.ok && result.value.region).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it('still requires a region when elements are given', () => {
    const { region: _omitted, ...body } = sampleComment();
    expect(validateNewComment(body)).toEqual({ ok: false, error: 'region must be an object' });
  });

  it.each([
    ['no errors field', {}],
    ['an empty errors list', { errors: [] }],
  ])('rejects a comment with no elements and %s', (_name, overrides) => {
    const result = validateNewComment(sampleComment({ elements: [], ...overrides }));
    expect(result).toEqual({ ok: false, error: 'elements must not be empty unless errors are attached' });
  });

  it('keeps an error without a stack, and rejects a malformed one', () => {
    const noStack = validateNewComment(sampleComment({ elements: [], errors: [{ message: 'boom', at: ERROR.at }] }));
    expect(noStack.ok && noStack.value.errors).toEqual([{ message: 'boom', at: ERROR.at }]);
    const bad = validateNewComment({ ...sampleComment({ elements: [] }), errors: [{ stack: 'x' }] });
    expect(bad).toEqual({ ok: false, error: 'errors[0].message must be a string' });
  });

  it('keeps the batch id', () => {
    const result = validateNewComment(sampleComment({ batch: 'b_abc123' }));
    expect(result.ok && result.value.batch).toBe('b_abc123');
  });
});
