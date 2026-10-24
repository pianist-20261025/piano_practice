import type { NoteListener } from '../midi/types';

/**
 * PCキーボードの物理キー位置（KeyboardEvent.code）→ 基準音からの半音数。
 * code を使うので JIS / US 配列どちらでも同じ位置になる。
 *   W E   T Y U   O P
 *  A S D F G H J K L ;
 */
const KEY_OFFSETS: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7,
  KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
};

export function codeToNote(code: string, baseNote: number): number | null {
  const offset = KEY_OFFSETS[code];
  if (offset === undefined) return null;
  const note = baseNote + offset;
  return note >= 0 && note <= 127 ? note : null;
}

/** Z / X で1オクターブ下げる / 上げる。基準音は C4 から。 */
export class PcKeyboardInput {
  private baseNote = 60;
  private down = new Map<string, number>();

  constructor(
    private readonly onNote: NoteListener,
    private readonly onOctaveChange: (baseNote: number) => void = () => {},
  ) {}

  attach(target: Window = window): void {
    target.addEventListener('keydown', this.handleDown);
    target.addEventListener('keyup', this.handleUp);
    target.addEventListener('blur', this.releaseAll);
  }

  get base(): number {
    return this.baseNote;
  }

  private handleDown = (e: KeyboardEvent) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
    if (e.code === 'KeyZ' || e.code === 'KeyX') {
      const next = this.baseNote + (e.code === 'KeyZ' ? -12 : 12);
      if (next >= 24 && next <= 96) {
        this.releaseAll();
        this.baseNote = next;
        this.onOctaveChange(next);
      }
      return;
    }
    const note = codeToNote(e.code, this.baseNote);
    if (note === null || this.down.has(e.code)) return;
    e.preventDefault();
    this.down.set(e.code, note);
    this.onNote({ type: 'on', note, velocity: 80, time: e.timeStamp, source: 'keyboard' });
  };

  private handleUp = (e: KeyboardEvent) => {
    const note = this.down.get(e.code);
    if (note === undefined) return;
    this.down.delete(e.code);
    this.onNote({ type: 'off', note, velocity: 0, time: e.timeStamp, source: 'keyboard' });
  };

  private releaseAll = () => {
    const t = performance.now();
    this.down.forEach((note) => this.onNote({ type: 'off', note, velocity: 0, time: t, source: 'keyboard' }));
    this.down.clear();
  };
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName));
}
