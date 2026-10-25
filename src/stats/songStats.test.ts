import { describe, expect, it } from 'vitest';
import type { AnswerRecord } from './session';
import { aggregateSongStats, makeMeasureWeightFn } from './songStats';

let t = 0;
const rec = (song: string, measure: number, correct: boolean, timingMs?: number): AnswerRecord => ({
  timestamp: ++t, mode: 'song', song, measure, songMode: timingMs === undefined ? 'wait' : 'tempo', clef: 'treble', keyFifths: 1,
  expected: [60], played: [60], correct, reactionMs: 0, attempts: 1, ...(timingMs === undefined ? {} : { timingMs }),
});

describe('aggregateSongStats', () => {
  it('曲ごとに正答率と、間違えやすい小節を出す', () => {
    const [s] = aggregateSongStats([rec('A', 1, true), rec('A', 3, false), rec('A', 3, false), rec('A', 5, false), rec('A', 2, true)]);
    expect(s.count).toBe(5);
    expect(s.accuracy).toBe(0.4);
    expect(s.weakMeasures).toEqual([{ measure: 3, errors: 2 }, { measure: 5, errors: 1 }]);
    expect(s.meanAbsTimingMs).toBeNull();
  });

  it('テンポモードのずれの平均（絶対値）。最近練習した曲が先', () => {
    const stats = aggregateSongStats([rec('A', 1, true), rec('B', 1, true, -40), rec('B', 2, true, 60)]);
    expect(stats.map((s) => s.song)).toEqual(['B', 'A']);
    expect(stats[0].meanAbsTimingMs).toBe(50);
  });

  it('曲モード以外は含めない', () => {
    expect(aggregateSongStats([{ ...rec('A', 1, true), mode: 'reflex' }])).toEqual([]);
  });
});

describe('makeMeasureWeightFn', () => {
  it('間違えた割合が高い小節ほど重く、まだ弾いていない小節も少し重い', () => {
    const records = [
      ...Array.from({ length: 8 }, (_, i) => rec('A', 1, i !== 0)), // 8か所中1か所間違えた
      ...Array.from({ length: 8 }, () => rec('A', 2, true)), // 全部弾けた
      ...Array.from({ length: 8 }, (_, i) => rec('A', 3, i >= 4)), // 半分間違えた
      rec('B', 4, false), // 別の曲
    ];
    const w = makeMeasureWeightFn(records, 'A', 'both');
    expect(w(1)).toBeCloseTo(1 + 12 * (1.4 / 12));
    expect(w(2)).toBeCloseTo(1 + 12 * (0.4 / 12));
    expect(w(3)).toBeCloseTo(1 + 12 * (4.4 / 12));
    expect(w(4)).toBeCloseTo(2.2);
    expect(w(3)).toBeGreaterThan(w(1));
    expect(w(1)).toBeGreaterThan(w(4));
    expect(w(4)).toBeGreaterThan(w(2));
  });

  it('判定する手が違う記録は使わない', () => {
    const w = makeMeasureWeightFn([{ ...rec('A', 1, false), hands: 'left' }], 'A', 'right');
    expect(w(1)).toBeCloseTo(2.2);
  });
});
