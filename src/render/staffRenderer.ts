import {
  Accidental,
  ModifierContext,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  TickContext,
  type RenderContext,
} from 'vexflow';
import type { Clef } from '../music/clef';
import { displayedAccidental, vexKeyName } from '../music/key';
import { toVexKey, type Pitch } from '../music/pitch';

export type NoteStatus = 'pending' | 'correct' | 'wrong';
export type StaffLayout = Clef | 'grand';

export interface SingleNoteView {
  layout: StaffLayout;
  /** 音符を書く段（大譜表のときに上下どちらか） */
  clef: Clef;
  keyFifths: number;
  expected: Pitch;
  status: NoteStatus;
  /** 間違えたときに押した音。期待音と同じ段に重ねて表示する */
  played?: Pitch;
}

export interface StaffColors {
  ink: string;
  correct: string;
  wrong: string;
}

const SCALE = 1.8;
const MARGIN_X = 10;
/** 五線の上の余白（VexFlow の Stave は y から線4本ぶん下に第5線を引く） */
const MARGIN_TOP = 30;
/** 1段ぶんの高さ（余白込み） */
const SINGLE_HEIGHT = 170;
/** 大譜表の上段と下段の y の差 */
const GRAND_GAP = 110;
/** 五線の線1本ぶん（VexFlow の line 1 単位）の高さ */
const LINE_SPACE = 10;
/** 調号7つでも音符が収まる幅 */
const STAVE_WIDTH = 280;
/** 押した音を期待音の右にずらす量 */
const PLAYED_SHIFT = 42;

/** VexFlow で1小節分の五線（または大譜表）に単音を描く。 */
export class StaffRenderer {
  constructor(
    private readonly container: HTMLElement,
    private readonly colors: () => StaffColors,
  ) {}

  render(view: SingleNoteView): void {
    const colors = this.colors();
    const expectedColor = view.status === 'correct' ? colors.correct : colors.ink;
    const expected = makeNote(view.clef, view.expected, view.keyFifths, expectedColor);
    const played =
      view.status === 'wrong' && view.played ? makeNote(view.clef, view.played, view.keyFifths, colors.wrong) : null;

    // 五線から大きく外れた音（押し間違いで低すぎる音など）も切れないよう、上下の余白を広げる。
    // 大譜表では上段の音が上に、下段の音が下にはみ出す分だけを見る
    const lines = [expected, played].flatMap((n) => (n ? n.getKeyProps().map((k) => k.line) : []));
    const growsUp = view.layout !== 'grand' || view.clef === 'treble';
    const growsDown = view.layout !== 'grand' || view.clef === 'bass';
    const above = growsUp ? Math.max(0, Math.max(...lines) - 11) * LINE_SPACE : 0;
    const below = growsDown ? Math.max(0, -4 - Math.min(...lines)) * LINE_SPACE : 0;
    const baseHeight = view.layout === 'grand' ? SINGLE_HEIGHT + GRAND_GAP : SINGLE_HEIGHT;

    this.container.replaceChildren();
    const renderer = new Renderer(this.container as HTMLDivElement, Renderer.Backends.SVG);
    renderer.resize((STAVE_WIDTH + 2 * MARGIN_X) * SCALE, (baseHeight + above + below) * SCALE);
    const ctx = renderer.getContext();
    ctx.scale(SCALE, SCALE);
    ctx.setFillStyle(colors.ink);
    ctx.setStrokeStyle(colors.ink);

    const top = MARGIN_TOP + above;
    const staves: Partial<Record<Clef, Stave>> = {};
    if (view.layout === 'grand') {
      staves.treble = makeStave(ctx, 'treble', top, view.keyFifths);
      staves.bass = makeStave(ctx, 'bass', top + GRAND_GAP, view.keyFifths);
      for (const type of ['brace', 'singleLeft', 'singleRight'] as const) {
        new StaveConnector(staves.treble, staves.bass).setType(type).setContext(ctx).draw();
      }
    } else {
      staves[view.layout] = makeStave(ctx, view.layout, top, view.keyFifths);
    }

    const stave = staves[view.clef]!;
    // 音符は調号の後ろの空きの中央あたりに置く
    const free = stave.getX() + stave.getWidth() - stave.getNoteStartX();
    const x = free / 2 - PLAYED_SHIFT / 2 - 10;
    drawAt(ctx, stave, expected, x);
    if (played) drawAt(ctx, stave, played, x + PLAYED_SHIFT);
  }
}

function makeStave(ctx: RenderContext, clef: Clef, y: number, keyFifths: number): Stave {
  const stave = new Stave(MARGIN_X, y, STAVE_WIDTH);
  stave.addClef(clef);
  if (keyFifths !== 0) stave.addKeySignature(vexKeyName(keyFifths));
  stave.setContext(ctx).draw();
  return stave;
}

/** Formatter を使わず、音符を五線上の指定位置に置いて描く */
function drawAt(ctx: RenderContext, stave: Stave, note: StaveNote, x: number): void {
  note.setStave(stave).setContext(ctx);
  note.addToModifierContext(new ModifierContext());
  new TickContext().addTickable(note).preFormat().setX(x);
  note.draw();
}

const VEX_ACCIDENTALS: Record<number, string> = { [-2]: 'bb', [-1]: 'b', 0: 'n', 1: '#', 2: '##' };

function makeNote(clef: Clef, pitch: Pitch, keyFifths: number, color: string): StaveNote {
  const note = new StaveNote({ clef, keys: [toVexKey(pitch)], duration: 'w', align_center: true });
  const acc = displayedAccidental(pitch, keyFifths);
  if (acc !== null) {
    note.addModifier(new Accidental(VEX_ACCIDENTALS[acc]).setStyle({ fillStyle: color, strokeStyle: color }), 0);
  }
  note.setStyle({ fillStyle: color, strokeStyle: color });
  note.setLedgerLineStyle({ fillStyle: color, strokeStyle: color });
  return note;
}
