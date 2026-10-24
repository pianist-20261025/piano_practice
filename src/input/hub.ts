import type { NoteEvent, NoteListener } from '../midi/types';

/**
 * 全入力元のノートイベントを1か所に集める。押下中の音と、ダンパーペダルで伸びている音も追跡する
 * （曲モードで「同じ音が鳴り続けている」かを判断するため。ペダル自体は判定しない）。
 */
export class InputHub {
  private listeners = new Set<NoteListener>();
  private held = new Set<number>();
  /** 押さえている鍵盤を押した時刻 */
  private pressedAt = new Map<number, number>();
  private pedalDown = false;
  /** 鍵盤は離したが、ペダルで鳴り続けている音 */
  private pedalSustained = new Set<number>();

  emit = (ev: NoteEvent): void => {
    if (ev.type === 'on') {
      this.held.add(ev.note);
      this.pressedAt.set(ev.note, ev.time);
      this.pedalSustained.delete(ev.note);
    } else {
      this.held.delete(ev.note);
      this.pressedAt.delete(ev.note);
      if (this.pedalDown) this.pedalSustained.add(ev.note);
    }
    this.listeners.forEach((fn) => fn(ev));
  };

  /** ダンパーペダルの踏み込み・解放 */
  setPedal = (down: boolean): void => {
    this.pedalDown = down;
    if (!down) this.pedalSustained.clear();
  };

  subscribe(fn: NoteListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  heldNotes(): number[] {
    return [...this.held].sort((a, b) => a - b);
  }

  /** その鍵盤を押さえ始めた時刻。押さえていなければ undefined */
  heldSince(note: number): number | undefined {
    return this.pressedAt.get(note);
  }

  /** いま鳴っている音（押さえている鍵盤＋ペダルで伸びている音） */
  soundingNotes(): number[] {
    return [...new Set([...this.held, ...this.pedalSustained])].sort((a, b) => a - b);
  }
}
