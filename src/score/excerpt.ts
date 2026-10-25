// 曲から1〜数小節を抜き出して練習するための、小節の選び方と判定用の位置の切り出し。
// OSMD に依存しない純粋な関数にして、テストで確かめられるようにしている。

import { TIME_EPS, type RawEntry, type Step } from './steps';

/** 抜粋する範囲（小節の通し番号 measureIndex、両端を含む） */
export interface ExcerptRange {
  from: number;
  to: number;
}

export interface PickOptions {
  /** 抜粋する小節数（最小・最大） */
  minLen: number;
  maxLen: number;
  /** 直前に弾いた範囲（続けて同じ範囲を出さない） */
  previous?: ExcerptRange | null;
  /** 小節番号ごとの出やすさ（1 が基準。間違えやすい小節ほど大きくする）。なければどの小節も同じ */
  weightOf?: (measureNumber: number) => number;
  random?: () => number;
}

/**
 * 抜粋する範囲をランダムに選ぶ。
 * 1. 判定する音がある小節から、weightOf の重みで「練習する小節」を1つ選ぶ
 * 2. 長さを minLen〜maxLen 小節から選び、その小節を含むように範囲の位置をずらす
 *    （苦手な小節が、抜粋の頭にも途中にも終わりにも来るように）。曲の頭・終わりを越えるときは詰める
 * 3. 直前と同じ範囲は（ほかに選べる範囲があれば）避ける
 */
export function pickExcerpt(steps: readonly Step[], options: PickOptions): ExcerptRange | null {
  const { previous = null, weightOf = () => 1, random = Math.random } = options;
  const measures = new Map<number, number>();
  for (const s of steps) if (!measures.has(s.measureIndex)) measures.set(s.measureIndex, s.measureNumber);
  const candidates = [...measures.keys()].sort((a, b) => a - b);
  if (!candidates.length) return null;
  const first = candidates[0];
  const last = candidates[candidates.length - 1];
  const weights = candidates.map((m) => Math.max(0, weightOf(measures.get(m)!)) || 0);
  const total = weights.reduce((a, b) => a + b, 0);
  const lo = Math.max(1, Math.min(options.minLen, options.maxLen));
  const hi = Math.max(lo, options.maxLen);
  const choose = (): ExcerptRange => {
    let focus = candidates[candidates.length - 1];
    if (total > 0) {
      let r = random() * total;
      focus = candidates.find((_, i) => (r -= weights[i]) < 0) ?? focus;
    } else {
      focus = candidates[Math.floor(random() * candidates.length)];
    }
    const len = lo + Math.floor(random() * (hi - lo + 1));
    // focus を含む範囲の頭の候補: focus - len + 1 〜 focus（曲の頭より前には出さない）
    const earliest = Math.max(first, focus - len + 1);
    const from = earliest + Math.floor(random() * (focus - earliest + 1));
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

/**
 * 楽譜に書かれた小節番号で指定した範囲（両端を含む）を、小節の通し番号の範囲にする。
 * a > b なら入れ替える。その番号の小節が1つもなければ null
 */
export function rangeFromMeasureNumbers(entries: readonly RawEntry[], a: number, b: number): ExcerptRange | null {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const indices = entries.filter((e) => e.measureNumber >= lo && e.measureNumber <= hi).map((e) => e.measureIndex);
  return indices.length ? { from: Math.min(...indices), to: Math.max(...indices) } : null;
}

/** 楽譜に書かれた最初と最後の小節番号（範囲を指定するときの案内用） */
export function measureNumberSpan(entries: readonly RawEntry[]): { first: number; last: number } | null {
  if (!entries.length) return null;
  const numbers = entries.map((e) => e.measureNumber);
  return { first: Math.min(...numbers), last: Math.max(...numbers) };
}
