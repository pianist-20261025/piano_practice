import { describe, expect, it } from 'vitest';
import { summarize, type AnswerRecord } from './session';

const rec = (correct: boolean, reactionMs: number): AnswerRecord => ({
  timestamp: 0, mode: 'reflex', clef: 'treble', expected: [60], played: [correct ? 60 : 62], correct, reactionMs, attempts: correct ? 1 : 2,
});

describe('summarize', () => {
  it('正答率と平均反応時間', () => {
    const s = summarize([rec(true, 500), rec(false, 900), rec(true, 700), rec(true, 300)]);
    expect(s.total).toBe(4);
    expect(s.correct).toBe(3);
    expect(s.accuracy).toBe(0.75);
    expect(s.avgReactionMs).toBe(600);
    expect(s.avgCorrectReactionMs).toBe(500);
  });

  it('記録がなければ平均は null', () => {
    expect(summarize([])).toEqual({ total: 0, correct: 0, accuracy: 0, avgReactionMs: null, avgCorrectReactionMs: null });
  });
});
