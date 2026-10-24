import { describe, expect, it } from 'vitest';
import { aggregateFlowSessions } from './flowStats';
import type { AnswerRecord } from './session';

const rec = (session: number, correct: boolean, timingMs?: number): AnswerRecord => ({
  timestamp: session + 1, mode: 'flow', session, bpm: 72, clef: 'treble', keyFifths: 0, expected: [60], played: [60],
  correct, reactionMs: timingMs ?? 0, attempts: 1, ...(timingMs === undefined ? {} : { timingMs }),
});

describe('aggregateFlowSessions', () => {
  it('1回の練習ごとに正答率とずれをまとめ、新しい順に並べる', () => {
    const stats = aggregateFlowSessions([rec(100, true, -30), rec(100, true, 50), rec(100, false), rec(200, true, 10)]);
    expect(stats.map((s) => s.session)).toEqual([200, 100]);
    const first = stats[1];
    expect(first.notes).toBe(3);
    expect(first.accuracy).toBeCloseTo(2 / 3);
    expect(first.meanAbsTimingMs).toBe(40);
    expect(first.meanTimingMs).toBe(10);
    expect(first.bpm).toBe(72);
  });

  it('件数の上限と、流れ読み以外の除外', () => {
    const records = [1, 2, 3].map((s) => rec(s, true, 0));
    expect(aggregateFlowSessions(records, 2).map((s) => s.session)).toEqual([3, 2]);
    expect(aggregateFlowSessions([{ ...rec(1, true), mode: 'reflex' }])).toEqual([]);
  });
});
