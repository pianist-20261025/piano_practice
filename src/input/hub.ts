import type { NoteEvent, NoteListener } from '../midi/types';

/** 全入力元のノートイベントを1か所に集める。押下中の音も追跡する。 */
export class InputHub {
  private listeners = new Set<NoteListener>();
  private held = new Set<number>();

  emit = (ev: NoteEvent): void => {
    if (ev.type === 'on') this.held.add(ev.note);
    else this.held.delete(ev.note);
    this.listeners.forEach((fn) => fn(ev));
  };

  subscribe(fn: NoteListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  heldNotes(): number[] {
    return [...this.held].sort((a, b) => a - b);
  }
}
