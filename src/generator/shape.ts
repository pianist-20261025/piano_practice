import type { Clef } from '../music/clef';
import { keyAlter } from '../music/key';
import { pitchFromDiatonic, pitchToMidi, type Pitch } from '../music/pitch';
import { chooseKey, chromaticVariants, weightedPick, type DiatonicRange, type KeySetting, type Rng } from './singleNote';

/** 形（音程・和音）。steps は一番下の音からの五線上の距離（3度なら 2） */
export interface ShapeDef {
  id: string;
  label: string;
  steps: readonly number[];
}

export const SHAPES: readonly ShapeDef[] = [
  { id: '2nd', label: '2度', steps: [0, 1] },
  { id: '3rd', label: '3度', steps: [0, 2] },
  { id: '4th', label: '4度', steps: [0, 3] },
  { id: '5th', label: '5度', steps: [0, 4] },
  { id: '6th', label: '6度', steps: [0, 5] },
  { id: '7th', label: '7度', steps: [0, 6] },
  { id: 'octave', label: 'オクターブ', steps: [0, 7] },
  { id: 'triad-root', label: '三和音（基本形）', steps: [0, 2, 4] },
  { id: 'triad-1st', label: '三和音（第1転回形）', steps: [0, 2, 5] },
  { id: 'triad-2nd', label: '三和音（第2転回形）', steps: [0, 3, 5] },
];

export const DEFAULT_SHAPE_IDS = ['3rd', '5th', 'octave', 'triad-root'];

export const shapeById = (id: string) => SHAPES.find((s) => s.id === id);

export interface ShapeOptions {
  clefs: readonly Clef[];
  ranges: Record<Clef, DiatonicRange>;
  key: KeySetting;
  /** 出題する形の id */
  shapes: readonly string[];
  /** 1音に臨時記号を付けるか */
  accidentals: boolean;
  accidentalRate?: number;
}

export interface ShapeQuestion {
  clef: Clef;
  keyFifths: number;
  shape: string;
  /** 低い順 */
  pitches: Pitch[];
}

const DEFAULT_ACCIDENTAL_RATE = 0.3;

/**
 * 音程・和音の問題を1つ作る。音はすべて調号どおり（その調の音階上で積む）で、
 * 臨時記号ありのときは一定の確率で1音だけ半音ずらす。直前と同じ音の組み合わせは避ける。
 * 選んだ形がどれも音域に収まらなければ例外。
 */
export function generateShape(options: ShapeOptions, rng: Rng, previous?: ShapeQuestion): ShapeQuestion {
  const clef = weightedPick(options.clefs, options.clefs.map(() => 1), rng);
  const keyFifths = chooseKey(options.key, rng);
  const { low, high } = options.ranges[clef];
  const shapes = options.shapes.map(shapeById).filter((s): s is ShapeDef => !!s && s.steps.at(-1)! <= high - low);
  if (!shapes.length) throw new Error('選んだ形が音域に収まりません。音域を広げるか、狭い音程を選んでください');
  const previousKey = previous ? midiKey(previous.pitches) : null;

  for (let tries = 0; tries < 20; tries++) {
    const shape = weightedPick(shapes, shapes.map(() => 1), rng);
    const top = shape.steps.at(-1)!;
    const bottom = low + Math.floor(rng() * (high - top - low + 1));
    let pitches = shape.steps.map((s) => {
      const d = bottom + s;
      return pitchFromDiatonic(d, keyAlter(keyFifths, pitchFromDiatonic(d).step));
    });
    if (options.accidentals && rng() < (options.accidentalRate ?? DEFAULT_ACCIDENTAL_RATE)) {
      const i = Math.floor(rng() * pitches.length);
      const variants = chromaticVariants(pitches[i], keyFifths);
      if (variants.length) pitches = pitches.map((p, j) => (j === i ? weightedPick(variants, variants.map(() => 1), rng) : p));
    }
    const q = { clef, keyFifths, shape: shape.id, pitches };
    // 半音ずらしで同じ鍵盤が重なる組み合わせ（増1度など）は出さない
    if (new Set(pitches.map(pitchToMidi)).size !== pitches.length) continue;
    if (midiKey(pitches) !== previousKey || tries === 19) return q;
  }
  throw new Error('問題を作れませんでした');
}

const midiKey = (pitches: readonly Pitch[]) => pitches.map(pitchToMidi).join(',');
