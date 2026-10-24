import { describe, expect, it } from 'vitest';
import type { AnswerRecord } from './session';
import { aggregateShapeStats } from './shapeStats';

let t = 0;
const rec = (shape: string | undefined, correct: boolean, reactionMs = 800): AnswerRecord => ({
  timestamp: ++t, mode: shape ? 'shape' : 'reflex', ...(shape ? { shape } : {}), clef: 'treble', keyFifths: 0,
  expected: shape ? [60, 64] : [60], played: [60], correct, reactionMs, attempts: 1,
});

describe('aggregateShapeStats', () => {
  it('形ごとに正答率と正解時の平均反応を出す。単音の記録は含めない', () => {
    const stats = aggregateShapeStats([rec('3rd', true, 600), rec('3rd', false), rec('3rd', true, 1000), rec('octave', true, 500), rec(undefined, true)]);
    expect(stats).toHaveLength(2);
    const third = stats.find((s) => s.shape === '3rd')!;
    expect(third.count).toBe(3);
    expect(third.accuracy).toBeCloseTo(2 / 3);
    expect(third.avgCorrectReactionMs).toBe(800);
  });

  it('直近 window 回で計算する', () => {
    const records = [rec('5th', false), rec('5th', false), rec('5th', true), rec('5th', true)];
    const [s] = aggregateShapeStats(records, 2);
    expect(s.accuracy).toBe(1);
    expect(s.totalCount).toBe(4);
  });
});
