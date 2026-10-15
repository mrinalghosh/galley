// Comment ids: "c_" + 10 chars of time + 4 chars of randomness, Crockford base32.
// Lexical order matches creation order, including ids made in the same millisecond.
import { randomInt } from 'node:crypto';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const TIME_LEN = 10;
const RAND_LEN = 4;
const RAND_MAX = 32 ** RAND_LEN;

let lastTime = -1;
let lastRand = 0;

function encode(value: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out = ALPHABET[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

export function newCommentId(now: number = Date.now()): string {
  let time = Math.max(now, lastTime);
  let rand: number;
  if (time === lastTime) {
    rand = lastRand + 1;
    if (rand >= RAND_MAX) {
      time += 1;
      rand = randomInt(RAND_MAX / 2);
    }
  } else {
    // Leave headroom so same-millisecond increments rarely overflow.
    rand = randomInt(RAND_MAX / 2);
  }
  lastTime = time;
  lastRand = rand;
  return `c_${encode(time, TIME_LEN)}${encode(rand, RAND_LEN)}`;
}

export const COMMENT_ID_PATTERN = /^c_[0-9a-hjkmnp-tv-z]{14}$/;
