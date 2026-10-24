import { describe, expect, it } from 'vitest';
import type { AnswerRecord } from './session';
import { aggregateSongStats } from './songStats';

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
