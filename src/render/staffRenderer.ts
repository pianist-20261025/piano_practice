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
import { diatonicIndex, toVexKey, type Pitch } from '../music/pitch';

/** 期待音の表示状態。pending=未回答（黒）、correct=押せた（緑）、missing=足りない（橙） */
export type NoteState = 'pending' | 'correct' | 'missing';
export type StaffLayout = Clef | 'grand';

export interface StaffView {
  layout: StaffLayout;
  /** 音符を書く段（大譜表のときに上下どちらか） */
  clef: Clef;
  keyFifths: number;
  /** 期待音（単音なら1つ、和音なら複数） */
  expected: { pitch: Pitch; state: NoteState }[];
  /** 押すべきでないのに押した音。期待音のすぐ右に赤で重ねる */
  extra?: Pitch[];
  /** 大譜表で音ごとに段を決める（曲モード用）。なければすべて clef の段に書く */
  noteClef?: (pitch: Pitch) => Clef;
}

export interface StaffColors {
  ink: string;
  correct: string;
  wrong: string;
  missing: string;
}

const SCALE = 1.8;
/** 大譜表の括弧が切れない左右の余白 */
const MARGIN_X = 24;
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
/** 押した音を期待音の右にずらす最小量 */
const PLAYED_SHIFT = 42;
/** 期待音の右端と押した音（臨時記号を含む）の左端の間 */
const PLAYED_GAP = 8;

/** VexFlow で1小節分の五線（または大譜表）に単音・和音を描く。 */
export class StaffRenderer {
  constructor(
    private readonly container: HTMLElement,
    private readonly colors: () => StaffColors,
  ) {}

  render(view: StaffView): void {
    const colors = this.colors();
    const stateColor: Record<NoteState, string> = { pending: colors.ink, correct: colors.correct, missing: colors.missing };
    const clefs: readonly Clef[] = view.layout === 'grand' ? ['treble', 'bass'] : [view.layout];
    const clefOf = (p: Pitch): Clef => (view.layout === 'grand' && view.noteClef ? view.noteClef(p) : view.clef);

    // 段ごとに、期待音の和音と押した音（余計な音）の和音を作る
    const chords = clefs.map((clef) => {
      const exp = view.expected.filter((e) => clefOf(e.pitch) === clef);
      const ext = (view.extra ?? []).filter((p) => clefOf(p) === clef);
      return {
        clef,
        expected: exp.length
          ? makeChord(clef, exp.map((e) => ({ pitch: e.pitch, color: stateColor[e.state] })), view.keyFifths, colors.ink)
          : null,
        played: ext.length ? makeChord(clef, ext.map((pitch) => ({ pitch, color: colors.wrong })), view.keyFifths, colors.wrong) : null,
      };
    });

    // 五線から大きく外れた音（押し間違いで低すぎる音など）も切れないよう、上下の余白を広げる。
    // 大譜表では上段の音が上に、下段の音が下にはみ出す分だけを見る
    const linesOf = (clef: Clef) =>
      chords.filter((c) => c.clef === clef).flatMap((c) => [c.expected, c.played].flatMap((n) => (n ? n.getKeyProps().map((k) => k.line) : [])));
    const upper = linesOf(clefs[0]);
    const lower = linesOf(clefs[clefs.length - 1]);
    const above = upper.length ? Math.max(0, Math.max(...upper) - 11) * LINE_SPACE : 0;
    const below = lower.length ? Math.max(0, -4 - Math.min(...lower)) * LINE_SPACE : 0;
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

    // 音符は調号の後ろの空きの中央あたりに置く（どの段も調号の幅は同じ）
    const first = staves[clefs[0]]!;
    const x = (first.getX() + first.getWidth() - first.getNoteStartX()) / 2 - PLAYED_SHIFT / 2 - 10;
    for (const c of chords) {
      const stave = staves[c.clef]!;
      if (c.expected) {
        place(ctx, stave, c.expected, x);
        c.expected.draw();
      }
      if (c.played) {
        place(ctx, stave, c.played, 0);
        // 2度で横にずれた符頭や臨時記号があっても重ならないよう、実際の幅から間隔を決める
        const e = c.expected?.getMetrics();
        const gap = e ? e.notePx + e.rightDisplacedHeadPx + e.modRightPx + c.played.getMetrics().modLeftPx + PLAYED_GAP : 0;
        c.played.getTickContext().setX(x + Math.max(PLAYED_SHIFT, gap));
        c.played.draw();
      }
    }
  }
}

function makeStave(ctx: RenderContext, clef: Clef, y: number, keyFifths: number): Stave {
  const stave = new Stave(MARGIN_X, y, STAVE_WIDTH);
  stave.addClef(clef);
  if (keyFifths !== 0) stave.addKeySignature(vexKeyName(keyFifths));
  stave.setContext(ctx).draw();
  return stave;
}

/** Formatter を使わず、音符を五線上の指定位置に置く（描くのは呼び出し側） */
function place(ctx: RenderContext, stave: Stave, note: StaveNote, x: number): void {
  note.setStave(stave).setContext(ctx);
  note.addToModifierContext(new ModifierContext());
  new TickContext().addTickable(note).preFormat().setX(x);
}

const VEX_ACCIDENTALS: Record<number, string> = { [-2]: 'bb', [-1]: 'b', 0: 'n', 1: '#', 2: '##' };

/** 全音符の和音（単音も可）。音ごとに色を付ける。加線は全音が同じ色ならその色、混在なら fallback */
function makeChord(clef: Clef, notes: { pitch: Pitch; color: string }[], keyFifths: number, fallback: string): StaveNote {
  // VexFlow のキー番号と色の対応がずれないよう、低い順に並べてから渡す
  const sorted = [...notes].sort((a, b) => diatonicIndex(a.pitch) - diatonicIndex(b.pitch) || a.pitch.alter - b.pitch.alter);
  const note = new StaveNote({ clef, keys: sorted.map((n) => toVexKey(n.pitch)), duration: 'w', align_center: true });
  sorted.forEach(({ pitch, color }, i) => {
    const style = { fillStyle: color, strokeStyle: color };
    note.setKeyStyle(i, style);
    const acc = displayedAccidental(pitch, keyFifths);
    if (acc !== null) note.addModifier(new Accidental(VEX_ACCIDENTALS[acc]).setStyle(style), i);
  });
  const colors = new Set(sorted.map((n) => n.color));
  const ledger = colors.size === 1 ? sorted[0].color : fallback;
  note.setLedgerLineStyle({ fillStyle: ledger, strokeStyle: ledger });
  return note;
}
