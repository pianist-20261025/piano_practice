import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '../midi/types';
import { InputHub } from './hub';

const ev = (type: 'on' | 'off', note: number): NoteEvent => ({ type, note, velocity: type === 'on' ? 80 : 0, time: 0, source: 'midi' });

describe('InputHub: 鳴っている音', () => {
  it('押さえている鍵盤', () => {
    const hub = new InputHub();
    hub.emit(ev('on', 60));
    hub.emit(ev('on', 64));
    hub.emit(ev('off', 60));
    expect(hub.heldNotes()).toEqual([64]);
    expect(hub.soundingNotes()).toEqual([64]);
  });

  it('ペダルを踏んでいる間に離した音は鳴り続け、ペダルを上げると止まる', () => {
    const hub = new InputHub();
    hub.emit(ev('on', 60));
    hub.setPedal(true);
    hub.emit(ev('off', 60));
    expect(hub.heldNotes()).toEqual([]);
    expect(hub.soundingNotes()).toEqual([60]);
    hub.setPedal(false);
    expect(hub.soundingNotes()).toEqual([]);
  });

  it('ペダルを踏む前に離した音は鳴っていない', () => {
    const hub = new InputHub();
    hub.emit(ev('on', 60));
    hub.emit(ev('off', 60));
    hub.setPedal(true);
    expect(hub.soundingNotes()).toEqual([]);
  });
});
