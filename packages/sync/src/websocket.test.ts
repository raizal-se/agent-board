import { describe, expect, it } from 'vitest';
import { decodeMessage, encodeMessage } from './websocket';

describe('websocket message frame', () => {
  it('round trips channel and payload', () => {
    const m = decodeMessage(encodeMessage('y', new Uint8Array([1, 2, 3])));
    expect(m?.channel).toBe('y');
    expect([...(m?.payload ?? [])]).toEqual([1, 2, 3]);
  });

  it('accepts an ArrayBuffer and a list of fragments', () => {
    const bytes = encodeMessage('awareness', new Uint8Array([9]));
    expect(decodeMessage(bytes.slice().buffer)?.channel).toBe('awareness');
    expect(decodeMessage([bytes.subarray(0, 3), bytes.subarray(3)])?.payload[0]).toBe(9);
  });

  it('rejects junk', () => {
    expect(decodeMessage('text')).toBeNull();
    expect(decodeMessage(new Uint8Array([])) ).toBeNull();
    expect(decodeMessage(new Uint8Array([5, 1]))).toBeNull();
    expect(() => encodeMessage('', new Uint8Array())).toThrow();
  });
});
