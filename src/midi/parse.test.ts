import { describe, expect, it } from 'vitest';
import { parseMidiMessage } from './parse';

describe('parseMidiMessage', () => {
  it('ノートオンは押鍵', () => {
    expect(parseMidiMessage([0x90, 60, 100], 12)).toEqual({ type: 'on', note: 60, velocity: 100, time: 12, source: 'midi' });
  });

  it('チャンネルが違っても読む', () => {
    expect(parseMidiMessage([0x93, 64, 50], 0)?.type).toBe('on');
  });

  it('ノートオフと velocity 0 のノートオンは離鍵', () => {
    expect(parseMidiMessage([0x80, 60, 64], 0)?.type).toBe('off');
    expect(parseMidiMessage([0x90, 60, 0], 0)?.type).toBe('off');
  });

  it('ノート以外は無視する', () => {
    expect(parseMidiMessage([0xfe], 0)).toBeNull(); // アクティブセンシング
    expect(parseMidiMessage([0xb0, 64, 127], 0)).toBeNull(); // ダンパーペダル
  });
});
