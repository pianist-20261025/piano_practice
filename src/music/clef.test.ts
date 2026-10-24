import { describe, expect, it } from 'vitest';
import { ledgerLinesAt, staffRange } from './clef';
import { pitchFromDiatonic, pitchName } from './pitch';

const names = (r: { low: number; high: number }) => [pitchName(pitchFromDiatonic(r.low)), pitchName(pitchFromDiatonic(r.high))];

describe('staffRange', () => {
  it('ト音記号', () => {
    expect(names(staffRange('treble', 0))).toEqual(['D4', 'G5']);
    expect(names(staffRange('treble', 1))).toEqual(['B3', 'B5']);
    expect(names(staffRange('treble', 2))).toEqual(['G3', 'D6']);
  });

  it('ヘ音記号', () => {
    expect(names(staffRange('bass', 0))).toEqual(['F2', 'B3']);
    expect(names(staffRange('bass', 1))).toEqual(['D2', 'D4']);
  });
});

describe('ledgerLinesAt', () => {
  it('ト音記号の加線の本数', () => {
    const at = (d: number) => ledgerLinesAt('treble', d);
    expect([29, 28, 27, 26, 25].map(at)).toEqual([0, 1, 1, 2, 2]); // D4 C4 B3 A3 G3
    expect([39, 40, 41, 42].map(at)).toEqual([0, 1, 1, 2]); // G5 A5 B5 C6
    expect(at(34)).toBe(0);
  });
});
