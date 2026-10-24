import { DEFAULT_SHAPE_IDS, SHAPES, generateShape, shapeById } from '../generator/shape';
import { generateSingleNote, type DiatonicRange, type KeySetting } from '../generator/singleNote';
import { InputHub } from '../input/hub';
import { PcKeyboardInput } from '../input/pcKeyboard';
import { VirtualKeyboard } from '../input/virtualKeyboard';
import { judgeAttempt, type JudgeOptions } from '../judge/judge';
import { CHORD_WINDOW_RANGE, ChordGrouper, DEFAULT_CHORD_WINDOW_MS } from '../midi/chordGrouper';
import { MidiInput, type MidiStatus } from '../midi/midiInput';
import type { NoteEvent } from '../midi/types';
import { CLEFS, CLEF_LABELS, ledgerLinesAt, staffRange, type Clef } from '../music/clef';
import { KEY_FIFTHS_RANGE, keyLabel, spellMidiInKey } from '../music/key';
import { diatonicIndex, pitchFromDiatonic, pitchName, pitchToMidi, type Pitch } from '../music/pitch';
import { StaffRenderer, type StaffColors, type StaffLayout } from '../render/staffRenderer';
import { makeWeightFn } from '../stats/noteStats';
import { summarize, type AnswerRecord, type Mode } from '../stats/session';
import {
  IndexedDbRecordStore,
  MemoryRecordStore,
  exportRecords,
  newRecordsOnly,
  parseExportedRecords,
  type RecordStore,
} from '../stats/store';
import { SongLibrary, loadBundledSongs, readSongFile, songTitle, type BundledSong, type LibrarySong } from '../score/library';
import type { HandSetting } from '../score/steps';
import type { Rhythm } from '../generator/phrase';
import { FlowPractice, summarizeFlow, type FlowResult } from './flowMode';
import { SongPractice, summarizeSong, type SongMode, type SongResult } from './songMode';
import { renderStats } from './statsView';

interface Settings {
  mode: Mode;
  /** 曲モード */
  songMode: SongMode;
  hands: HandSetting;
  /** null なら楽譜どおり */
  songBpm: number | null;
  toleranceMs: number;
  metronome: boolean;
  /** 'sample:<ファイル>'（同梱の曲）か 'lib:<id>'（ライブラリに追加した曲） */
  songSource: string;
  /** 流れ読み */
  flowMeasures: number;
  flowBpm: number;
  flowRhythm: Rhythm;
  /** 跳躍の上限（五線上の距離。6度なら 5） */
  flowMaxLeap: number;
  /** 形で読むモードで出す形の id */
  shapes: string[];
  /** この時間内に押した音を1つの和音とみなす（ms） */
  chordWindowMs: number;
  limitKind: 'count' | 'time';
  count: number;
  seconds: number;
  layout: StaffLayout;
  ranges: Record<Clef, DiatonicRange>;
  keyKind: KeySetting['kind'];
  keyFifths: number;
  keyMaxAccidentals: number;
  accidentals: boolean;
  octaveEquivalent: boolean;
  /** 苦手な音を多めに出す */
  focusWeak: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  mode: 'reflex',
  songMode: 'wait',
  hands: 'both',
  songBpm: null,
  toleranceMs: 100,
  metronome: true,
  songSource: 'sample:samples/minuet-g-bwv-anh114.musicxml',
  flowMeasures: 8,
  flowBpm: 60,
  flowRhythm: 'quarter',
  flowMaxLeap: 5,
  shapes: DEFAULT_SHAPE_IDS,
  chordWindowMs: DEFAULT_CHORD_WINDOW_MS,
  limitKind: 'count',
  count: 20,
  seconds: 60,
  layout: 'treble',
  ranges: { treble: staffRange('treble', 1), bass: staffRange('bass', 1) },
  keyKind: 'none',
  keyFifths: 0,
  keyMaxAccidentals: 4,
  accidentals: false,
  octaveEquivalent: false,
  focusWeak: true,
};
const SETTINGS_KEY = 'sight-reader:settings';
/** 音域の選択肢として出す加線の最大本数 */
const MAX_LEDGER_LINES = 4;
/** 正解してから次の問題を出すまでの間 */
const NEXT_DELAY_MS = 350;

const LAYOUT_LABELS: Record<StaffLayout, string> = { treble: 'ト音記号', bass: 'ヘ音記号', grand: '大譜表' };
const MODE_LABELS: Record<Mode, string> = { reflex: '反射モード', shape: '形で読むモード', song: '曲モード', flow: '流れ読みモード' };
const SONG_MODE_LABELS: Record<SongMode, string> = { wait: '待機', tempo: 'テンポ' };
const HAND_LABELS: Record<HandSetting, string> = { both: '両手', right: '右手', left: '左手' };

/** samples/index.json が読めなかったときの同梱曲 */
const FALLBACK_SAMPLES: BundledSong[] = [
  { file: 'samples/minuet-g-bwv-anh114.musicxml', title: 'メヌエット ト長調 BWV Anh. 114（前半）' },
  { file: 'samples/chorale-bwv66-6.musicxml', title: 'コラール BWV 66.6（2段にまとめたもの）' },
];
/** 以前の版で「最後に開いたファイル」を入れていた場所（ライブラリへ移す） */
const LEGACY_SONG_FILE_KEY = 'sight-reader:song-file';
/** 以前の版の songSource の値 */
const LEGACY_SOURCES: Record<string, string> = {
  minuet: 'sample:samples/minuet-g-bwv-anh114.musicxml',
  chorale: 'sample:samples/chorale-bwv66-6.musicxml',
};

interface Question {
  clef: Clef;
  keyFifths: number;
  /** 形で読むモードの形の id。単音なら null */
  shape: string | null;
  /** 低い順 */
  pitches: Pitch[];
  midis: number[];
  shownAt: number;
  attempts: number;
  record: AnswerRecord | null;
  /** 最初に押した音（譜面上の綴り） */
  firstPlayed: Pitch[] | null;
  saved: boolean;
}

type View = 'setup' | 'practice' | 'song' | 'flow' | 'result' | 'stats';
const VIEWS: readonly View[] = ['setup', 'practice', 'song', 'flow', 'result', 'stats'];

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

export class App {
  private hub = new InputHub();
  private settings = loadSettings();
  private records: AnswerRecord[] = [];
  private answered: Question[] = [];
  private question: Question | null = null;
  private running = false;
  private advancing = false;
  private deadline = 0;
  private tickTimer: number | undefined;
  private staff = new StaffRenderer($('#staff'), readColors);
  private keyboard!: VirtualKeyboard;
  private store: RecordStore = new IndexedDbRecordStore();
  /** 保存済みの全記録（苦手音の重み付けと統計に使う） */
  private history: AnswerRecord[] = [];
  private view: View = 'setup';
  private viewBeforeStats: View = 'setup';
  /** MIDI・PCキーボードの押鍵を和音にまとめる */
  private grouper = new ChordGrouper(DEFAULT_CHORD_WINDOW_MS, (chord) => this.submit(chord.notes, chord.time));
  /** 仮想鍵盤はクリックで1音ずつしか押せないので、和音の音数ぶん集めてから判定する */
  private virtualPending: { notes: number[]; time: number } | null = null;
  private song!: SongPractice;
  private flow!: FlowPractice;
  private songLibrary = new SongLibrary();
  private bundledSongs: BundledSong[] = [];
  private librarySongs: LibrarySong[] = [];

  start(): void {
    this.keyboard = new VirtualKeyboard($('#keyboard'), this.hub.emit);
    const pc = new PcKeyboardInput(this.hub.emit, (base) => this.showOctave(base));
    pc.attach();
    this.showOctave(pc.base);
    new MidiInput(this.hub.emit, (s) => this.showMidiStatus(s), this.hub.setPedal).start();

    this.hub.subscribe((ev) => {
      this.keyboard.setHeld(ev.note, ev.type === 'on');
      if (ev.type === 'on') this.handleNoteOn(ev);
    });

    this.song = new SongPractice($('#score'), $('#song-staff'), {
      persist: (record) => this.persistRecord(record),
      finished: (result) => this.finishSong(result),
      sounding: () => this.hub.soundingNotes(),
      heldSince: (midi) => this.hub.heldSince(midi),
      heldNotes: () => this.hub.heldNotes(),
      colors: readColors,
      status: (text) => ($('#song-progress').textContent = text),
      feedback: (html, kind) => {
        const el = $('#song-feedback');
        el.innerHTML = html;
        el.className = kind;
      },
    });
    $('#song-stop').addEventListener('click', () => this.finishSession());
    $('#song-skip').addEventListener('click', () => this.song.skip());
    this.flow = new FlowPractice($('#flow-viewport'), $('#flow-strip'), {
      persist: (record) => this.persistRecord(record),
      finished: (result) => this.finishFlow(result),
      colors: readColors,
      status: (text) => ($('#flow-progress').textContent = text),
      feedback: (text, kind) => {
        const el = $('#flow-feedback');
        el.textContent = text;
        el.className = kind;
      },
    });
    $('#flow-stop').addEventListener('click', () => this.finishSession());
    $<HTMLInputElement>('#song-file').addEventListener('change', (e) => this.addSongFiles(e.target as HTMLInputElement));
    $('#song-remove').addEventListener('click', () => this.removeSelectedSong());

    this.bindSettingsForm();
    $('#start').addEventListener('click', () => this.startSession());
    $('#stop').addEventListener('click', () => this.finishSession());
    $('#again').addEventListener('click', () => this.startSession());
    $('#back').addEventListener('click', () => this.showView('setup'));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && !this.running && !isFormControl(e.target)) this.startSession();
      if (e.code === 'Escape' && this.running) this.finishSession();
      if (e.code === 'ArrowRight' && this.running && this.settings.mode === 'song' && !isFormControl(e.target)) this.song.skip();
    });
    $('#show-stats').addEventListener('click', () => this.openStats());
    $('#result-stats').addEventListener('click', () => this.openStats());
    $('#stats-back').addEventListener('click', () => this.showView(this.viewBeforeStats));
    $('#export-records').addEventListener('click', () => this.exportHistory());
    $<HTMLInputElement>('#import-records').addEventListener('change', (e) => this.importHistory(e.target as HTMLInputElement));
    $('#clear-records').addEventListener('click', () => this.clearHistory());
    this.showView('setup');
    this.scrollKeyboardToRange();
    this.loadHistory();
    void this.loadSongs();
  }

  // ---- 記録 ----

  private async loadHistory(): Promise<void> {
    try {
      this.history = await this.store.all();
    } catch (e) {
      console.error(e);
      this.store = new MemoryRecordStore();
      this.showStorageWarning('記録を保存できません（このブラウザでは IndexedDB が使えないため、記録はタブを閉じると消えます）');
    }
    this.updateHistoryCount();
  }

  /** 1問ぶんの記録を保存する。やり直しの回数を含めたいので、正解したとき（または終了時）に保存する */
  private persist(q: Question): void {
    if (!q.record || q.saved) return;
    q.saved = true;
    this.persistRecord({ ...q.record });
  }

  private persistRecord(record: AnswerRecord): void {
    this.history.push(record);
    this.updateHistoryCount();
    this.store.add(record).catch((e) => {
      console.error(e);
      this.showStorageWarning('記録の保存に失敗しました');
    });
  }

  private updateHistoryCount(): void {
    $('#history-count').textContent = this.history.length ? `これまでの記録 ${this.history.length} 問` : 'まだ記録はありません';
  }

  private showStorageWarning(message: string): void {
    const el = $('#storage-warning');
    el.textContent = message;
    el.hidden = false;
  }

  private openStats(): void {
    if (this.view !== 'stats') this.viewBeforeStats = this.view;
    renderStats($('#stats-body'), this.history);
    this.showView('stats');
  }

  private exportHistory(): void {
    const blob = new Blob([exportRecords(this.history)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sight-reader-records-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  private async importHistory(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const incoming = newRecordsOnly(this.history, parseExportedRecords(await file.text()));
      await this.store.addMany(incoming);
      this.history.push(...incoming);
      this.updateHistoryCount();
      renderStats($('#stats-body'), this.history);
      alert(`${incoming.length} 問ぶんの記録を読み込みました`);
    } catch (e) {
      alert(`読み込めませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async clearHistory(): Promise<void> {
    if (!confirm(`これまでの記録 ${this.history.length} 問をすべて消します。元に戻せません。よろしいですか？`)) return;
    await this.store.clear();
    this.history = [];
    this.updateHistoryCount();
    renderStats($('#stats-body'), this.history);
  }

  // ---- セッション ----

  private startSession(): void {
    if (this.settings.mode === 'song') {
      void this.startSong();
      return;
    }
    if (this.settings.mode === 'flow') {
      this.startFlow();
      return;
    }
    this.records = [];
    this.answered = [];
    this.question = null;
    this.running = true;
    this.advancing = false;
    this.showView('practice');
    this.scrollKeyboardToRange();
    $('#feedback').textContent = '';
    $('#reaction').textContent = '';
    if (this.settings.limitKind === 'time') {
      this.deadline = performance.now() + this.settings.seconds * 1000;
      this.tickTimer = window.setInterval(() => this.tick(), 200);
    }
    this.nextQuestion();
  }

  private tick(): void {
    if (performance.now() >= this.deadline) this.finishSession();
    else this.updateProgress();
  }

  private nextQuestion(): void {
    this.advancing = false;
    this.grouper.reset();
    this.virtualPending = null;
    if (this.settings.limitKind === 'count' && this.records.length >= this.settings.count) {
      this.finishSession();
      return;
    }
    const s = this.settings;
    const prev = this.question;
    const common = { clefs: s.layout === 'grand' ? CLEFS : [s.layout], ranges: s.ranges, key: keySetting(s), accidentals: s.accidentals };
    let generated: { clef: Clef; keyFifths: number; shape: string | null; pitches: Pitch[] };
    try {
      if (s.mode === 'shape') {
        const g = generateShape(
          { ...common, shapes: s.shapes },
          Math.random,
          prev?.shape ? { clef: prev.clef, keyFifths: prev.keyFifths, shape: prev.shape, pitches: prev.pitches } : undefined,
        );
        generated = g;
      } else {
        const g = generateSingleNote(
          { ...common, weight: s.focusWeak ? makeWeightFn(this.history) : undefined },
          Math.random,
          prev && !prev.shape ? { clef: prev.clef, keyFifths: prev.keyFifths, pitch: prev.pitches[0] } : undefined,
        );
        generated = { ...g, shape: null, pitches: [g.pitch] };
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
      this.finishSession();
      return;
    }
    this.question = {
      ...generated,
      midis: generated.pitches.map(pitchToMidi),
      shownAt: 0,
      attempts: 0,
      record: null,
      firstPlayed: null,
      saved: false,
    };
    this.renderQuestion('pending');
    this.question.shownAt = performance.now();
    $('#feedback').textContent = '';
    $('#feedback').className = '';
    const keyText = generated.keyFifths !== 0 || s.keyKind !== 'none' ? keyLabel(generated.keyFifths) : '';
    $('#key-name').textContent = [generated.shape ? shapeById(generated.shape)?.label : '', keyText].filter(Boolean).join('　');
    this.updateProgress();
  }

  /** pending=未回答、correct=全部正解、それ以外は判定結果に応じて色分け */
  private renderQuestion(status: 'pending' | 'correct', result?: { missing: number[]; extra: Pitch[] }): void {
    const q = this.question!;
    const chord = q.pitches.length > 1;
    this.staff.render({
      layout: this.settings.layout,
      clef: q.clef,
      keyFifths: q.keyFifths,
      expected: q.pitches.map((pitch, i) => ({
        pitch,
        // 単音で間違えたときは期待音はそのまま黒。和音では押せた音を緑、足りない音を橙にする
        state: status === 'correct' ? 'correct' : !result || !chord ? 'pending' : result.missing.includes(q.midis[i]) ? 'missing' : 'correct',
      })),
      extra: result?.extra,
    });
  }

  private handleNoteOn(ev: NoteEvent): void {
    if (this.settings.mode === 'song' || this.settings.mode === 'flow') {
      if (this.running) (this.settings.mode === 'song' ? this.song : this.flow).noteOn(ev);
      return;
    }
    const q = this.question;
    if (!this.running || this.advancing || !q) return;
    if (q.midis.length === 1) {
      this.submit([ev.note], ev.time);
    } else if (ev.source === 'virtual') {
      const p = (this.virtualPending ??= { notes: [], time: ev.time });
      if (!p.notes.includes(ev.note)) p.notes.push(ev.note);
      if (p.notes.length >= q.midis.length) {
        this.virtualPending = null;
        this.submit(p.notes, p.time);
      }
    } else {
      this.grouper.push(ev);
    }
  }

  /** 押した音（単音または和音）を判定する */
  private submit(notes: number[], time: number): void {
    const q = this.question;
    if (!this.running || this.advancing || !q) return;
    const judgeOptions: JudgeOptions = { octaveEquivalent: this.settings.octaveEquivalent };
    const result = judgeAttempt(q.midis, { notes, time }, q.shownAt, judgeOptions);
    const center = Math.round(q.pitches.reduce((sum, p) => sum + diatonicIndex(p), 0) / q.pitches.length);
    const sorted = [...notes].sort((a, b) => a - b);
    const played = sorted.map((n) => spellMidiInKey(n, q.keyFifths, center));
    q.attempts++;
    if (!q.record) {
      q.record = {
        timestamp: Date.now(),
        mode: q.shape ? 'shape' : 'reflex',
        ...(q.shape ? { shape: q.shape } : {}),
        clef: q.clef,
        keyFifths: q.keyFifths,
        expected: [...q.midis],
        played: sorted,
        correct: result.isCorrect,
        reactionMs: result.reactionMs,
        attempts: 1,
      };
      q.firstPlayed = played;
      this.records.push(q.record);
      this.answered.push(q);
      $('#reaction').textContent = `反応時間 ${formatMs(result.reactionMs)}`;
    } else {
      q.record.attempts = q.attempts;
    }

    const feedback = $('#feedback');
    if (result.isCorrect) {
      this.renderQuestion('correct');
      feedback.textContent = q.attempts === 1 ? '正解' : '正解（やり直し）';
      feedback.className = 'ok';
      this.advancing = true;
      this.persist(q);
      this.updateProgress();
      window.setTimeout(() => this.running && this.nextQuestion(), NEXT_DELAY_MS);
      return;
    }
    const extra = played.filter((_, i) => result.extra.includes(sorted[i]));
    this.renderQuestion('pending', { missing: result.missing, extra });
    if (q.midis.length === 1) {
      feedback.innerHTML = `押した音: ${names(played)}`;
    } else {
      const missing = q.pitches.filter((_, i) => result.missing.includes(q.midis[i]));
      feedback.innerHTML = [
        missing.length ? `<span class="missing">足りない音: ${names(missing)}</span>` : '',
        extra.length ? `<span class="extra">余計な音: ${names(extra)}</span>` : '',
      ]
        .filter(Boolean)
        .join('　');
    }
    feedback.className = 'ng';
    this.updateProgress();
  }

  private finishSession(): void {
    if (!this.running) return;
    if (this.settings.mode === 'song') {
      // 結果は SongPractice から finishSong に届く
      this.song.stop();
      return;
    }
    if (this.settings.mode === 'flow') {
      this.flow.stop();
      return;
    }
    this.running = false;
    window.clearInterval(this.tickTimer);
    if (this.question) this.persist(this.question);
    this.renderResult();
    this.showView('result');
  }

  // ---- 流れ読みモード ----

  private startFlow(): void {
    const s = this.settings;
    this.showView('flow');
    this.scrollKeyboardToRange();
    $('#flow-key').textContent = '';
    this.running = true;
    try {
      this.flow.start({
        layout: s.layout,
        phrase: {
          ranges: s.ranges,
          key: keySetting(s),
          accidentals: s.accidentals,
          measures: s.flowMeasures,
          rhythm: s.flowRhythm,
          maxLeap: s.flowMaxLeap,
        },
        bpm: s.flowBpm,
        toleranceMs: s.toleranceMs,
        metronome: s.metronome,
        judge: { octaveEquivalent: s.octaveEquivalent },
      });
    } catch (e) {
      this.running = false;
      alert(`始められませんでした: ${e instanceof Error ? e.message : String(e)}`);
      this.showView('setup');
    }
  }

  private finishFlow(result: FlowResult): void {
    this.running = false;
    const s = summarizeFlow(result);
    const t = s.timing;
    $('#result-title').textContent = `結果: 流れ読み（♩=${result.settings.bpm}、${result.phrase.measures}小節）`;
    $('#summary').innerHTML = [
      `<div class="stat"><span class="label">正答率</span><span class="value">${Math.round(s.accuracy * 100)}<small>%</small></span><span class="sub">${s.correct} / ${s.played} 音（全 ${result.phrase.notes.length}）</span></div>`,
      `<div class="stat"><span class="label">タイミングOK（±${result.settings.toleranceMs} ms）</span><span class="value">${Math.round(t.onTimeRate * 100)}<small>%</small></span><span class="sub">押せた ${t.count} 音のうち</span></div>`,
      `<div class="stat"><span class="label">ずれの平均</span><span class="value">${t.meanAbsMs === null ? '—' : `${Math.round(t.meanAbsMs)} ms`}</span><span class="sub">${tendencyText(t.meanMs)}</span></div>`,
    ].join('');
    $('#answers-head').innerHTML = '<tr><th>小節</th><th>音</th><th>押した音</th><th>ずれ</th></tr>';
    const key = result.phrase.keyFifths;
    const rows = result.outcomes
      .filter((o) => !o.hit || o.extras.length)
      .map((o) => {
        const n = result.phrase.notes[o.index];
        const played = [...(o.hit ? [pitchToMidi(n.pitch)] : []), ...o.extras].map((m) => pitchName(spellMidiInKey(m, key, diatonicIndex(n.pitch))));
        const dev = o.deviationMs === null ? '—' : `${o.deviationMs > 0 ? '+' : ''}${Math.round(o.deviationMs)} ms`;
        return `<tr class="ng"><td>${n.measure + 1}</td><td>${pitchName(n.pitch)}</td><td class="played">${played.join('・') || '（弾かなかった）'}</td><td class="small">${dev}</td></tr>`;
      });
    $('#answers').innerHTML = rows.join('') || '<tr><td colspan="4">間違えた音はありません</td></tr>';
    this.showView('result');
  }

  // ---- 曲モード ----

  private async startSong(): Promise<void> {
    const s = this.settings;
    let source: { name: string; data: string };
    try {
      source = await this.songSource();
    } catch (e) {
      alert(`曲を読み込めませんでした: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    this.showView('song');
    $('#song-feedback').textContent = '楽譜を読み込んでいます…';
    $('#song-progress').textContent = '';
    try {
      const title = await this.song.load(source.data, source.name);
      $('#song-skip').hidden = s.songMode !== 'wait';
      $('#song-title').textContent = `${title}　${SONG_MODE_LABELS[s.songMode]}・${HAND_LABELS[s.hands]}`;
      this.running = true;
      this.song.start({
        songMode: s.songMode,
        hands: s.hands,
        bpm: s.songBpm,
        toleranceMs: s.toleranceMs,
        metronome: s.metronome,
        judge: { octaveEquivalent: s.octaveEquivalent },
      });
    } catch (e) {
      this.running = false;
      alert(`曲を始められませんでした: ${e instanceof Error ? e.message : String(e)}`);
      this.showView('setup');
    }
  }

  private async songSource(): Promise<{ name: string; data: string }> {
    const id = this.settings.songSource;
    if (id.startsWith('lib:')) {
      const song = this.librarySongs.find((x) => `lib:${x.id}` === id);
      if (!song) throw new Error('ライブラリにその曲がありません');
      return song;
    }
    const sample = this.bundledSongs.find((x) => `sample:${x.file}` === id) ?? this.bundledSongs[0];
    if (!sample) throw new Error('曲がありません');
    const res = await fetch(import.meta.env.BASE_URL + sample.file);
    if (!res.ok) throw new Error(`${sample.file} が見つかりません`);
    return { name: sample.title, data: await res.text() };
  }

  /** 同梱の曲とライブラリを読み込んで、曲の選択肢を作る */
  private async loadSongs(): Promise<void> {
    const bundled = await loadBundledSongs(import.meta.env.BASE_URL);
    this.bundledSongs = bundled.length ? bundled : FALLBACK_SAMPLES;
    try {
      await this.migrateLegacySongFile();
      this.librarySongs = await this.songLibrary.list();
    } catch (e) {
      console.error(e);
    }
    this.settings.songSource = LEGACY_SOURCES[this.settings.songSource] ?? this.settings.songSource;
    this.fillSongSources(this.settings.songSource);
  }

  /** 以前の版で localStorage に入れていた「最後に開いたファイル」をライブラリへ移す */
  private async migrateLegacySongFile(): Promise<void> {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(LEGACY_SONG_FILE_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    const old = JSON.parse(raw) as { name: string; data: string };
    const id = await this.songLibrary.add(old.name, old.data);
    if (this.settings.songSource === 'file') this.settings.songSource = `lib:${id}`;
    localStorage.removeItem(LEGACY_SONG_FILE_KEY);
  }

  private async addSongFiles(input: HTMLInputElement): Promise<void> {
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    let lastId: number | null = null;
    const failed: string[] = [];
    for (const file of files) {
      try {
        const data = await readSongFile(file);
        lastId = await this.songLibrary.add(songTitle(file.name, data), data);
      } catch (e) {
        console.error(e);
        failed.push(file.name);
      }
    }
    this.librarySongs = await this.songLibrary.list();
    this.fillSongSources(lastId === null ? this.settings.songSource : `lib:${lastId}`);
    const added = files.length - failed.length;
    $('#song-library-status').textContent =
      `${added} 曲をライブラリに追加しました` + (failed.length ? `（追加できなかったファイル: ${failed.join('、')}）` : '');
  }

  private async removeSelectedSong(): Promise<void> {
    const id = this.settings.songSource;
    const song = this.librarySongs.find((x) => `lib:${x.id}` === id);
    if (!song || !confirm(`「${song.name}」をライブラリから削除します。よろしいですか？（この曲の練習記録は残ります）`)) return;
    await this.songLibrary.remove(song.id);
    this.librarySongs = await this.songLibrary.list();
    this.fillSongSources('');
    $('#song-library-status').textContent = `「${song.name}」を削除しました`;
  }

  /** 曲の選択肢を作り直し、selected を選ぶ（なければ先頭） */
  private fillSongSources(selected: string): void {
    const group = (label: string, options: string[]) => (options.length ? `<optgroup label="${label}">${options.join('')}</optgroup>` : '');
    const select = $<HTMLSelectElement>('#song-source');
    select.innerHTML =
      group('ライブラリ（追加した曲）', this.librarySongs.map((x) => `<option value="lib:${x.id}">${escapeHtml(x.name)}</option>`)) +
      group('同梱の曲', this.bundledSongs.map((x) => `<option value="sample:${escapeHtml(x.file)}">${escapeHtml(x.title)}</option>`));
    select.value = selected;
    if (!select.value && select.options.length) select.selectedIndex = 0;
    $<HTMLFormElement>('#settings').dispatchEvent(new Event('input'));
  }

  private finishSong(result: SongResult): void {
    this.running = false;
    const s = summarizeSong(result);
    $('#result-title').textContent = `結果: ${result.title}`;
    const tiles = [
      `<div class="stat"><span class="label">正答率</span><span class="value">${Math.round(s.accuracy * 100)}<small>%</small></span><span class="sub">${s.correct} / ${s.played} か所（全 ${result.totalSteps}）</span></div>`,
    ];
    if (result.settings.songMode === 'wait') {
      tiles.push(
        `<div class="stat"><span class="label">平均反応時間</span><span class="value">${s.avgReactionMs === null ? '—' : formatMs(s.avgReactionMs)}</span><span class="sub">カーソル到達から最初の押鍵まで</span></div>`,
      );
    } else {
      const t = s.timing;
      const tendency = tendencyText(t.meanMs);
      tiles.push(
        `<div class="stat"><span class="label">タイミングOK（±${result.settings.toleranceMs} ms）</span><span class="value">${Math.round(t.onTimeRate * 100)}<small>%</small></span><span class="sub">押せた ${t.count} 音のうち</span></div>`,
        `<div class="stat"><span class="label">ずれの平均</span><span class="value">${t.meanAbsMs === null ? '—' : `${Math.round(t.meanAbsMs)} ms`}</span><span class="sub">${tendency}（♩=${Math.round(result.bpm)}）</span></div>`,
      );
    }
    $('#summary').innerHTML = tiles.join('');
    $('#answers-head').innerHTML = '<tr><th>小節</th><th>音</th><th>足りない音</th><th>余計な音</th><th>ずれ / 反応</th></tr>';
    const spell = (o: SongResult['outcomes'][number], midis: number[]) =>
      midis.map((m) => pitchName(spellMidiInKey(m, result.keyFifthsAt(o.step.entryIndex)))).join('・');
    const rows = result.outcomes
      .filter((o) => !o.correct)
      .map((o) => {
        const timing = o.deviations.length
          ? o.deviations.map((d) => `${d > 0 ? '+' : ''}${Math.round(d)}`).join(' / ') + ' ms'
          : o.reactionMs !== null
            ? formatMs(o.reactionMs)
            : '';
        return `<tr class="ng"><td>${o.step.measureNumber}</td><td>${spell(o, o.step.notes.map((n) => n.midi))}</td><td class="missing-cell">${spell(o, o.missing) || '—'}</td><td class="played">${spell(o, o.extras) || '—'}</td><td class="small">${timing}</td></tr>`;
      });
    $('#answers').innerHTML = rows.join('') || '<tr><td colspan="5">間違えた箇所はありません</td></tr>';
    this.showView('result');
  }

  // ---- 表示 ----

  private updateProgress(): void {
    const s = summarize(this.records);
    const left =
      this.settings.limitKind === 'count'
        ? `${Math.min(this.records.length + (this.question?.record ? 0 : 1), this.settings.count)} / ${this.settings.count} 問`
        : `残り ${Math.max(0, Math.ceil((this.deadline - performance.now()) / 1000))} 秒`;
    $('#progress').textContent = `${left}　正解 ${s.correct} / ${s.total}`;
  }

  private renderResult(): void {
    const s = summarize(this.records);
    $('#result-title').textContent = '結果';
    $('#answers-head').innerHTML =
      '<tr><th>#</th><th id="col-key">調号</th><th>段</th><th>出題</th><th>最初に押した音</th><th>反応時間</th><th>押した回数</th></tr>';
    $('#summary').innerHTML = `
      <div class="stat"><span class="label">正答率</span><span class="value">${s.total ? Math.round(s.accuracy * 100) : 0}<small>%</small></span><span class="sub">${s.correct} / ${s.total} 問</span></div>
      <div class="stat"><span class="label">平均反応時間</span><span class="value">${s.avgReactionMs === null ? '—' : formatMs(s.avgReactionMs)}</span><span class="sub">全問の最初の押鍵まで</span></div>
      <div class="stat"><span class="label">正解時の平均</span><span class="value">${s.avgCorrectReactionMs === null ? '—' : formatMs(s.avgCorrectReactionMs)}</span><span class="sub">1回目で正解した問題</span></div>`;
    const showKey = this.settings.keyKind !== 'none';
    $('#col-key').hidden = !showKey;
    const rows = this.answered.map((q, i) => {
      const r = q.record!;
      const key = showKey ? `<td>${keyShort(q.keyFifths)}</td>` : '';
      const shape = q.shape ? `<span class="shape-name">${shapeById(q.shape)?.label ?? ''}</span> ` : '';
      return `<tr class="${r.correct ? 'ok' : 'ng'}"><td>${i + 1}</td>${key}<td>${CLEF_LABELS[q.clef].slice(0, 2)}</td><td>${shape}${names(q.pitches)}</td><td class="played">${r.correct ? '○' : names(q.firstPlayed!)}</td><td>${formatMs(r.reactionMs)}</td><td>${r.attempts}</td></tr>`;
    });
    $('#answers').innerHTML = rows.join('') || '<tr><td colspan="7">回答なし</td></tr>';
  }

  private showView(view: View): void {
    this.view = view;
    for (const v of VIEWS) $(`#${v}`).hidden = v !== view;
  }

  private scrollKeyboardToRange(): void {
    const s = this.settings;
    const clefs = s.layout === 'grand' ? CLEFS : [s.layout];
    const lows = clefs.map((c) => Math.min(s.ranges[c].low, s.ranges[c].high));
    const highs = clefs.map((c) => Math.max(s.ranges[c].low, s.ranges[c].high));
    const mid = Math.round((Math.min(...lows) + Math.max(...highs)) / 2);
    this.keyboard.scrollToNote(pitchToMidi(pitchFromDiatonic(mid)));
  }

  private showMidiStatus(status: MidiStatus): void {
    const el = $('#midi-status');
    el.className = 'midi-status';
    if (status.kind === 'unsupported') {
      el.textContent = 'このブラウザは Web MIDI 非対応（Chrome を使ってください）';
      el.classList.add('warn');
    } else if (status.kind === 'denied') {
      el.textContent = `MIDI を使えません: ${status.message}`;
      el.classList.add('warn');
    } else if (status.devices.length === 0) {
      el.textContent = 'MIDI デバイス未接続（仮想鍵盤・PCキーボードで入力できます）';
    } else {
      el.textContent = `MIDI: ${status.devices.join(', ')}`;
      el.classList.add('connected');
    }
  }

  private showOctave(base: number): void {
    $('#octave').textContent = `PCキーボード: A = C${base / 12 - 1}（Z / X でオクターブ移動）`;
  }

  // ---- 設定 ----

  private bindSettingsForm(): void {
    const form = $<HTMLFormElement>('#settings');
    const radio = (name: string) => form.elements.namedItem(name) as RadioNodeList;
    const s = this.settings;

    for (const clef of CLEFS) {
      for (const end of ['low', 'high'] as const) {
        const select = $<HTMLSelectElement>(`#range-${clef}-${end}`);
        select.innerHTML = rangeOptions(clef);
        select.value = String(s.ranges[clef][end]);
      }
    }
    $<HTMLSelectElement>('#key-fifths').innerHTML = Array.from(
      { length: KEY_FIFTHS_RANGE.max - KEY_FIFTHS_RANGE.min + 1 },
      (_, i) => KEY_FIFTHS_RANGE.min + i,
    )
      .map((f) => `<option value="${f}">${keyLabel(f)}</option>`)
      .join('');

    $('#shape-list').innerHTML = SHAPES.map(
      (sh) => `<label class="check"><input type="checkbox" name="shape" value="${sh.id}" /> ${sh.label}</label>`,
    ).join('');
    form.querySelectorAll<HTMLInputElement>('input[name=shape]').forEach((el) => (el.checked = s.shapes.includes(el.value)));
    $<HTMLInputElement>('#chord-window').value = String(s.chordWindowMs);
    radio('songMode').value = s.songMode;
    radio('hands').value = s.hands;
    $<HTMLInputElement>('#song-bpm').value = s.songBpm === null ? '' : String(s.songBpm);
    $<HTMLInputElement>('#tolerance').value = String(s.toleranceMs);
    $<HTMLInputElement>('#metronome').checked = s.metronome;
    $<HTMLInputElement>('#flow-measures').value = String(s.flowMeasures);
    $<HTMLInputElement>('#flow-bpm').value = String(s.flowBpm);
    $<HTMLSelectElement>('#flow-rhythm').value = s.flowRhythm;
    $<HTMLSelectElement>('#flow-leap').value = String(s.flowMaxLeap);
    radio('mode').value = s.mode;
    radio('limitKind').value = s.limitKind;
    radio('layout').value = s.layout;
    radio('keyKind').value = s.keyKind;
    $<HTMLInputElement>('#count').value = String(s.count);
    $<HTMLInputElement>('#seconds').value = String(s.seconds);
    $<HTMLSelectElement>('#key-fifths').value = String(s.keyFifths);
    $<HTMLSelectElement>('#key-max').value = String(s.keyMaxAccidentals);
    $<HTMLInputElement>('#accidentals').checked = s.accidentals;
    $<HTMLInputElement>('#octave-eq').checked = s.octaveEquivalent;
    $<HTMLInputElement>('#focus-weak').checked = s.focusWeak;

    const sync = () => {
      const range = (clef: Clef): DiatonicRange => {
        const a = Number($<HTMLSelectElement>(`#range-${clef}-low`).value);
        const b = Number($<HTMLSelectElement>(`#range-${clef}-high`).value);
        return { low: Math.min(a, b), high: Math.max(a, b) };
      };
      const layout = radio('layout').value as StaffLayout;
      const keyKind = radio('keyKind').value as Settings['keyKind'];
      const checkedShapes = [...form.querySelectorAll<HTMLInputElement>('input[name=shape]:checked')].map((el) => el.value);
      const modeValue = radio('mode').value;
      const mode: Mode = modeValue === 'shape' || modeValue === 'song' || modeValue === 'flow' ? modeValue : 'reflex';
      const bpmRaw = $<HTMLInputElement>('#song-bpm').value.trim();
      this.settings = {
        mode,
        songMode: radio('songMode').value === 'tempo' ? 'tempo' : 'wait',
        hands: (['right', 'left'] as const).find((h) => h === radio('hands').value) ?? 'both',
        songBpm: bpmRaw ? clampInt(bpmRaw, 20, 240, 80) : null,
        toleranceMs: clampInt($<HTMLInputElement>('#tolerance').value, 20, 300, DEFAULT_SETTINGS.toleranceMs),
        metronome: $<HTMLInputElement>('#metronome').checked,
        // 曲の一覧を読み込む前は選択肢が空なので、保存してある値をそのまま使う
        songSource: $<HTMLSelectElement>('#song-source').value || this.settings.songSource,
        flowMeasures: clampInt($<HTMLInputElement>('#flow-measures').value, 2, 64, DEFAULT_SETTINGS.flowMeasures),
        flowBpm: clampInt($<HTMLInputElement>('#flow-bpm').value, 20, 200, DEFAULT_SETTINGS.flowBpm),
        flowRhythm: $<HTMLSelectElement>('#flow-rhythm').value === 'mixed' ? 'mixed' : 'quarter',
        flowMaxLeap: clampInt($<HTMLSelectElement>('#flow-leap').value, 1, 7, DEFAULT_SETTINGS.flowMaxLeap),
        shapes: checkedShapes.length ? checkedShapes : DEFAULT_SHAPE_IDS,
        chordWindowMs: clampInt(
          $<HTMLInputElement>('#chord-window').value,
          CHORD_WINDOW_RANGE.min,
          CHORD_WINDOW_RANGE.max,
          DEFAULT_CHORD_WINDOW_MS,
        ),
        limitKind: radio('limitKind').value === 'time' ? 'time' : 'count',
        count: clampInt($<HTMLInputElement>('#count').value, 1, 500, DEFAULT_SETTINGS.count),
        seconds: clampInt($<HTMLInputElement>('#seconds').value, 10, 3600, DEFAULT_SETTINGS.seconds),
        layout,
        ranges: { treble: range('treble'), bass: range('bass') },
        keyKind,
        keyFifths: clampInt($<HTMLSelectElement>('#key-fifths').value, -7, 7, 0),
        keyMaxAccidentals: clampInt($<HTMLSelectElement>('#key-max').value, 1, 7, DEFAULT_SETTINGS.keyMaxAccidentals),
        accidentals: $<HTMLInputElement>('#accidentals').checked,
        octaveEquivalent: $<HTMLInputElement>('#octave-eq').checked,
        focusWeak: $<HTMLInputElement>('#focus-weak').checked,
      };
      const dim = (sel: string, off: boolean) => $(sel).classList.toggle('dim', off);
      dim('#count-label', this.settings.limitKind !== 'count');
      dim('#seconds-label', this.settings.limitKind !== 'time');
      dim('#range-treble', layout === 'bass');
      dim('#range-bass', layout === 'treble');
      dim('#key-fifths-label', keyKind !== 'fixed');
      dim('#key-max-label', keyKind !== 'random');
      $('#mode-label').textContent =
        mode === 'song'
          ? `${MODE_LABELS[mode]}・${SONG_MODE_LABELS[this.settings.songMode]}`
          : mode === 'flow'
            ? `${MODE_LABELS[mode]}・${LAYOUT_LABELS[layout]}・♩=${this.settings.flowBpm}`
            : `${MODE_LABELS[mode]}・${LAYOUT_LABELS[layout]}`;
      $('#shape-settings').hidden = mode !== 'shape';
      $('#song-settings').hidden = mode !== 'song';
      $('#flow-settings').hidden = mode !== 'flow';
      $('#timing-settings').hidden = !(mode === 'flow' || (mode === 'song' && this.settings.songMode === 'tempo'));
      // 反射・形で読むモードだけの設定と、曲モード以外（出題を作るモード）の設定
      form.querySelectorAll<HTMLElement>('.drill-only').forEach((el) => (el.hidden = mode === 'song' || mode === 'flow'));
      form.querySelectorAll<HTMLElement>('.generated-only').forEach((el) => (el.hidden = mode === 'song'));
      dim('#tempo-options', this.settings.songMode !== 'tempo');
      $<HTMLButtonElement>('#song-remove').disabled = !this.settings.songSource.startsWith('lib:');
      dim('#focus-weak-label', mode !== 'reflex');
      this.grouper.setWindow(this.settings.chordWindowMs);
      saveSettings(this.settings);
    };
    form.addEventListener('input', () => {
      sync();
      this.scrollKeyboardToRange();
    });
    form.addEventListener('submit', (e) => e.preventDefault());
    sync();
  }
}

/** ずれの平均（符号付き）から、走り気味・遅れ気味を言葉にする */
function tendencyText(meanMs: number | null): string {
  if (meanMs === null) return '';
  if (Math.abs(meanMs) < 15) return 'ほぼ中心';
  return meanMs > 0 ? `平均 ${Math.round(meanMs)} ms 遅れ気味` : `平均 ${Math.round(-meanMs)} ms 走り気味`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function names(pitches: readonly Pitch[]): string {
  return pitches.map(pitchName).join('・');
}

function keySetting(s: Settings): KeySetting {
  if (s.keyKind === 'fixed') return { kind: 'fixed', fifths: s.keyFifths };
  if (s.keyKind === 'random') return { kind: 'random', maxAccidentals: s.keyMaxAccidentals };
  return { kind: 'none' };
}

/** 音域のセレクトの選択肢（高い音が上） */
function rangeOptions(clef: Clef): string {
  const { low, high } = staffRange(clef, MAX_LEDGER_LINES);
  const options: string[] = [];
  for (let d = high; d >= low; d--) {
    const n = ledgerLinesAt(clef, d);
    options.push(`<option value="${d}">${pitchName(pitchFromDiatonic(d))}${n ? `（加線${n}本）` : ''}</option>`);
  }
  return options.join('');
}

function keyShort(fifths: number): string {
  return fifths === 0 ? '—' : fifths > 0 ? `♯${fifths}` : `♭${-fifths}`;
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      return { ...DEFAULT_SETTINGS, ...saved, ranges: { ...DEFAULT_SETTINGS.ranges, ...saved.ranges } };
    }
  } catch {
    /* 保存領域が使えなくても既定値で動く */
  }
  return structuredClone(DEFAULT_SETTINGS);
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* 無視 */
  }
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} 秒` : `${Math.round(ms)} ms`;
}

function isFormControl(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(t.tagName);
}

function readColors(): StaffColors {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return { ink: v('--ink'), correct: v('--correct'), wrong: v('--wrong'), missing: v('--missing') };
}
