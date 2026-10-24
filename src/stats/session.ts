import type { Clef } from '../music/clef';

export type Mode = 'reflex';

/** 1問ごとの記録。正誤と反応時間は最初の押鍵で決める。 */
export interface AnswerRecord {
  timestamp: number;
  mode: Mode;
  clef: Clef;
  expected: number[];
  /** 最初に押した音 */
  played: number[];
  correct: boolean;
  reactionMs: number;
  /** 正解するまでに押した回数 */
  attempts: number;
}

export interface SessionSummary {
  total: number;
  correct: number;
  /** 0–1。問題がなければ 0 */
  accuracy: number;
  /** 全問の最初の押鍵までの平均。問題がなければ null */
  avgReactionMs: number | null;
  /** 正解した問題だけの平均 */
  avgCorrectReactionMs: number | null;
}

const average = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function summarize(records: readonly AnswerRecord[]): SessionSummary {
  const correct = records.filter((r) => r.correct);
  return {
    total: records.length,
    correct: correct.length,
    accuracy: records.length ? correct.length / records.length : 0,
    avgReactionMs: average(records.map((r) => r.reactionMs)),
    avgCorrectReactionMs: average(correct.map((r) => r.reactionMs)),
  };
}
