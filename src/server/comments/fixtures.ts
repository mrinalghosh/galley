// Test fixtures for the comments module.
import type { NewComment } from '../../shared/protocol.js';

export function sampleComment(overrides: Partial<NewComment> = {}): NewComment {
  return {
    text: 'Make the heading bigger',
    url: '/?tab=1',
    viewport: { w: 1280, h: 800, dpr: 2 },
    mode: 'pick',
    region: { x: 10, y: 20, w: 300, h: 40 },
    elements: [
      {
        selector: 'body > main > h1',
        tag: 'h1',
        classes: ['title'],
        text: 'Hello',
        rect: { x: 10, y: 20, w: 300, h: 40 },
        src: 'src/App.tsx:4:7',
        styles: {
          fontSize: '32px',
          fontWeight: '700',
          lineHeight: '40px',
          color: 'rgb(0, 0, 0)',
          backgroundColor: 'rgba(0, 0, 0, 0)',
          padding: '0px',
          margin: '0px',
          gap: 'normal',
          borderRadius: '0px',
        },
      },
    ],
    target: 'queue',
    ...overrides,
  };
}
