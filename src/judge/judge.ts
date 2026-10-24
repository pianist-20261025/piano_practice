export interface JudgeOptions {
  /** オクターブ違いを正解とみなす */
  octaveEquivalent: boolean;
}

export const DEFAULT_JUDGE_OPTIONS: JudgeOptions = { octaveEquivalent: false };

export interface JudgeResult {
  /** 正しく押せた音（押した側のノート番号） */
  correct: number[];
  /** 押すべきなのに押していない音 */
  missing: number[];
  /** 押すべきでないのに押した音 */
  extra: number[];
  isCorrect: boolean;
}

export interface TimedJudgeResult extends JudgeResult {
  /** 出題表示（またはカーソル到達）から押鍵までのミリ秒 */
  reactionMs: number;
}

const pitchClass = (n: number) => ((n % 12) + 12) % 12;

/**
 * 期待される音の集合と押された音の集合を比較する。単音も要素1つの集合として扱う。
 * 比較は MIDI ノート番号なので異名同音は自然に同一扱いになる。
 */
export function judgeNotes(
  expected: readonly number[],
  played: readonly number[],
  options: JudgeOptions = DEFAULT_JUDGE_OPTIONS,
): JudgeResult {
  const same = options.octaveEquivalent
    ? (a: number, b: number) => pitchClass(a) === pitchClass(b)
    : (a: number, b: number) => a === b;
  const exp = [...new Set(expected)];
  const pl = [...new Set(played)];
  const correct = pl.filter((p) => exp.some((e) => same(e, p)));
  const extra = pl.filter((p) => !exp.some((e) => same(e, p)));
  const missing = exp.filter((e) => !pl.some((p) => same(e, p)));
  return { correct, missing, extra, isCorrect: missing.length === 0 && extra.length === 0 };
}

export function judgeAttempt(
  expected: readonly number[],
  attempt: { notes: readonly number[]; time: number },
  shownAt: number,
  options: JudgeOptions = DEFAULT_JUDGE_OPTIONS,
): TimedJudgeResult {
  return { ...judgeNotes(expected, attempt.notes, options), reactionMs: attempt.time - shownAt };
}
