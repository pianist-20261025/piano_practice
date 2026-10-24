import { Accidental, type RenderContext, ModifierContext, Renderer, Stave, StaveNote, TickContext } from 'vexflow';
import type { Clef } from '../music/clef';
import { toVexKey, vexAccidental, type Pitch } from '../music/pitch';

export type NoteStatus = 'pending' | 'correct' | 'wrong';

export interface SingleNoteView {
  clef: Clef;
  expected: Pitch;
  status: NoteStatus;
  /** 間違えたときに押した音。譜面に重ねて表示する */
  played?: Pitch;
}

export interface StaffColors {
  ink: string;
  correct: string;
  wrong: string;
}

const SCALE = 1.8;
const BASE_HEIGHT = 170;
/** 五線の線1本ぶん（VexFlow の line 1 単位）の高さ */
const LINE_SPACE = 10;
const STAVE_WIDTH = 220;
/** 期待音の位置（五線の開始位置からの距離） */
const EXPECTED_X = 60;
/** 押した音を期待音の右にずらす量 */
const PLAYED_SHIFT = 42;

/** VexFlow で1小節分の五線に単音を描く。 */
export class StaffRenderer {
  constructor(
    private readonly container: HTMLElement,
    private readonly colors: () => StaffColors,
  ) {}

  render(view: SingleNoteView): void {
    const colors = this.colors();
    const expectedColor = view.status === 'correct' ? colors.correct : colors.ink;
    const expected = makeNote(view.clef, view.expected, expectedColor);
    // 押した音は期待音のすぐ右に重ねる。臨時記号は押した音の左に付く
    const played = view.status === 'wrong' && view.played ? makeNote(view.clef, view.played, colors.wrong) : null;

    // 五線から大きく外れた音（押し間違いで低すぎる音など）も切れないよう、上下の余白を広げる
    const lines = [expected, played].flatMap((n) => (n ? n.getKeyProps().map((k) => k.line) : []));
    const above = Math.max(0, Math.max(...lines) - 11) * LINE_SPACE;
    const below = Math.max(0, -4 - Math.min(...lines)) * LINE_SPACE;

    this.container.replaceChildren();
    const renderer = new Renderer(this.container as HTMLDivElement, Renderer.Backends.SVG);
    renderer.resize((STAVE_WIDTH + 20) * SCALE, (BASE_HEIGHT + above + below) * SCALE);
    const ctx = renderer.getContext();
    ctx.scale(SCALE, SCALE);
    ctx.setFillStyle(colors.ink);
    ctx.setStrokeStyle(colors.ink);

    const stave = new Stave(10, 30 + above, STAVE_WIDTH);
    stave.addClef(view.clef).setContext(ctx).draw();
    drawAt(ctx, stave, expected, EXPECTED_X);
    if (played) drawAt(ctx, stave, played, EXPECTED_X + PLAYED_SHIFT);
  }
}

/** Formatter を使わず、音符を五線上の指定位置に置いて描く */
function drawAt(ctx: RenderContext, stave: Stave, note: StaveNote, x: number): void {
  note.setStave(stave).setContext(ctx);
  note.addToModifierContext(new ModifierContext());
  new TickContext().addTickable(note).preFormat().setX(x);
  note.draw();
}

function makeNote(clef: Clef, pitch: Pitch, color: string): StaveNote {
  const note = new StaveNote({ clef, keys: [toVexKey(pitch)], duration: 'w', align_center: true });
  const acc = vexAccidental(pitch);
  if (acc) note.addModifier(new Accidental(acc).setStyle({ fillStyle: color, strokeStyle: color }), 0);
  note.setStyle({ fillStyle: color, strokeStyle: color });
  note.setLedgerLineStyle({ fillStyle: color, strokeStyle: color });
  return note;
}
