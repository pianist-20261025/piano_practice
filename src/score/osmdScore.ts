import { OpenSheetMusicDisplay, type MusicPartManagerIterator, type Note } from 'opensheetmusicdisplay';
import type { Hand, RawEntry, RawNote } from './steps';

/** OSMD の Note.halfTone は MIDI ノート番号より 1 オクターブ低い */
const HALFTONE_TO_MIDI = 12;

export interface LoadedScore {
  title: string;
  entries: RawEntry[];
  /** 楽譜に書かれた最初のテンポ（4分音符 / 分）。なければ null */
  bpm: number | null;
  /** 最初の小節の拍子（分子 / 分母） */
  timeSignature: { numerator: number; denominator: number };
  /** カーソル位置ごとの調号（♯の数は正、♭の数は負） */
  keyFifthsAt: (entryIndex: number) => number;
}

/**
 * OpenSheetMusicDisplay で MusicXML を表示し、カーソル位置ごとの音を取り出す。
 * カーソル移動と音符の色付けもここで行う（判定ロジックは持たない）。
 */
export class OsmdScore {
  private readonly osmd: OpenSheetMusicDisplay;
  /** カーソル位置ごとのイテレータ（そこへ直接カーソルを動かすため） */
  private iterators: MusicPartManagerIterator[] = [];
  /** カーソル位置ごとの OSMD の音（RawEntry.notes と同じ順） */
  private notes: Note[][] = [];
  private colored = new Set<Note>();
  /** 音ごとの、曲頭からの位置（4分音符単位） */
  private noteTime = new Map<Note, number>();
  /** タイの後ろ側で、カーソルがそこまで来たら色を付ける音 */
  private pendingTies: { note: Note; time: number; color: string }[] = [];

  constructor(container: HTMLElement) {
    this.osmd = new OpenSheetMusicDisplay(container, {
      autoResize: true,
      backend: 'svg',
      drawTitle: true,
      drawPartNames: false,
      followCursor: true,
    });
  }

  /** xml は MusicXML の文字列。.mxl は中身をバイナリ文字列（1文字=1バイト）で渡す */
  async load(xml: string): Promise<LoadedScore> {
    await this.osmd.load(xml);
    this.osmd.render();
    this.colored.clear();
    this.noteTime.clear();
    this.pendingTies = [];
    const cursor = this.osmd.cursor;
    cursor.reset();
    cursor.show();

    const entries: RawEntry[] = [];
    const keys: number[] = [];
    this.iterators = [];
    this.notes = [];
    let key = 0;
    const it = cursor.Iterator.clone();
    for (let index = 0; !it.EndReached; index++) {
      const measure = it.CurrentMeasure;
      key = keyOf(measure?.FirstInstructionsStaffEntries ?? []) ?? key;
      const notes: Note[] = [];
      const raw: RawNote[] = [];
      for (const ve of it.CurrentVoiceEntries ?? []) {
        for (const note of ve.Notes) {
          notes.push(note);
          const tie = note.NoteTie;
          raw.push({
            midi: note.halfTone + HALFTONE_TO_MIDI,
            hand: handOf(note),
            rest: note.isRest(),
            grace: ve.IsGrace,
            tieContinuation: !!tie && tie.StartNote !== note,
            // 書かれた長さ（4分音符単位）。装飾音は時間を取らない
            duration: ve.IsGrace ? 0 : note.Length.RealValue * 4,
          });
        }
      }
      entries.push({
        index,
        measureIndex: it.CurrentMeasureIndex,
        measureNumber: measure?.MeasureNumber ?? it.CurrentMeasureIndex + 1,
        time: it.CurrentSourceTimestamp.RealValue * 4,
        notes: raw,
      });
      keys.push(key);
      this.notes.push(notes);
      for (const note of notes) if (!this.noteTime.has(note)) this.noteTime.set(note, it.CurrentSourceTimestamp.RealValue * 4);
      this.iterators.push(it.clone());
      it.moveToNextVisibleVoiceEntry(false);
    }

    const sheet = this.osmd.Sheet;
    const ts = sheet.SourceMeasures[0]?.ActiveTimeSignature;
    return {
      title: sheet.TitleString?.trim() || '',
      entries,
      bpm: sheet.DefaultStartTempoInBpm > 0 ? sheet.DefaultStartTempoInBpm : null,
      timeSignature: { numerator: ts?.Numerator ?? 4, denominator: ts?.Denominator ?? 4 },
      keyFifthsAt: (i) => keys[i] ?? 0,
    };
  }

  /** カーソルを entryIndex 番目の位置へ動かす（楽譜は自動でスクロールする） */
  moveCursor(entryIndex: number): void {
    const it = this.iterators[entryIndex];
    if (!it) return;
    const cursor = this.osmd.cursor;
    cursor.iterator = it.clone();
    cursor.show();
    cursor.update();
  }

  hideCursor(): void {
    this.osmd.cursor.hide();
  }

  /**
   * entryIndex 番目の位置の rawIndex 番目の音の符頭に色を付ける（null で元に戻す）。
   * タイの始まりの音なら、タイでつながった後ろ側の音符にも、曲がそこまで進んだとき（revealTiesUpTo）に同じ色を付ける
   */
  colorNote(entryIndex: number, rawIndex: number, color: string | null): void {
    const note = this.notes[entryIndex]?.[rawIndex];
    if (!note) return;
    this.paintNote(note, color);
    const tie = note.NoteTie;
    if (!tie || tie.StartNote !== note) return;
    const rest = tie.Notes.filter((n) => n !== note);
    this.pendingTies = this.pendingTies.filter((p) => !rest.includes(p.note));
    if (color) {
      for (const n of rest) this.pendingTies.push({ note: n, time: this.noteTime.get(n) ?? Infinity, color });
    } else {
      for (const n of rest) this.paintNote(n, null);
    }
  }

  /** 曲頭から time（4分音符単位）までにあるタイの後ろ側の音に、始まりの音と同じ色を付ける */
  revealTiesUpTo(time: number): void {
    const due = this.pendingTies.filter((p) => p.time <= time + 1e-3);
    if (!due.length) return;
    this.pendingTies = this.pendingTies.filter((p) => p.time > time + 1e-3);
    for (const p of due) this.paintNote(p.note, p.color);
  }

  private paintNote(note: Note, color: string | null): void {
    paint(this.osmd, note, color);
    if (color) this.colored.add(note);
    else this.colored.delete(note);
  }

  clearColors(): void {
    for (const note of this.colored) paint(this.osmd, note, null);
    this.colored.clear();
    this.pendingTies = [];
  }
}

function paint(osmd: OpenSheetMusicDisplay, note: Note, color: string | null): void {
  const gnote = osmd.EngravingRules.GNote(note) as unknown as { getNoteheadSVGs?: () => HTMLElement[] } | undefined;
  for (const head of gnote?.getNoteheadSVGs?.() ?? []) {
    head.querySelectorAll<SVGElement>('path').forEach((p) => {
      p.style.fill = color ?? '';
      p.style.stroke = color ?? '';
    });
  }
}

/** ピアノ譜のように1つの楽器に2段以上あれば、上の段を右手・それ以外を左手とする。1段の楽器は右手 */
function handOf(note: Note): Hand {
  const staff = note.ParentStaffEntry?.ParentStaff;
  const staves = staff?.ParentInstrument?.Staves ?? [];
  return staves.length >= 2 && staves.indexOf(staff) > 0 ? 'left' : 'right';
}

function keyOf(entries: readonly { Instructions: readonly unknown[] }[]): number | null {
  for (const e of entries) {
    for (const ins of e?.Instructions ?? []) {
      if (ins && typeof ins === 'object' && 'keyTypeOriginal' in ins) return (ins as unknown as { Key: number }).Key;
    }
  }
  return null;
}
