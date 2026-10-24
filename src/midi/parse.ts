import type { NoteEvent } from './types';

/**
 * MIDI メッセージをノートイベントにする。ノート以外（アクティブセンシング、
 * コントロールチェンジ等）は null。velocity 0 のノートオンは離鍵として扱う。
 */
export function parseMidiMessage(data: ArrayLike<number>, time: number): NoteEvent | null {
  if (data.length < 3) return null;
  const kind = data[0] & 0xf0;
  const note = data[1] & 0x7f;
  const velocity = data[2] & 0x7f;
  if (kind === 0x90 && velocity > 0) return { type: 'on', note, velocity, time, source: 'midi' };
  if (kind === 0x80 || kind === 0x90) return { type: 'off', note, velocity: 0, time, source: 'midi' };
  return null;
}
