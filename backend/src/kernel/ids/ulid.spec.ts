import { describe, expect, it } from 'vitest';
import { generateId, isUlid } from './ulid.js';

describe('ulid', () => {
  it('generates valid ULIDs', () => {
    expect(isUlid(generateId())).toBe(true);
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateId()));
    expect(ids.size).toBe(1000);
  });

  it('accepts canonical and lowercase ULIDs', () => {
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true);
    expect(isUlid('01arz3ndektsv4rrffq69g5fav')).toBe(true);
  });

  it('rejects malformed values', () => {
    expect(isUlid('')).toBe(false);
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FA')).toBe(false); // too short
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAVU')).toBe(false); // U not in alphabet
    expect(isUlid('not-a-ulid-at-all-************')).toBe(false);
    expect(isUlid(undefined)).toBe(false);
    expect(isUlid(null)).toBe(false);
    expect(isUlid(123)).toBe(false);
  });
});
