import { Accidental, Beam, Formatter, Renderer, Stave, StaveConnector, StaveNote, Voice } from 'vexflow';
import type { Phrase } from '../generator/phrase';
import type { Clef } from '../music/clef';
import { measureAccidentals, vexKeyName } from '../music/key';
import { pitchName, pitchToMidi, toVexKey, type Pitch } from '../music/pitch';
import type { StaffLayout } from './staffRenderer';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SCALE = 1.5;
const MARGIN_X = 24;
const MARGIN_TOP = 30;
/** 1小節の幅（最初の小節は音部記号・調号のぶん広げる） */
const MEASURE_WIDTH = 220;
const GRAND_GAP = 110;
const SINGLE_HEIGHT = 170;
const DURATIONS: Record<number, string> = { 0.5: '8', 1: 'q', 2: 'h', 4: 'w' };
const VEX_ACCIDENTALS: Record<number, string> = { [-2]: 'bb', [-1]: 'b', 0: 'n', 1: '#', 2: '##' };
/** 大譜表で音のない段に置く全休符の位置 */
const REST_KEY: Record<Clef, string> = { treble: 'b/4', bass: 'd/3' };

export interface PhraseLayout {
  /** 音符ごとの符頭の中心 x（CSS px） */
  noteX: number[];
  /** フレーズの終わり（最後の小節線）の x（CSS px） */
  endX: number;
  width: number;
}

/** 流れ読み用に、フレーズ全体を横に長い1段（または大譜表）に描く。スクロールは呼び出し側が行う */
export class PhraseRenderer {
  private notes: StaveNote[] = [];
  private staveOf: Stave[] = [];
  /** 小節ごとの段（大譜表なら上下2つ） */
  private measureStaves: Partial<Record<Clef, Stave>>[] = [];
  private noteMeasure: number[] = [];
  private svg: SVGSVGElement | null = null;

  constructor(private readonly container: HTMLElement) {}

  render(phrase: Phrase, layout: StaffLayout, ink: string): PhraseLayout {
    const clefs: Clef[] = layout === 'grand' ? ['treble', 'bass'] : [layout];
    // 最初の小節の、音部記号と調号の幅を測る
    const probe = new Stave(0, 0, MEASURE_WIDTH).addClef(clefs[0]);
    if (phrase.keyFifths) probe.addKeySignature(vexKeyName(phrase.keyFifths));
    const lead = probe.getNoteStartX() - probe.getX();
    const totalWidth = MARGIN_X * 2 + lead + phrase.measures * MEASURE_WIDTH;
    const height = layout === 'grand' ? SINGLE_HEIGHT + GRAND_GAP : SINGLE_HEIGHT;

    this.container.replaceChildren();
    const renderer = new Renderer(this.container as HTMLDivElement, Renderer.Backends.SVG);
    renderer.resize(totalWidth * SCALE, height * SCALE);
    const ctx = renderer.getContext();
    ctx.scale(SCALE, SCALE);
    ctx.setFillStyle(ink);
    ctx.setStrokeStyle(ink);
    this.svg = this.container.querySelector('svg');

    this.notes = new Array(phrase.notes.length);
    this.staveOf = new Array(phrase.notes.length);
    this.measureStaves = [];
    this.noteMeasure = phrase.notes.map((n) => n.measure);
    let x = MARGIN_X;
    let endX = 0;
    for (let m = 0; m < phrase.measures; m++) {
      const width = MEASURE_WIDTH + (m === 0 ? lead : 0);
      const staves = clefs.map((clef, row) => {
        const stave = new Stave(x, MARGIN_TOP + row * GRAND_GAP, width);
        if (m === 0) {
          stave.addClef(clef);
          if (phrase.keyFifths) stave.addKeySignature(vexKeyName(phrase.keyFifths));
        }
        if (m === phrase.measures - 1) stave.setEndBarType(3 /* BarlineType.END */);
        stave.setContext(ctx).draw();
        return stave;
      });
      this.measureStaves.push(Object.fromEntries(clefs.map((c, row) => [c, staves[row]])));
      if (m === 0 && clefs.length === 2) {
        for (const type of ['brace', 'singleLeft'] as const) new StaveConnector(staves[0], staves[1]).setType(type).setContext(ctx).draw();
      }
      if (m === phrase.measures - 1 && clefs.length === 2) {
        new StaveConnector(staves[0], staves[1]).setType('boldDoubleRight').setContext(ctx).draw();
      }

      const voices: Voice[] = [];
      const beams: Beam[] = [];
      clefs.forEach((clef, row) => {
        const indices = phrase.notes.map((n, i) => (n.measure === m && n.clef === clef ? i : -1)).filter((i) => i >= 0);
        const accs = measureAccidentals(indices.map((i) => phrase.notes[i].pitch), phrase.keyFifths);
        const staveNotes = indices.map((i, j) => {
          const n = phrase.notes[i];
          const note = new StaveNote({ clef, keys: [toVexKey(n.pitch)], duration: DURATIONS[n.duration], auto_stem: true });
          if (accs[j] !== null) note.addModifier(new Accidental(VEX_ACCIDENTALS[accs[j]!]), 0);
          this.notes[i] = note;
          this.staveOf[i] = staves[row];
          return note;
        });
        const tickables = staveNotes.length
          ? staveNotes
          : [new StaveNote({ clef, keys: [REST_KEY[clef]], duration: 'wr', align_center: true })];
        const voice = new Voice({ num_beats: phrase.beatsPerMeasure, beat_value: 4 }).setMode(Voice.Mode.SOFT).addTickables(tickables);
        voice.setStave(staves[row]);
        voices.push(voice);
        beams.push(...Beam.generateBeams(staveNotes.filter((n) => n.getDuration() === '8')));
      });
      const first = staves[0];
      new Formatter().joinVoices(voices).format(voices, first.getX() + first.getWidth() - first.getNoteStartX() - 16);
      voices.forEach((v, row) => v.draw(ctx, staves[row]));
      beams.forEach((b) => b.setContext(ctx).draw());
      x += width;
      endX = x;
    }

    const noteX = this.notes.map((n) => (n.getAbsoluteX() + n.getGlyphWidth() / 2) * SCALE);
    return { noteX, endX: endX * SCALE, width: totalWidth * SCALE };
  }

  /** i 番目の音の符頭に色を付ける */
  colorNote(i: number, color: string): void {
    const el = this.notes[i]?.getSVGElement();
    if (!el) return;
    const heads = el.querySelectorAll<SVGElement>('.vf-notehead path, .vf-notehead');
    (heads.length ? heads : el.querySelectorAll<SVGElement>('path')).forEach((p) => {
      p.style.fill = color;
      p.style.stroke = color;
    });
  }

  /**
   * i 番目の音の位置に、実際に押した音を赤い符頭で重ねる（音名も添える）。
   * 大譜表では押した音の高さで段を選ぶ（中央ド以上は上の段）
   */
  markWrong(i: number, pitch: Pitch, color: string): void {
    const note = this.notes[i];
    const staves = this.measureStaves[this.noteMeasure[i]] ?? {};
    const grand = !!staves.treble && !!staves.bass;
    const clef: Clef = grand ? (pitchToMidi(pitch) >= 60 ? 'treble' : 'bass') : staves.treble ? 'treble' : 'bass';
    const stave = staves[clef] ?? this.staveOf[i];
    if (!note || !stave || !this.svg) return;
    const probe = new StaveNote({ clef, keys: [toVexKey(pitch)], duration: 'q' });
    const line = probe.getKeyProps()[0].line;
    const cx = note.getAbsoluteX() + note.getGlyphWidth() / 2 + 12;
    const cy = stave.getYForNote(line);
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'wrong-note');
    g.style.fill = color;
    g.style.stroke = color;
    // 五線の外なら加線も引く（線は line が整数の位置。第1線=1、第5線=5）
    for (let l = 6; l <= line; l++) g.append(svgLine(cx - 8, stave.getYForNote(l), cx + 8));
    for (let l = 0; l >= line; l--) g.append(svgLine(cx - 8, stave.getYForNote(l), cx + 8));
    const head = document.createElementNS(SVG_NS, 'ellipse');
    head.setAttribute('cx', String(cx));
    head.setAttribute('cy', String(cy));
    head.setAttribute('rx', '5.5');
    head.setAttribute('ry', '4');
    head.setAttribute('transform', `rotate(-20 ${cx} ${cy})`);
    head.setAttribute('opacity', '0.85');
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', String(cx + 8));
    label.setAttribute('y', String(cy + 3));
    label.setAttribute('font-size', '8');
    label.setAttribute('stroke', 'none');
    label.textContent = pitchName(pitch);
    g.append(head, label);
    this.svg.append(g);
  }
}

function svgLine(x1: number, y: number, x2: number): SVGLineElement {
  const l = document.createElementNS(SVG_NS, 'line');
  l.setAttribute('x1', String(x1));
  l.setAttribute('x2', String(x2));
  l.setAttribute('y1', String(y));
  l.setAttribute('y2', String(y));
  l.setAttribute('stroke-width', '1');
  return l;
}

