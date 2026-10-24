import { describe, expect, it } from 'vitest';
import { aggregateNoteStats, makeWeightFn, noteWeight, overallAvgCorrectMs, statKey } from './noteStats';
import type { AnswerRecord } from './session';

let t = 0;
const rec = (midi: number, correct: boolean, reactionMs = 500, played = correct ? midi : midi + 2, clef: 'treble' | 'bass' = 'treble'): AnswerRecord => ({
  timestamp: ++t, mode: 'reflex', clef, keyFifths: 0, expected: [midi], played: [played], correct, reactionMs, attempts: 1,
});

describe('aggregateNoteStats', () => {
  it('音部記号 × ノート番号ごとに集計する', () => {
    const stats = aggregateNoteStats([rec(60, true, 400), rec(60, false, 900, 62), rec(60, true, 600), rec(60, true, 500, 60, 'bass')]);
    const c4 = stats.get(statKey('treble', 60))!;
    expect(c4.count).toBe(3);
    expect(c4.correct).toBe(2);
    expect(c4.accuracy).toBeCloseTo(2 / 3);
    expect(c4.avgCorrectReactionMs).toBe(500);
    expect(c4.confusions).toEqual([{ midi: 62, count: 1 }]);
    expect(stats.get(statKey('bass', 60))!.count).toBe(1);
  });

  it('正答率は直近 window 回だけで計算し、総数は別に持つ', () => {
    const records = [...Array(10)].map(() => rec(64, false)).concat([...Array(5)].map(() => rec(64, true)));
    const s = aggregateNoteStats(records, 5).get(statKey('treble', 64))!;
    expect(s.accuracy).toBe(1);
    expect(s.count).toBe(5);
    expect(s.totalCount).toBe(15);
  });

  it('読み間違えた音を多い順に並べる', () => {
    const s = aggregateNoteStats([rec(67, false, 0, 65), rec(67, false, 0, 69), rec(67, false, 0, 65)]).get(statKey('treble', 67))!;
    expect(s.confusions).toEqual([{ midi: 65, count: 2 }, { midi: 69, count: 1 }]);
    expect(s.avgCorrectReactionMs).toBeNull();
  });

  it('和音の記録は単音の統計に入れない', () => {
    expect(aggregateNoteStats([{ ...rec(60, true), expected: [60, 64] }]).size).toBe(0);
  });
});

describe('noteWeight', () => {
  it('間違えやすい音ほど重い', () => {
    const stats = aggregateNoteStats([...Array(10)].map((_, i) => rec(60, i < 9)).concat([...Array(10)].map((_, i) => rec(62, i < 4))));
    const good = noteWeight(stats.get(statKey('treble', 60)), 500);
    const bad = noteWeight(stats.get(statKey('treble', 62)), 500);
    expect(bad).toBeGreaterThan(good * 2);
  });

  it('遅い音ほど重い（全体平均の2倍で頭打ち）', () => {
    const fast = aggregateNoteStats([rec(60, true, 500)]).get(statKey('treble', 60));
    const slow = aggregateNoteStats([rec(60, true, 1000)]).get(statKey('treble', 60));
    const slower = aggregateNoteStats([rec(60, true, 3000)]).get(statKey('treble', 60));
    expect(noteWeight(slow, 500) - noteWeight(fast, 500)).toBeCloseTo(2);
    expect(noteWeight(slower, 500)).toBeCloseTo(noteWeight(slow, 500));
  });

  it('1回間違えただけでは極端にならない。未出題の音は基準より少し重い', () => {
    const once = aggregateNoteStats([rec(60, false)]).get(statKey('treble', 60));
    expect(noteWeight(once, null)).toBeLessThan(6);
    expect(noteWeight(undefined, null)).toBeCloseTo(1 + 6 * 0.2);
  });
});

describe('overallAvgCorrectMs / makeWeightFn', () => {
  it('正解の反応時間を回答数で重み付けして平均する', () => {
    const stats = aggregateNoteStats([rec(60, true, 400), rec(60, true, 400), rec(62, true, 1000)]);
    expect(overallAvgCorrectMs(stats.values())).toBe(600);
  });

  it('記録から重み関数を作る', () => {
    const w = makeWeightFn([rec(60, true), rec(62, false), rec(62, false)]);
    expect(w('treble', 62)).toBeGreaterThan(w('treble', 60));
    expect(w('bass', 62)).toBeCloseTo(w('bass', 99));
  });
});
