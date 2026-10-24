import { describe, expect, it } from 'vitest';
import { makeTimeline } from './timeline';

describe('makeTimeline', () => {
  const tl = makeTimeline([{ time: 0, x: 100 }, { time: 1, x: 150 }, { time: 3, x: 190 }]);

  it('音符の位置の間を直線でつなぐ', () => {
    expect(tl(0)).toBe(100);
    expect(tl(0.5)).toBe(125);
    expect(tl(2)).toBe(170);
  });

  it('範囲外は両端の傾きで延ばす', () => {
    expect(tl(-1)).toBe(50);
    expect(tl(5)).toBe(230);
  });

  it('同じ時刻の点があっても壊れない', () => {
    const t = makeTimeline([{ time: 0, x: 0 }, { time: 1, x: 10 }, { time: 1, x: 12 }]);
    expect(t(2)).toBe(20);
  });
});
