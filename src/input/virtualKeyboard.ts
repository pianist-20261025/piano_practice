import type { NoteListener } from '../midi/types';

const BLACK = new Set([1, 3, 6, 8, 10]);
export const isBlackKey = (note: number) => BLACK.has(((note % 12) + 12) % 12);

/** 画面上の鍵盤。クリック／タッチで押鍵し、他の入力元で押された鍵盤も光らせる。 */
export class VirtualKeyboard {
  private keys = new Map<number, HTMLElement>();
  private pointerNotes = new Map<number, number>();

  constructor(
    private readonly container: HTMLElement,
    private readonly onNote: NoteListener,
    private readonly low = 48,
    private readonly high = 96,
  ) {
    this.build();
  }

  private build(): void {
    this.container.classList.add('vkb');
    this.container.replaceChildren();
    const whites = document.createElement('div');
    whites.className = 'vkb-whites';
    this.container.append(whites);
    let whiteIndex = 0;
    for (let n = this.low; n <= this.high; n++) {
      const key = document.createElement('div');
      key.dataset.note = String(n);
      if (isBlackKey(n)) {
        key.className = 'vkb-key black';
        // 直前の白鍵の右端にかぶせる
        key.style.left = `calc(${whiteIndex} * var(--white-w) - var(--black-w) / 2)`;
        whites.append(key);
      } else {
        key.className = 'vkb-key white';
        if (n % 12 === 0) key.textContent = `C${n / 12 - 1}`;
        whites.append(key);
        whiteIndex++;
      }
      this.keys.set(n, key);
    }
    this.container.addEventListener('pointerdown', this.handleDown);
    this.container.addEventListener('pointerup', this.handleUp);
    this.container.addEventListener('pointercancel', this.handleUp);
    this.container.addEventListener('pointerleave', this.handleUp);
  }

  /** 押下状態の表示を更新する（入力元を問わない） */
  setHeld(note: number, held: boolean): void {
    this.keys.get(note)?.classList.toggle('held', held);
  }

  /** 指定の音が見える位置までスクロールする */
  scrollToNote(note: number): void {
    this.keys.get(note)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  private handleDown = (e: PointerEvent) => {
    const note = Number((e.target as HTMLElement).dataset?.note);
    if (!Number.isFinite(note) || !this.keys.has(note)) return;
    e.preventDefault();
    this.release(e.pointerId, e.timeStamp);
    this.pointerNotes.set(e.pointerId, note);
    this.onNote({ type: 'on', note, velocity: 80, time: e.timeStamp, source: 'virtual' });
  };

  private handleUp = (e: PointerEvent) => this.release(e.pointerId, e.timeStamp);

  private release(pointerId: number, time: number): void {
    const note = this.pointerNotes.get(pointerId);
    if (note === undefined) return;
    this.pointerNotes.delete(pointerId);
    this.onNote({ type: 'off', note, velocity: 0, time, source: 'virtual' });
  }
}
