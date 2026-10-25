// 曲から1〜数小節を抜き出して練習するための、小節の選び方と判定用の位置の切り出し。
// OSMD に依存しない純粋な関数にして、テストで確かめられるようにしている。

import { TIME_EPS, type RawEntry, type Step } from './steps';

/** 抜粋する範囲（小節の通し番号 measureIndex、両端を含む） */
export interface ExcerptRange {
  from: number;
  to: number;
}

/**
 * 抜粋する範囲をランダムに選ぶ。
 * - 判定する音がある小節（steps に出てくる小節）から始める
 * - 長さは minLen〜maxLen 小節。曲の終わりを越えるときは短くする
 * - 直前と同じ範囲は（ほかに選べる範囲があれば）避ける
 */
export function pickExcerpt(
  steps: readonly Step[],
  minLen: number,
  maxLen: number,
  previous: ExcerptRange | null = null,
  random: () => number = Math.random,
): ExcerptRange | null {
  const starts = [...new Set(steps.map((s) => s.measureIndex))].sort((a, b) => a - b);
  if (!starts.length) return null;
  const last = starts[starts.length - 1];
  const lo = Math.max(1, Math.min(minLen, maxLen));
  const hi = Math.max(lo, maxLen);
  const choose = (): ExcerptRange => {
    const from = starts[Math.floor(random() * starts.length)];
    const len = lo + Math.floor(random() * (hi - lo + 1));
    return { from, to: Math.min(last, from + len - 1) };
  };
  let range = choose();
  const same = (r: ExcerptRange) => previous !== null && r.from === previous.from && r.to === previous.to;
  // 選べる範囲が1つしかない（1小節だけの曲など）ときは同じでもよい
  for (let tries = 0; same(range) && tries < 20; tries++) range = choose();
  return range;
}

/**
 * 抜粋する範囲のカーソル位置だけを取り出す。
 * 範囲の最初の位置にあるタイの後ろ側の音（前の小節からタイでつながっている音）は、
 * 抜粋ではそこから弾き始めるので、新しく鳴り始める音として判定する。
 */
export function excerptEntries(entries: readonly RawEntry[], range: ExcerptRange): RawEntry[] {
  const inRange = entries.filter((e) => e.measureIndex >= range.from && e.measureIndex <= range.to);
  if (!inRange.length) return [];
  const start = inRange[0].time;
  return inRange.map((e) =>
    e.time <= start + TIME_EPS && e.notes.some((n) => n.tieContinuation)
      ? { ...e, notes: e.notes.map((n) => ({ ...n, tieContinuation: false })) }
      : e,
  );
}

/** 範囲の表示（例: 「小節 5〜7」「小節 3」） */
export function excerptLabel(steps: readonly Step[], entries: readonly RawEntry[], range: ExcerptRange): string {
  const numberOf = (index: number) =>
    steps.find((s) => s.measureIndex === index)?.measureNumber ?? entries.find((e) => e.measureIndex === index)?.measureNumber ?? index + 1;
  const a = numberOf(range.from);
  const b = numberOf(range.to);
  return a === b ? `小節 ${a}` : `小節 ${a}〜${b}`;
}
