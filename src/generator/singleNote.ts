import type { Clef } from '../music/clef';
import { keyAlter } from '../music/key';
import { diatonicIndex, pitchFromDiatonic, pitchToMidi, type Pitch } from '../music/pitch';

/** 幹音の位置（diatonicIndex）で表した音域。両端を含む */
export interface DiatonicRange {
  low: number;
  high: number;
}

export type KeySetting =
  | { kind: 'none' }
  | { kind: 'fixed'; fifths: number }
  /** 問題ごとに ♯・♭ が maxAccidentals 個以下の調から選ぶ */
  | { kind: 'random'; maxAccidentals: number };

export interface SingleNoteOptions {
  /** 出題する段。複数なら問題ごとにランダム（大譜表） */
  clefs: readonly Clef[];
  ranges: Record<Clef, DiatonicRange>;
  key: KeySetting;
  /** 調号にない臨時記号を出すか */
  accidentals: boolean;
  /** 臨時記号を付ける確率（accidentals が true のとき） */
  accidentalRate?: number;
  /** 音ごとの出題の重み（苦手な音ほど大きく）。なければ均等 */
  weight?: (clef: Clef, midi: number) => number;
}

export interface SingleNoteQuestion {
  clef: Clef;
  keyFifths: number;
  pitch: Pitch;
}

export type Rng = () => number;

const DEFAULT_ACCIDENTAL_RATE = 0.3;

const pick = <T>(xs: readonly T[], rng: Rng): T => xs[Math.min(xs.length - 1, Math.floor(rng() * xs.length))];

/** 楽譜でめったに見ない綴り（E♯, B♯, F♭, C♭）。調号に含まれる場合は除く */
const RARE = new Set(['E1', 'B1', 'F-1', 'C-1']);

/**
 * 単音の問題を1つ作る。直前と同じ鍵盤の音は避ける。
 * 臨時記号ありのときは、調号に対して ♯/♭/ナチュラル を付けた音を一定の確率で混ぜる。
 */
export function generateSingleNote(options: SingleNoteOptions, rng: Rng, previous?: SingleNoteQuestion): SingleNoteQuestion {
  const clef = pick(options.clefs, rng);
  const keyFifths = chooseKey(options.key, rng);
  const { low, high } = options.ranges[clef];
  const previousMidi = previous ? pitchToMidi(previous.pitch) : null;

  const positions: number[] = [];
  for (let d = Math.min(low, high); d <= Math.max(low, high); d++) positions.push(d);
  const useAccidental = options.accidentals && rng() < (options.accidentalRate ?? DEFAULT_ACCIDENTAL_RATE);

  // 条件に合う音がない（音域が1音だけ等）ときは直前と同じ音も許す
  for (const allowRepeat of [false, true]) {
    const candidates = positions
      .map((d) => {
        const base = pitchFromDiatonic(d, keyAlter(keyFifths, pitchFromDiatonic(d).step));
        return useAccidental ? chromaticVariants(base, keyFifths) : [base];
      })
      .flat()
      .filter((p) => allowRepeat || pitchToMidi(p) !== previousMidi);
    if (candidates.length) {
      // 綴りの候補数で位置ごとの出やすさが偏らないよう、位置ごとに重みを候補数で割る
      const perPosition = new Map<number, number>();
      for (const p of candidates) perPosition.set(diatonicIndex(p), (perPosition.get(diatonicIndex(p)) ?? 0) + 1);
      const weights = candidates.map(
        (p) => (options.weight?.(clef, pitchToMidi(p)) ?? 1) / perPosition.get(diatonicIndex(p))!,
      );
      return { clef, keyFifths, pitch: weightedPick(candidates, weights, rng) };
    }
  }
  throw new Error('音域が空です');
}

export function weightedPick<T>(items: readonly T[], weights: readonly number[], rng: Rng): T {
  const total = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (!(total > 0)) return pick(items, rng);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

function chooseKey(setting: KeySetting, rng: Rng): number {
  if (setting.kind === 'none') return 0;
  if (setting.kind === 'fixed') return setting.fifths;
  const max = Math.max(0, Math.min(7, setting.maxAccidentals));
  return Math.floor(rng() * (2 * max + 1)) - max;
}

/** 調号どおりの音から臨時記号で半音ずらした綴り（まれな綴りは除く） */
function chromaticVariants(base: Pitch, fifths: number): Pitch[] {
  const inKey = keyAlter(fifths, base.step);
  const alters = inKey === 0 ? [-1, 1] : [0];
  return alters
    .map((alter) => ({ ...base, alter }))
    .filter((p) => !RARE.has(`${p.step}${p.alter}`));
}
