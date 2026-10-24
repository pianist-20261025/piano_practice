import { diatonicIndex, type Pitch } from './pitch';

export type Clef = 'treble' | 'bass';
export const CLEFS: readonly Clef[] = ['treble', 'bass'];

/** 各音部記号の第1線（一番下の線）の音 */
const BOTTOM_LINE: Record<Clef, Pitch> = {
  treble: { step: 'E', alter: 0, octave: 4 },
  bass: { step: 'G', alter: 0, octave: 2 },
};

export const CLEF_LABELS: Record<Clef, string> = { treble: 'ト音記号', bass: 'ヘ音記号' };

/**
 * 加線 `ledgerLines` 本までで書ける音域（幹音の位置で、両端を含む）。
 * 0本なら五線の下のすぐ外の間〜上のすぐ外の間まで（ト音記号: D4〜G5）。
 */
export function staffRange(clef: Clef, ledgerLines: number): { low: number; high: number } {
  const bottom = diatonicIndex(BOTTOM_LINE[clef]);
  const top = bottom + 8;
  return { low: bottom - 1 - 2 * ledgerLines, high: top + 1 + 2 * ledgerLines };
}

/** その位置の音を書くのに必要な加線の本数 */
export function ledgerLinesAt(clef: Clef, diatonic: number): number {
  const { low, high } = staffRange(clef, 0);
  if (diatonic < low) return Math.ceil((low - diatonic) / 2);
  if (diatonic > high) return Math.ceil((diatonic - high) / 2);
  return 0;
}
