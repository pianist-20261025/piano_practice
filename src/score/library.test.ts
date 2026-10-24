import { describe, expect, it } from 'vitest';
import { songTitle } from './library';

describe('songTitle', () => {
  it('movement-title を優先し、なければ work-title、credit-words の順', () => {
    expect(songTitle('a.musicxml', '<work><work-title>W</work-title></work><movement-title>M</movement-title>')).toBe('M');
    expect(songTitle('a.musicxml', '<work><work-title>W</work-title></work>')).toBe('W');
    expect(songTitle('a.musicxml', '<credit><credit-words default-x="1">Credit</credit-words></credit>')).toBe('Credit');
  });

  it('XML の文字参照を戻す', () => {
    expect(songTitle('a.xml', '<movement-title>Bach &amp; Sons</movement-title>')).toBe('Bach & Sons');
  });

  it('曲名がなければファイル名。.mxl は中を読まない', () => {
    expect(songTitle('Minuet in G.musicxml', '<score-partwise/>')).toBe('Minuet in G');
    expect(songTitle('Sonatina.mxl', 'PK\u0003\u0004<movement-title>X</movement-title>')).toBe('Sonatina');
  });
});
