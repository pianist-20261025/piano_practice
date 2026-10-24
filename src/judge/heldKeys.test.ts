import { describe, expect, it } from 'vitest';
import { heldByOtherHand, heldFromBefore } from './heldKeys';

describe('heldByOtherHand', () => {
  const left = { hand: 'left' as const, pressedAt: 1000 };

  it('左手が前から押さえている鍵盤を、右手の音として求められたら true', () => {
    expect(heldByOtherHand('right', left, 1000, 2000)).toBe(true);
  });

  it('同じ手の連打は false（押し直しが必要）', () => {
    expect(heldByOtherHand('left', left, 1000, 2000)).toBe(false);
  });

  it('押さえていない、押し直された、この位置で押されたものは false', () => {
    expect(heldByOtherHand('right', left, undefined, 2000)).toBe(false);
    expect(heldByOtherHand('right', left, 1500, 2000)).toBe(false); // 一度離して押し直した
    expect(heldByOtherHand('right', { hand: 'left', pressedAt: 2500 }, 2500, 2000)).toBe(false);
  });

  it('どの手の音として押したか分からない鍵盤（余計な音など）は false', () => {
    expect(heldByOtherHand('right', undefined, 1000, 2000)).toBe(false);
  });
});

describe('heldFromBefore', () => {
  it('この位置より前から押さえていれば true（手は問わない）', () => {
    expect(heldFromBefore(1000, 2000)).toBe(true);
  });

  it('押さえていない、この位置で押したものは false', () => {
    expect(heldFromBefore(undefined, 2000)).toBe(false);
    expect(heldFromBefore(2500, 2000)).toBe(false);
  });
});
