import { staffRange, type Clef } from '../music/clef';
import { diatonicIndex, pitchFromDiatonic, type Pitch } from '../music/pitch';

export interface SingleNoteOptions {
  clef: Clef;
  /** 加線を何本まで出すか */
  ledgerLines: number;
}

export type Rng = () => number;

/** 音域内の幹音をランダムに1つ選ぶ。直前と同じ音は避ける。 */
export function generateSingleNote(options: SingleNoteOptions, rng: Rng, previous?: Pitch): Pitch {
  const { low, high } = staffRange(options.clef, options.ledgerLines);
  const candidates: number[] = [];
  for (let d = low; d <= high; d++) {
    if (!previous || d !== diatonicIndex(previous)) candidates.push(d);
  }
  const index = candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))];
  return pitchFromDiatonic(index);
}
