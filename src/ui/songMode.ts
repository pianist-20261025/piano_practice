import { Metronome } from '../audio/metronome';
import type { JudgeOptions } from '../judge/judge';
import { TimedMatcher, summarizeTiming, type TimedTarget } from '../judge/timing';
import { WaitStepJudge } from '../judge/waitJudge';
import type { NoteEvent } from '../midi/types';
import type { Clef } from '../music/clef';
import { spellMidiInKey } from '../music/key';
import { pitchName, pitchToMidi, type Pitch } from '../music/pitch';
import { StaffRenderer, type NoteState, type StaffColors } from '../render/staffRenderer';
import { OsmdScore, type LoadedScore } from '../score/osmdScore';
import { buildSteps, type HandSetting, type Step } from '../score/steps';
import type { AnswerRecord } from '../stats/session';

export type SongMode = 'wait' | 'tempo';

export interface SongSettings {
  songMode: SongMode;
  hands: HandSetting;
  /** 4分音符 / 分。null なら楽譜どおり（書かれていなければ DEFAULT_BPM） */
  bpm: number | null;
  /** タイミングが合っているとみなす幅（±ms） */
  toleranceMs: number;
  metronome: boolean;
  judge: JudgeOptions;
}

export const DEFAULT_BPM = 80;

/** 1ステップの結果（間違えたステップの一覧と記録に使う） */
export interface StepOutcome {
  step: Step;
  correct: boolean;
  missing: number[];
  extras: number[];
  /** 待機: カーソル到達から最初の押鍵まで。テンポ: null */
  reactionMs: number | null;
  /** テンポ: 押せた音のずれ（ms） */
  deviations: number[];
}

export interface SongResult {
  title: string;
  settings: SongSettings;
  bpm: number;
  totalSteps: number;
  outcomes: StepOutcome[];
  keyFifthsAt: (entryIndex: number) => number;
}

interface Callbacks {
  persist(record: AnswerRecord): void;
  finished(result: SongResult): void;
  colors(): StaffColors;
  /** 進行状況の表示 */
  status(text: string): void;
  feedback(html: string, kind: 'ok' | 'ng' | ''): void;
}

/** 曲モード（待機・テンポ）の進行。楽譜の表示は OsmdScore、判定は judge/ の純粋なクラスに任せる */
export class SongPractice {
  private readonly score: OsmdScore;
  private readonly mini: StaffRenderer;
  private readonly metronome = new Metronome();
  private loaded: LoadedScore | null = null;
  private title = '';
  private settings: SongSettings | null = null;
  private steps: Step[] = [];
  private outcomes: StepOutcome[] = [];
  private running = false;

  // 待機モード
  private current = 0;
  private waitJudge: WaitStepJudge | null = null;
  private shownAt = 0;
  private firstPressAt: number | null = null;

  // テンポモード
  private matcher: TimedMatcher | null = null;
  private stepTimes: number[] = [];
  /** targets の番号 → (ステップ, そのステップの何番目の音) */
  private targetOf: { step: number; note: number }[] = [];
  private stepExtras: number[][] = [];
  private finalized = 0;
  private cursorAt = -1;
  private beatMs = 0;
  private nextClick = 0;
  private endAt = 0;
  private raf = 0;
  private bpm = DEFAULT_BPM;

  constructor(
    scoreEl: HTMLElement,
    miniEl: HTMLElement,
    private readonly cb: Callbacks,
  ) {
    this.score = new OsmdScore(scoreEl);
    this.mini = new StaffRenderer(miniEl, cb.colors);
  }

  /** 楽譜を読み込んで表示する。曲名を返す */
  async load(xml: string, fallbackTitle: string): Promise<string> {
    this.loaded = await this.score.load(xml);
    this.title = this.loaded.title || fallbackTitle;
    return this.title;
  }

  get scoreBpm(): number | null {
    return this.loaded?.bpm ?? null;
  }

  start(settings: SongSettings): void {
    if (!this.loaded) throw new Error('楽譜が読み込まれていません');
    this.settings = settings;
    this.steps = buildSteps(this.loaded.entries, settings.hands);
    if (!this.steps.length) throw new Error('判定する音がありません（片手モードの手の選び方を確かめてください）');
    this.outcomes = [];
    this.running = true;
    this.bpm = settings.bpm ?? this.loaded.bpm ?? DEFAULT_BPM;
    if (settings.songMode === 'wait') this.startWait();
    else this.startTempo();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.metronome.stop();
    if (this.settings?.songMode === 'tempo') this.finalizeTempo(Infinity);
    this.score.hideCursor();
    this.cb.finished({
      title: this.title,
      settings: this.settings!,
      bpm: this.bpm,
      totalSteps: this.steps.length,
      outcomes: this.outcomes,
      keyFifthsAt: this.loaded!.keyFifthsAt,
    });
  }

  noteOn(ev: NoteEvent): void {
    if (!this.running) return;
    if (this.settings!.songMode === 'wait') this.pressWait(ev);
    else this.pressTempo(ev);
  }

  // ---- 待機モード ----

  private startWait(): void {
    this.showWaitStep(0);
  }

  private showWaitStep(i: number): void {
    this.current = i;
    const step = this.steps[i];
    this.score.moveCursor(step.entryIndex);
    this.waitJudge = new WaitStepJudge(
      step.notes.map((n) => n.midi),
      this.settings!.judge,
    );
    this.shownAt = performance.now();
    this.firstPressAt = null;
    this.renderMini(step, () => 'pending', []);
    this.cb.status(this.progressText(i));
    this.cb.feedback('', '');
  }

  private pressWait(ev: NoteEvent): void {
    const judge = this.waitJudge!;
    const step = this.steps[this.current];
    this.firstPressAt ??= ev.time;
    const r = judge.press(ev.note);
    if (r === 'hit') {
      const hit = new Set(judge.hits);
      step.notes.forEach((n) => hit.has(n.midi) && this.score.colorNote(step.entryIndex, n.rawIndex, this.cb.colors().correct));
    }
    if (r === 'extra') {
      this.cb.feedback(`余計な音: ${this.names(judge.extras, step)}`, 'ng');
    }
    const hits = new Set(judge.hits);
    this.renderMini(step, (m) => (hits.has(m) ? 'correct' : 'pending'), judge.extras);
    if (!judge.done) return;

    this.record({
      step,
      correct: judge.extras.length === 0,
      missing: [],
      extras: judge.extras,
      reactionMs: this.firstPressAt - this.shownAt,
      deviations: [],
    });
    if (this.current + 1 < this.steps.length) this.showWaitStep(this.current + 1);
    else this.stop();
  }

  // ---- テンポモード ----

  private startTempo(): void {
    const { numerator, denominator } = this.loaded!.timeSignature;
    this.beatMs = 60000 / this.bpm;
    // カウントは1小節（4分音符で数える）
    const countIn = Math.max(1, Math.round((numerator * 4) / denominator));
    const origin = performance.now() + 400 + countIn * this.beatMs;
    const zero = this.steps[0].time - (this.steps[0].time % ((numerator * 4) / denominator));
    this.stepTimes = this.steps.map((s) => origin + (s.time - zero) * this.beatMs);
    const targets: TimedTarget[] = [];
    this.targetOf = [];
    this.steps.forEach((s, k) =>
      s.notes.forEach((n, j) => {
        targets.push({ step: k, midi: n.midi, time: this.stepTimes[k] });
        this.targetOf.push({ step: k, note: j });
      }),
    );
    // 同じ鍵盤の連打（8分音符など）を取り違えない範囲で、なるべく広く受け付ける
    const windowMs = Math.min(350, Math.max(150, this.beatMs * 0.45));
    this.matcher = new TimedMatcher(targets, windowMs, this.settings!.judge);
    this.stepExtras = this.steps.map(() => []);
    this.finalized = 0;
    this.cursorAt = -1;
    this.nextClick = origin - countIn * this.beatMs;
    this.endAt = this.stepTimes[this.stepTimes.length - 1] + windowMs + 300;
    this.score.moveCursor(this.steps[0].entryIndex);
    this.renderMini(this.steps[0], () => 'pending', []);
    this.cb.feedback(`カウント ${countIn} 拍のあと始まります（♩=${Math.round(this.bpm)}）`, '');
    this.cb.status(this.progressText(0));
    this.loop(origin);
  }

  private loop(origin: number): void {
    const now = performance.now();
    // メトロノーム（カウント中は必ず、演奏中は設定どおり）。少し先まで予約する
    while (this.nextClick < now + 150 && this.nextClick < this.endAt) {
      if (this.nextClick < origin || this.settings!.metronome) {
        const beatIndex = Math.round((this.nextClick - origin) / this.beatMs);
        this.metronome.click(this.nextClick, beatIndex % this.loaded!.timeSignature.numerator === 0);
      }
      this.nextClick += this.beatMs;
    }
    // カーソルはそのステップの時刻に合わせて進める
    let k = this.cursorAt;
    while (k + 1 < this.steps.length && this.stepTimes[k + 1] <= now + 30) k++;
    if (k !== this.cursorAt && k >= 0) {
      this.cursorAt = k;
      this.score.moveCursor(this.steps[k].entryIndex);
      this.cb.status(this.progressText(k));
    }
    for (const t of this.matcher!.expire(now)) {
      const { step, note } = this.targetOf[t];
      this.score.colorNote(this.steps[step].entryIndex, this.steps[step].notes[note].rawIndex, this.cb.colors().missing);
    }
    this.finalizeTempo(now);
    if (now > this.endAt) {
      this.stop();
      return;
    }
    if (this.running) this.raf = requestAnimationFrame(() => this.loop(origin));
  }

  private pressTempo(ev: NoteEvent): void {
    const r = this.matcher!.press(ev.note, ev.time);
    if (r.kind === 'hit') {
      const { step, note } = this.targetOf[r.target];
      const s = this.steps[step];
      this.score.colorNote(s.entryIndex, s.notes[note].rawIndex, this.cb.colors().correct);
      const d = Math.round(r.deviationMs);
      const ok = Math.abs(d) <= this.settings!.toleranceMs;
      this.cb.feedback(`${ok ? 'OK' : d < 0 ? '早い' : '遅い'} ${d > 0 ? '+' : ''}${d} ms`, ok ? 'ok' : 'ng');
    } else if (r.step !== null) {
      this.stepExtras[r.step].push(ev.note);
      const s = this.steps[r.step];
      this.renderMini(s, () => 'pending', this.stepExtras[r.step]);
      this.cb.feedback(`余計な音: ${this.names([ev.note], s)}`, 'ng');
    }
  }

  /** 判定の窓を過ぎたステップから順に結果を確定して記録する */
  private finalizeTempo(now: number): void {
    const m = this.matcher;
    if (!m) return;
    while (this.finalized < this.steps.length && this.stepTimes[this.finalized] + m.windowMs < now) {
      const k = this.finalized++;
      const step = this.steps[k];
      const results = this.targetOf.map((t, i) => ({ ...t, r: m.result(i) })).filter((t) => t.step === k);
      const missing = results.filter((t) => !t.r.hit).map((t) => step.notes[t.note].midi);
      const deviations = results.filter((t) => t.r.hit).map((t) => t.r.deviationMs!);
      const extras = this.stepExtras[k];
      if (missing.length || extras.length) {
        this.renderMini(step, (mm) => (missing.includes(mm) ? 'missing' : 'correct'), extras);
      }
      this.record({ step, correct: !missing.length && !extras.length, missing, extras, reactionMs: null, deviations });
    }
  }

  // ---- 共通 ----

  private record(o: StepOutcome): void {
    this.outcomes.push(o);
    const s = this.settings!;
    const expected = o.step.notes.map((n) => n.midi);
    const timing = o.deviations.length ? o.deviations.reduce((a, b) => a + b, 0) / o.deviations.length : undefined;
    this.cb.persist({
      timestamp: Date.now(),
      mode: 'song',
      song: this.title,
      measure: o.step.measureNumber,
      songMode: s.songMode,
      hands: s.hands,
      clef: o.step.notes.every((n) => n.hand === 'left') ? 'bass' : 'treble',
      keyFifths: this.loaded!.keyFifthsAt(o.step.entryIndex),
      expected,
      played: [...expected.filter((m) => !o.missing.includes(m)), ...o.extras],
      correct: o.correct,
      reactionMs: o.reactionMs ?? timing ?? 0,
      attempts: 1 + o.extras.length,
      ...(timing === undefined ? {} : { timingMs: timing }),
    });
  }

  /** 現在のステップを小さな大譜表に描く（押した音の読み返し用）。中央ド以上は上段 */
  private renderMini(step: Step, state: (midi: number) => NoteState, extras: readonly number[]): void {
    const key = this.loaded!.keyFifthsAt(step.entryIndex);
    const spell = (m: number) => spellMidiInKey(m, key);
    const clefOf = (p: Pitch): Clef => (pitchToMidi(p) >= 60 ? 'treble' : 'bass');
    this.mini.render({
      layout: 'grand',
      clef: 'treble',
      keyFifths: key,
      expected: step.notes.map((n) => ({ pitch: spell(n.midi), state: state(n.midi) })),
      extra: [...new Set(extras)].map(spell),
      noteClef: clefOf,
    });
  }

  private names(midis: readonly number[], step: Step): string {
    const key = this.loaded!.keyFifthsAt(step.entryIndex);
    return [...new Set(midis)].map((m) => pitchName(spellMidiInKey(m, key))).join('・');
  }

  private progressText(i: number): string {
    const step = this.steps[i];
    const last = this.steps[this.steps.length - 1].measureNumber;
    const done = this.outcomes.length;
    const ok = this.outcomes.filter((o) => o.correct).length;
    return `小節 ${step.measureNumber} / ${last}　正解 ${ok} / ${done}`;
  }
}

/** 結果画面用の集計 */
export function summarizeSong(result: SongResult) {
  const n = result.outcomes.length;
  const correct = result.outcomes.filter((o) => o.correct).length;
  const reactions = result.outcomes.map((o) => o.reactionMs).filter((r): r is number => r !== null);
  return {
    played: n,
    correct,
    accuracy: n ? correct / n : 0,
    avgReactionMs: reactions.length ? reactions.reduce((a, b) => a + b, 0) / reactions.length : null,
    timing: summarizeTiming(
      result.outcomes.flatMap((o) => o.deviations),
      result.settings.toleranceMs,
    ),
  };
}
