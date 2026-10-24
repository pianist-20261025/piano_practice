import type { Clef } from '../music/clef';
import { keyAlter } from '../music/key';
import { diatonicIndex, pitchFromDiatonic, type Pitch } from '../music/pitch';
import { chooseKey, chromaticVariants, weightedPick, type DiatonicRange, type KeySetting, type Rng } from './singleNote';

export type Rhythm = 'quarter' | 'mixed';

export interface PhraseOptions {
  /** 1段なら [clef]。大譜表なら小節ごとにどちらかの段 */
  clefs: readonly Clef[];
  ranges: Record<Clef, DiatonicRange>;
  key: KeySetting;
  accidentals: boolean;
  accidentalRate?: number;
  measures: number;
  rhythm: Rhythm;
  /** 隣り合う音の跳躍の上限（五線上の距離。6度なら 5） */
  maxLeap: number;
}

export interface PhraseNote {
  pitch: Pitch;
  clef: Clef;
  /** 0 始まりの小節番号 */
  measure: number;
  /** フレーズ頭からの位置（4分音符単位） */
  time: number;
  /** 長さ（4分音符単位: 0.5, 1, 2, 4） */
  duration: number;
}

export interface Phrase {
  keyFifths: number;
  beatsPerMeasure: number;
  measures: number;
  notes: PhraseNote[];
}

export const BEATS_PER_MEASURE = 4;
const DEFAULT_ACCIDENTAL_RATE = 0.12;

/** 1小節（4拍）のリズム。mixed は 2分・8分を混ぜる */
const PATTERNS: Record<Rhythm, number[][]> = {
  quarter: [[1, 1, 1, 1]],
  mixed: [
    [1, 1, 1, 1],
    [2, 1, 1],
    [1, 1, 2],
    [2, 2],
    [1, 0.5, 0.5, 1, 1],
    [0.5, 0.5, 1, 1, 1],
    [1, 1, 0.5, 0.5, 1],
    [1, 1, 1, 0.5, 0.5],
    [0.5, 0.5, 0.5, 0.5, 2],
  ],
};

/**
 * 流れ読み用のランダムなフレーズを作る。
 * 音は調の音階上を歩き、跳躍は maxLeap まで。順次進行を出やすくし、4度以上跳んだ後は反対向きに
 * 戻りやすくして、音楽的に不自然な並び（跳躍の連続など）を避ける。最後の小節は全音符で終える。
 */
export function generatePhrase(options: PhraseOptions, rng: Rng): Phrase {
  const keyFifths = chooseKey(options.key, rng);
  const notes: PhraseNote[] = [];
  /** 段ごとに、直前の音の位置と直前の動き（大譜表で段が替わっても旋律がつながるように） */
  const last: Partial<Record<Clef, { d: number; move: number }>> = {};
  const maxLeap = Math.max(1, Math.min(7, options.maxLeap));

  for (let m = 0; m < options.measures; m++) {
    const clef = weightedPick(options.clefs, options.clefs.map(() => 1), rng);
    const { low, high } = options.ranges[clef];
    const pattern = m === options.measures - 1 ? [BEATS_PER_MEASURE] : weightedPick(PATTERNS[options.rhythm], PATTERNS[options.rhythm].map(() => 1), rng);
    let time = m * BEATS_PER_MEASURE;
    for (const duration of pattern) {
      const prev = last[clef];
      let d: number;
      if (!prev) {
        // 段の最初の音は音域の中ほどから
        const mid = Math.round((low + high) / 2);
        d = Math.max(low, Math.min(high, mid + Math.floor(rng() * 5) - 2));
      } else {
        const candidates: number[] = [];
        const weights: number[] = [];
        for (let step = -maxLeap; step <= maxLeap; step++) {
          const next = prev.d + step;
          if (next < low || next > high) continue;
          const size = Math.abs(step);
          let w = size === 0 ? 0.4 : size <= 1 ? 4 : size === 2 ? 2.5 : size <= 4 ? 1 : 0.5;
          // 4度以上跳んだら、反対向きの順次進行で戻りやすくする（跳躍の連続を避ける）
          if (Math.abs(prev.move) >= 3) {
            if (Math.sign(step) === -Math.sign(prev.move) && size <= 2) w *= 3;
            else if (size >= 3) w *= 0.2;
          }
          candidates.push(next);
          weights.push(w);
        }
        d = candidates.length ? weightedPick(candidates, weights, rng) : Math.max(low, Math.min(high, prev.d));
      }
      let pitch = pitchFromDiatonic(d, keyAlter(keyFifths, pitchFromDiatonic(d).step));
      if (options.accidentals && rng() < (options.accidentalRate ?? DEFAULT_ACCIDENTAL_RATE)) {
        const variants = chromaticVariants(pitch, keyFifths);
        if (variants.length) pitch = weightedPick(variants, variants.map(() => 1), rng);
      }
      last[clef] = { d, move: prev ? d - prev.d : 0 };
      notes.push({ pitch, clef, measure: m, time, duration });
      time += duration;
    }
  }
  return { keyFifths, beatsPerMeasure: BEATS_PER_MEASURE, measures: options.measures, notes };
}

/** 隣り合う音（同じ段）の跳躍の大きさ（五線上の距離） */
export function leaps(phrase: Phrase): number[] {
  const out: number[] = [];
  for (let i = 1; i < phrase.notes.length; i++) {
    const a = phrase.notes[i - 1];
    const b = phrase.notes[i];
    if (a.clef === b.clef) out.push(Math.abs(diatonicIndex(b.pitch) - diatonicIndex(a.pitch)));
  }
  return out;
}
