import { describe, expect, it } from 'vitest';
import { staffRange } from './clef';
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
