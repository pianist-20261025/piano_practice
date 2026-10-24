import { STEPS, pitchToMidi, spellMidi, type Pitch, type Step } from './pitch';

// 調は五度圏上の位置（fifths）で表す。正なら ♯ の数、負なら ♭ の数。-7〜7。

export const KEY_FIFTHS_RANGE = { min: -7, max: 7 } as const;

const SHARP_ORDER: readonly Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: readonly Step[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

const MAJOR_VEX = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const MAJOR_JA = ['変ハ', '変ト', '変ニ', '変イ', '変ホ', '変ロ', 'ヘ', 'ハ', 'ト', 'ニ', 'イ', 'ホ', 'ロ', '嬰ヘ', '嬰ハ'];
const MINOR_JA = ['変イ', '変ホ', '変ロ', 'ヘ', 'ハ', 'ト', 'ニ', 'イ', 'ホ', 'ロ', '嬰ヘ', '嬰ハ', '嬰ト', '嬰ニ', '嬰イ'];

/** 調号によってその幹音に付く変化（-1, 0, 1） */
export function keyAlter(fifths: number, step: Step): number {
  if (fifths > 0) return SHARP_ORDER.indexOf(step) < fifths ? 1 : 0;
  if (fifths < 0) return FLAT_ORDER.indexOf(step) < -fifths ? -1 : 0;
  return 0;
}

/** VexFlow の addKeySignature に渡す長調名 */
export function vexKeyName(fifths: number): string {
  return MAJOR_VEX[fifths + 7];
}

/** 表示用（例: "♯2 ニ長調／ロ短調"） */
export function keyLabel(fifths: number): string {
  const sig = fifths === 0 ? '調号なし' : fifths > 0 ? `♯${fifths}` : `♭${-fifths}`;
  return `${sig} ${MAJOR_JA[fifths + 7]}長調／${MINOR_JA[fifths + 7]}短調`;
}

/**
 * この調号のもとで音符に書く臨時記号の変化量。調号どおりなら null。
 * 調号で ♯ が付く音をナチュラルにする場合は 0（ナチュラル記号）を返す。
 */
export function displayedAccidental(pitch: Pitch, fifths: number): number | null {
  return pitch.alter === keyAlter(fifths, pitch.step) ? null : pitch.alter;
}

/**
 * 調を考慮して MIDI ノート番号を音名にする。調号どおりの綴りがあればそれを使い
 * （ニ長調の 66 は F♯、変ト長調の 71 は C♭）、なければ `spellMidi` に任せる。
 */
export function spellMidiInKey(midi: number, fifths: number, nearDiatonic?: number): Pitch {
  for (const step of STEPS) {
    const alter = keyAlter(fifths, step);
    const octave = Math.round((midi - alter - pitchToMidi({ step, alter: 0, octave: 0 })) / 12);
    const p: Pitch = { step, alter, octave };
    if (pitchToMidi(p) === midi) return p;
  }
  return spellMidi(midi, nearDiatonic);
}
