import { describe, expect, it } from 'vitest';
import { staffRange } from '../music/clef';
import { diatonicIndex } from '../music/pitch';
import { generateSingleNote } from './singleNote';

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

describe('generateSingleNote', () => {
  it('音域内の幹音だけを出す', () => {
    const rng = seeded(1);
    const { low, high } = staffRange('treble', 1);
    for (let i = 0; i < 500; i++) {
      const p = generateSingleNote({ clef: 'treble', ledgerLines: 1 }, rng);
      expect(p.alter).toBe(0);
      expect(diatonicIndex(p)).toBeGreaterThanOrEqual(low);
      expect(diatonicIndex(p)).toBeLessThanOrEqual(high);
    }
  });

  it('直前と同じ音は出さない', () => {
    const rng = seeded(2);
    let prev = generateSingleNote({ clef: 'treble', ledgerLines: 0 }, rng);
    for (let i = 0; i < 500; i++) {
      const next = generateSingleNote({ clef: 'treble', ledgerLines: 0 }, rng, prev);
      expect(diatonicIndex(next)).not.toBe(diatonicIndex(prev));
      prev = next;
    }
  });

  it('音域の両端も出る', () => {
    const rng = seeded(3);
    const { low, high } = staffRange('treble', 0);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(diatonicIndex(generateSingleNote({ clef: 'treble', ledgerLines: 0 }, rng)));
    expect(seen.size).toBe(high - low + 1);
  });

  it('rng が 1 に近くても範囲外にならない', () => {
    const p = generateSingleNote({ clef: 'treble', ledgerLines: 0 }, () => 0.9999999999);
    expect(diatonicIndex(p)).toBe(staffRange('treble', 0).high);
  });
});
