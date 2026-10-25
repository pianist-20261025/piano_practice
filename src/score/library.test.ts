import { describe, expect, it } from 'vitest';
import { checkMusicXml, songTitle } from './library';

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

describe('checkMusicXml', () => {
  it('MusicXML ならそのまま返す', () => {
    const xml = '<?xml version="1.0"?><score-partwise version="4.0"><part-list/></score-partwise>';
    expect(checkMusicXml(xml)).toBe(xml);
    expect(checkMusicXml('<score-timewise>')).toBe('<score-timewise>');
  });

  it('PDF やほかのファイルは理由つきのエラー', () => {
    expect(() => checkMusicXml('%PDF-1.7 ...')).toThrow(/PDF/);
    expect(() => checkMusicXml('<html></html>')).toThrow(/MusicXML/);
  });
});
