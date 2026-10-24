import type { Clef } from '../music/clef';

/** reflex=反射モード（単音）、shape=形で読むモード（音程・和音）、song=曲モード（MusicXML） */
export type Mode = 'reflex' | 'shape' | 'song';

/**
 * 1問（曲モードでは1ステップ）ごとの記録。正誤と反応時間は最初の押鍵で決める。
 * 曲モードの反応時間は、待機モードならカーソル到達から最初の押鍵まで、テンポモードならタイミングのずれ。
 */
export interface AnswerRecord {
  timestamp: number;
  mode: Mode;
  /** 形で読むモードの形の id（3rd, triad-root など） */
  shape?: string;
  /** 曲モード: 曲名、小節番号、待機/テンポ、判定した手 */
  song?: string;
  measure?: number;
  songMode?: 'wait' | 'tempo';
  hands?: 'right' | 'left' | 'both';
  /** 曲モード（テンポ）: 押せた音のタイミングのずれの平均（ms、負なら早い） */
  timingMs?: number;
  clef: Clef;
  /** 調号（♯の数は正、♭の数は負） */
  keyFifths: number;
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
