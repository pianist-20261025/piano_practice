// 音名（綴り）と MIDI ノート番号の相互変換。
// 判定は常に MIDI ノート番号で行うので、異名同音（F♯4 と G♭4）は同じ番号になる。

export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

export const STEPS: readonly Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

export interface Pitch {
  step: Step;
  /** -2..2（♭♭, ♭, ナチュラル, ♯, ×） */
  alter: number;
  /** 科学的音名のオクターブ（中央ド = C4） */
  octave: number;
}

export function pitchToMidi(p: Pitch): number {
  return (p.octave + 1) * 12 + STEP_SEMITONES[STEPS.indexOf(p.step)] + p.alter;
}

/** 五線上の位置（幹音の通し番号）。C4 = 28, D4 = 29 … */
export function diatonicIndex(p: Pitch): number {
  return p.octave * 7 + STEPS.indexOf(p.step);
}

export function pitchFromDiatonic(index: number, alter = 0): Pitch {
  const octave = Math.floor(index / 7);
  return { step: STEPS[index - octave * 7], alter, octave };
}

/**
 * MIDI ノート番号を音名にする。白鍵は常に幹音。
 * 黒鍵は ♯/♭ の2候補のうち、`nearDiatonic`（期待音の位置など）に近い方を選ぶ。
 * 指定がなければ ♯ を使う。
 */
export function spellMidi(midi: number, nearDiatonic?: number): Pitch {
  const pc = ((midi % 12) + 12) % 12;
  const natural = STEP_SEMITONES.indexOf(pc);
  if (natural >= 0) {
    return { step: STEPS[natural], alter: 0, octave: Math.floor(midi / 12) - 1 };
  }
  const sharp = spellWith(midi, 1);
  if (nearDiatonic === undefined) return sharp;
  const flat = spellWith(midi, -1);
  const dSharp = Math.abs(diatonicIndex(sharp) - nearDiatonic);
  const dFlat = Math.abs(diatonicIndex(flat) - nearDiatonic);
  return dFlat < dSharp ? flat : sharp;
}

function spellWith(midi: number, alter: number): Pitch {
  const base = midi - alter;
  const step = STEPS[STEP_SEMITONES.indexOf(((base % 12) + 12) % 12)];
  return { step, alter, octave: Math.floor(base / 12) - 1 };
}

const ALTER_SYMBOLS: Record<number, string> = { [-2]: '𝄫', [-1]: '♭', 0: '', 1: '♯', 2: '𝄪' };
const ALTER_VEX: Record<number, string> = { [-2]: 'bb', [-1]: 'b', 0: '', 1: '#', 2: '##' };

/** 表示用の名前（例: "F♯4"） */
export function pitchName(p: Pitch): string {
  return `${p.step}${ALTER_SYMBOLS[p.alter]}${p.octave}`;
}

/** VexFlow の key 文字列（例: "f#/4"） */
export function toVexKey(p: Pitch): string {
  return `${p.step.toLowerCase()}${ALTER_VEX[p.alter]}/${p.octave}`;
}
