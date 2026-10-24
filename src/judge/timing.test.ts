import { describe, expect, it } from 'vitest';
import { TimedMatcher, summarizeTiming } from './timing';

const targets = [
  { step: 0, midi: 60, time: 1000 },
  { step: 0, midi: 48, time: 1000 },
  { step: 1, midi: 62, time: 1500 },
  { step: 2, midi: 60, time: 2000 },
];

describe('TimedMatcher', () => {
  it('同じ音で時刻が窓の中なら当たり。ずれを返す', () => {
    const m = new TimedMatcher(targets, 200);
    expect(m.press(60, 1030)).toEqual({ kind: 'hit', target: 0, deviationMs: 30 });
    expect(m.press(48, 960)).toEqual({ kind: 'hit', target: 1, deviationMs: -40 });
  });

  it('同じ音が2回出てくるときは、時刻が近い方に結び付ける', () => {
    const m = new TimedMatcher(targets, 600);
    expect(m.press(60, 1900)).toMatchObject({ kind: 'hit', target: 3 });
    expect(m.press(60, 1100)).toMatchObject({ kind: 'hit', target: 0 });
  });

  it('窓の外や違う音は余計な音で、いちばん近いステップに数える', () => {
    const m = new TimedMatcher(targets, 100);
    expect(m.press(62, 1300)).toEqual({ kind: 'extra', step: 1 });
    expect(m.press(65, 1010)).toEqual({ kind: 'extra', step: 0 });
  });

  it('押されないまま窓を過ぎた目標を1回だけ返す', () => {
    const m = new TimedMatcher(targets, 100);
    m.press(60, 1000);
    expect(m.expire(1050)).toEqual([]);
    expect(m.expire(1101)).toEqual([1]);
    expect(m.expire(1700)).toEqual([2]);
    expect(m.expire(1700)).toEqual([]);
    expect(m.result(1)).toEqual({ hit: false, deviationMs: null });
  });

  it('当たった目標はもう結び付けない', () => {
    const m = new TimedMatcher(targets, 200);
    m.press(62, 1500);
    expect(m.press(62, 1520).kind).toBe('extra');
  });
});

describe('TimedMatcher.credit', () => {
  it('押さえたままの音を当たりにする（ずれは null）。期限切れにも数えない', () => {
    const m = new TimedMatcher(targets, 100);
    expect(m.credit(2)).toBe(true);
    expect(m.result(2)).toEqual({ hit: true, deviationMs: null });
    expect(m.credit(2)).toBe(false);
    expect(m.expire(5000)).toEqual([0, 1, 3]);
    // 当たりにした目標には、もう押鍵を結び付けない
    expect(m.press(62, 1500).kind).toBe('extra');
  });
});

describe('summarizeTiming', () => {
  it('許容幅に入った割合と平均のずれ', () => {
    const s = summarizeTiming([-50, 20, 150, 80], 100);
    expect(s.onTimeRate).toBe(0.75);
    expect(s.meanAbsMs).toBe(75);
    expect(s.meanMs).toBe(50);
  });

  it('記録がなければ null', () => {
    expect(summarizeTiming([], 100)).toEqual({ count: 0, onTimeRate: 0, meanAbsMs: null, meanMs: null });
  });
});
