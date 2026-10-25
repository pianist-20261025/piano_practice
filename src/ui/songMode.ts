import { BeatClock } from '../audio/beatClock';
import { Metronome } from '../audio/metronome';
import type { JudgeOptions } from '../judge/judge';
import { TimedMatcher, summarizeTiming, type TimedTarget } from '../judge/timing';
import { heldByOtherHand, heldFromBefore, type KeyOwner } from '../judge/heldKeys';
import { WaitStepJudge } from '../judge/waitJudge';
import type { NoteEvent } from '../midi/types';
import type { Clef } from '../music/clef';
import { spellMidiInKey } from '../music/key';
import { pitchName, pitchToMidi, type Pitch } from '../music/pitch';
import { StaffRenderer, type NoteState, type StaffColors } from '../render/staffRenderer';
import { excerptEntries, excerptLabel, type ExcerptRange } from '../score/excerpt';
import { OsmdScore, type LoadedScore } from '../score/osmdScore';
import { buildSteps, type HandSetting, type Step, type StepNote } from '../score/steps';
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
type OptionalKind = 'sustained' | 'blocked' | 'held';
/** 先に押してしまった音を、何か所先まで持ち越すか */
const LOOKAHEAD_STEPS = 4;
/**
 * 前から押さえたままの鍵盤（blocked / held）だけが残ったとき、弾けたとみなすまで待つ時間。
 * 持ち替えて弾き直す人はこの間に鍵盤を離すので区別できる。カーソルが進むのを待っている人も止まらない
 */
const SETTLE_MS = 250;
/** 同じ位置で何も起きないまま、足りない音を示すまでの時間 */
const HINT_MS = 2500;

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
  /** 抜粋して弾いたときの範囲（曲全体なら null） */
  range: ExcerptRange | null;
  /** 抜粋の範囲の表示（「小節 5〜7」など）。曲全体なら '' */
  rangeLabel: string;
  keyFifthsAt: (entryIndex: number) => number;
}

interface Callbacks {
  persist(record: AnswerRecord): void;
  finished(result: SongResult): void;
  colors(): StaffColors;
  /** いま鳴っている音（押さえている鍵盤＋ペダルで伸びている音） */
  sounding(): number[];
  /** いま押さえている鍵盤（ペダルは含まない） */
  heldNotes(): number[];
  /** その鍵盤を押さえ始めた時刻（押さえていなければ undefined） */
  heldSince(midi: number): number | undefined;
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
  /** outcomes と同じ順の記録。待機モードでは「戻る」で取り消せるよう、終わるまで（または画面を離れるまで）保存しない */
  private records: AnswerRecord[] = [];
  /** records のうち保存済みの数 */
  private saved = 0;
  private running = false;
  /** 抜粋して弾いている範囲（曲全体なら null） */
  private range: ExcerptRange | null = null;
  /** 楽譜をいま抜粋で描いているか */
  private drawnExcerpt = false;
  /** テンポモードで、カウントの基準にする時刻（抜粋の最初の小節の頭）。曲全体なら null */
  private zeroTime: number | null = null;

  // 待機モード
  private current = 0;
  private waitJudge: WaitStepJudge | null = null;
  private shownAt = 0;
  private firstPressAt: number | null = null;
  /** いまの位置で、押し直さなくてよいと分かった音 */
  private optionalHere = new Map<number, OptionalKind>();
  /** blocked / held の音だけが残ったときに、少し待って確かめるためのタイマー */
  private settleTimer: number | undefined;
  /** いまの位置の音を1つでも弾いたか（held の音を認める条件） */
  private pressedHere = false;
  /** 足りない音を示すためのタイマー */
  private hintTimer: number | undefined;

  // テンポモード
  private matcher: TimedMatcher | null = null;
  private stepTimes: number[] = [];
  /** targets の番号 → (ステップ, そのステップの何番目の音) */
  private targetOf: { step: number; note: number }[] = [];
  private stepExtras: number[][] = [];
  /** creditHeld で見始める目標の番号 */
  private creditFrom = 0;
  /** 押さえている鍵盤が、楽譜のどちらの手の音として押されたか */
  private owners = new Map<number, KeyOwner>();
  /** テンポモードで、押し直さなくてよいと分かった目標（窓の終わりに当たりにする） */
  private optionalTargets = new Map<number, OptionalKind>();
  private finalized = 0;
  private cursorAt = -1;
  private beatMs = 0;
  private clock: BeatClock | null = null;
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
    this.drawnExcerpt = false;
    this.title = this.loaded.title || fallbackTitle;
    return this.title;
  }

  get scoreBpm(): number | null {
    return this.loaded?.bpm ?? null;
  }

  /** 曲全体の判定するステップ（抜粋する範囲を選ぶのに使う） */
  allSteps(hands: HandSetting): Step[] {
    return this.loaded ? buildSteps(this.loaded.entries, hands) : [];
  }

  /** 範囲の表示（「小節 5〜7」など） */
  rangeLabel(range: ExcerptRange, hands: HandSetting): string {
    return this.loaded ? excerptLabel(this.allSteps(hands), this.loaded.entries, range) : '';
  }

  /** 曲全体、または range の小節だけ（抜粋）を弾き始める。抜粋では、その小節だけを描き直す */
  start(settings: SongSettings, range: ExcerptRange | null = null): void {
    if (!this.loaded) throw new Error('楽譜が読み込まれていません');
    this.settings = settings;
    this.range = range;
    const entries = range ? excerptEntries(this.loaded.entries, range) : this.loaded.entries;
    this.steps = buildSteps(entries, settings.hands);
    if (!this.steps.length) throw new Error('判定する音がありません（片手モードの手の選び方を確かめてください）');
    this.zeroTime = range ? entries[0].time : null;
    if (range || this.drawnExcerpt) {
      // 描き直すと前の色も消える（同じ抜粋をもう一度弾くときも）
      this.score.showMeasures(range);
      this.drawnExcerpt = range !== null;
    }
    this.outcomes = [];
    this.records = [];
    this.saved = 0;
    this.owners.clear();
    this.optionalTargets.clear();
    this.running = true;
    this.bpm = settings.bpm ?? this.loaded.bpm ?? DEFAULT_BPM;
    if (settings.songMode === 'wait') this.startWait();
    else this.startTempo();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    window.clearTimeout(this.settleTimer);
    window.clearTimeout(this.hintTimer);
    cancelAnimationFrame(this.raf);
    this.metronome.stop();
    if (this.settings?.songMode === 'tempo') this.finalizeTempo(Infinity);
    // 最後まで弾き終えたら、残っているタイの後ろ側にも色を付ける
    if (this.outcomes.length === this.steps.length) this.score.revealTiesUpTo(Infinity);
    this.score.hideCursor();
    this.flush();
    this.cb.finished({
      title: this.title,
      settings: this.settings!,
      bpm: this.bpm,
      totalSteps: this.steps.length,
      outcomes: this.outcomes,
      range: this.range,
      rangeLabel: this.range ? this.rangeLabel(this.range, this.settings!.hands) : '',
      keyFifthsAt: this.loaded!.keyFifthsAt,
    });
  }

  noteOn(ev: NoteEvent): void {
    if (!this.running) return;
    if (this.settings!.songMode === 'wait') this.pressWait(ev);
    else this.pressTempo(ev);
  }

  /** まだ保存していない記録を保存する（終了時のほか、画面を離れるときにも呼ぶ） */
  flush(): void {
    for (; this.saved < this.records.length; this.saved++) this.cb.persist(this.records[this.saved]);
  }

  /**
   * 待機モードで、1つ前の位置に戻って弾き直す。戻った位置からいまの位置までの色と結果は取り消す
   * （保存前の記録も取り消すので、統計には弾き直した結果だけが残る）
   */
  back(): void {
    if (!this.running || this.settings!.songMode !== 'wait') return;
    window.clearTimeout(this.settleTimer);
    window.clearTimeout(this.hintTimer);
    const target = Math.max(0, this.current - 1);
    for (let i = target; i <= this.current; i++) for (const n of this.steps[i].notes) this.paint(n, null);
    this.outcomes.length = target;
    this.records.length = target;
    this.saved = Math.min(this.saved, target);
    this.showWaitStep(target, []);
  }

  /** 待機モードで、いまの位置を飛ばして次へ進む（弾けなかった位置として記録する） */
  skip(): void {
    if (!this.running || this.settings!.songMode !== 'wait') return;
    const step = this.steps[this.current];
    const judge = this.waitJudge!;
    window.clearTimeout(this.settleTimer);
    window.clearTimeout(this.hintTimer);
    const missing = step.notes.filter((n) => judge.missing.includes(n.midi));
    for (const n of missing) this.paint(n, this.cb.colors().missing);
    this.record({
      step,
      correct: false,
      missing: missing.map((n) => n.midi),
      extras: judge.extras,
      reactionMs: this.firstPressAt === null ? null : Math.max(0, this.firstPressAt - this.shownAt),
      deviations: [],
    });
    if (this.current + 1 < this.steps.length) this.showWaitStep(this.current + 1, []);
    else this.stop();
  }

  // ---- 待機モード ----

  private startWait(): void {
    this.showWaitStep(0, []);
  }

  /**
   * 押し直さなくてよい音の種類（押鍵がなくても弾けたとみなせる音）:
   * - sustained: 楽譜上、同じ高さの音がまだ鳴っている位置で、その音が鳴り続けている（押さえたまま／ペダル）
   * - blocked: 反対の手が前から押さえている鍵盤（同じ鍵盤は2回押せないので、こちらの手は打鍵できない）
   * - held: 同じ手（またはどちらの手か分からない）で前から押さえたままの鍵盤。
   *   直前の音と和音で同じ鍵盤を続けて使うとき、押さえたまま弾き直さないことがある。
   *   ただし、この位置でほかの音を弾いたときに限って認める（同じ音の連打だけの位置は弾き直しが必要）
   */
  private optional(n: StepNote, since: number): OptionalKind | null {
    if (n.sustained && this.cb.sounding().includes(n.midi)) return 'sustained';
    const at = this.cb.heldSince(n.midi);
    if (heldByOtherHand(n.hand, this.owners.get(n.midi), at, since)) return 'blocked';
    return heldFromBefore(at, since) ? 'held' : null;
  }

  /**
   * 押し直さなくてよい音を覚えておく。一度そうだと分かった音は、この位置にいる間はそのまま
   * （次の音を弾く前に、書かれた長さどおり鍵盤を離すことがあるため）
   */
  private noteOptional(step: Step): void {
    for (const n of step.notes) {
      if (this.optionalHere.get(n.midi) === 'sustained') continue;
      const kind = this.optional(n, this.shownAt);
      if (kind) this.optionalHere.set(n.midi, kind);
    }
  }

  /**
   * 足りない音がすべて「押し直さなくてよい音」なら、それらを弾けたことにする。
   * blocked / held の音は、押さえたままなのか、弾き直すつもりなのかが押鍵の時点では分からないので、
   * 先の位置の音を弾き始めた（movedOn）とき、またはほかの音がそろってから少し待っても
   * 押さえたままだった（settled）ときに限って認める。それまでに弾き直せばふつうに当たりになる。
   * held の音は、この位置でほかの音を弾いていなければ認めない。
   * blocked / held の音だけが残っているときは true を返す（少し待ってから settled で呼び直す）。
   */
  private creditOptional(step: Step, movedOn: boolean, settled = false): boolean {
    const judge = this.waitJudge!;
    this.noteOptional(step);
    const missing = step.notes.filter((n) => judge.missing.includes(n.midi));
    if (!missing.length) return false;
    const kinds = missing.map((n) => this.optionalHere.get(n.midi));
    if (kinds.some((k) => !k)) return false;
    if (kinds.includes('held') && !this.pressedHere) return false;
    if (kinds.some((k) => k !== 'sustained') && !movedOn) {
      // 待ったあとも、まだ押さえたままか（離して弾き直そうとしていないか）
      const stillHeld = missing.every((n, i) => kinds[i] === 'sustained' || this.optional(n, this.shownAt) !== null);
      if (!settled || !stillHeld) return stillHeld;
    }
    for (const n of missing) {
      judge.credit(n.midi);
      this.paint(n, this.cb.colors().correct);
    }
    return false;
  }

  /** blocked / held の音だけが残ったとき、少し待ってから（弾き直さなければ）弾けたことにして進める */
  private scheduleSettle(step: Step): void {
    window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => {
      if (!this.running || this.steps[this.current] !== step || this.waitJudge!.done) return;
      this.creditOptional(step, false, true);
      if (this.waitJudge!.done) this.finishWaitStep(step);
    }, SETTLE_MS);
  }

  /**
   * i 番目のステップを出す。early は、すでに先の位置の音として押してしまった（まだ押さえている）音。
   * その音はこの位置で弾けたことにし、ほかの音が押し直し不要の音だけなら、そのまま次へ進む（先へ弾き進めているため）。
   */
  private showWaitStep(i: number, early: readonly number[]): void {
    for (;;) {
      this.current = i;
      const step = this.steps[i];
      this.score.moveCursor(step.entryIndex);
      // 待機モードは弾いたらすぐ次の位置へ進むので、タイの後ろ側はカーソルがその位置を過ぎてから色を付ける
      // （後ろ側と同じ拍に別の音があると、始まりの音を弾いた瞬間に後ろ側まで緑になってしまうため）
      this.score.revealTiesUpTo(step.time, true);
      this.waitJudge = new WaitStepJudge(
        step.notes.map((n) => n.midi),
        this.settings!.judge,
      );
      this.shownAt = performance.now();
      this.firstPressAt = null;
      this.pressedHere = false;
      this.optionalHere = new Map();
      this.noteOptional(step);
      const held = new Set(this.cb.heldNotes());
      early = early.filter((m) => held.has(m));
      for (const n of step.notes) {
        if (early.includes(n.midi) && this.waitJudge.credit(n.midi)) {
          this.pressedHere = true;
          this.paint(n, this.cb.colors().correct);
          this.setOwner(n.midi, n.hand); // この位置の手の音として押したことになる
        }
      }
      // 先の位置の音をすでに弾いている＝先へ弾き進めている
      window.clearTimeout(this.settleTimer);
      if (early.length) this.creditOptional(step, true);
      else if (this.creditOptional(step, false)) this.scheduleSettle(step);
      this.cb.status(this.progressText(i));
      this.cb.feedback('', '');
      if (!this.waitJudge.done) {
        const hits = new Set(this.waitJudge.hits);
        this.renderMini(step, (m) => (hits.has(m) ? 'correct' : 'pending'), []);
        this.scheduleHint(step);
        return;
      }
      this.record({ step, correct: true, missing: [], extras: [], reactionMs: null, deviations: [] });
      if (i + 1 >= this.steps.length) {
        this.stop();
        return;
      }
      early = early.filter((m) => !step.notes.some((n) => n.midi === m));
      i++;
    }
  }

  private pressWait(ev: NoteEvent): void {
    let judge = this.waitJudge!;
    let step = this.steps[this.current];
    // 押さえたままの音を確かめるために少し待っている間に、次の音を弾いた → いまの位置は済ませ、この押鍵は次の位置の音として扱う
    // （待っている位置の音と同じ鍵盤を弾き直したときも。いまの位置の音として「押し直し」に数えて捨ててしまわないように）
    if (this.awaitingSettle(step) && !judge.missing.includes(ev.note)) {
      this.creditOptional(step, true);
      if (judge.done) {
        this.finishWaitStep(step);
        if (!this.running) return;
        judge = this.waitJudge!;
        step = this.steps[this.current];
      }
    }
    this.firstPressAt ??= ev.time;
    const r = judge.press(ev.note);
    if (r === 'hit') {
      this.pressedHere = true;
      const n = step.notes.find((x) => x.midi === ev.note) ?? step.notes.find((x) => (x.midi - ev.note) % 12 === 0);
      if (n) this.owners.set(ev.note, { hand: n.hand, pressedAt: ev.time });
      const hit = new Set(judge.hits);
      step.notes.forEach((n) => hit.has(n.midi) && this.paint(n, this.cb.colors().correct));
    }
    // 先の位置の音を弾き始めたのなら、読み間違いではない（下で持ち越す）
    const ahead = this.aheadNotes(this.current);
    // ほかの音がそろった、または先の位置の音を弾き始めた → 押し直さなくてよい音は弾けたことにする
    if (this.creditOptional(step, r === 'extra' && ahead.has(ev.note))) this.scheduleSettle(step);
    if (r === 'extra' && !ahead.has(ev.note)) {
      this.cb.feedback(`余計な音: ${this.names(judge.extras.filter((m) => !ahead.has(m)), step)}`, 'ng');
    }
    const hits = new Set(judge.hits);
    this.renderMini(step, (m) => (hits.has(m) ? 'correct' : 'pending'), judge.extras.filter((m) => !ahead.has(m)));
    if (judge.done) this.finishWaitStep(step);
    else this.scheduleHint(step);
  }

  /** 足りない音が、押さえたままなので少し待って確かめている音（blocked / held）だけか */
  private awaitingSettle(step: Step): boolean {
    const judge = this.waitJudge!;
    if (judge.done) return false;
    const missing = step.notes.filter((n) => judge.missing.includes(n.midi));
    const kinds = missing.map((n) => this.optionalHere.get(n.midi));
    if (!kinds.length || kinds.some((k) => !k)) return false;
    if (kinds.includes('held') && !this.pressedHere) return false;
    return kinds.some((k) => k !== 'sustained');
  }

  /**
   * しばらく先へ進めないときは、足りない音を楽譜とメッセージで示す
   * （何が足りないのか分からないまま止まらないように。→ キーで飛ばすこともできる）
   */
  private scheduleHint(step: Step): void {
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => {
      if (!this.running || this.steps[this.current] !== step || this.waitJudge!.done) return;
      const missing = step.notes.filter((n) => this.waitJudge!.missing.includes(n.midi));
      if (!missing.length) return;
      for (const n of missing) this.paint(n, this.cb.colors().missing);
      const hits = new Set(this.waitJudge!.hits);
      this.renderMini(step, (m) => (hits.has(m) ? 'correct' : 'missing'), []);
      this.cb.feedback(
        `<span class="missing">足りない音: ${this.names(missing.map((n) => n.midi), step)}</span><span class="sub">弾き直すか、「飛ばす」（→ キー）で先へ進めます</span>`,
        '',
      );
    }, HINT_MS);
  }

  /** いまのステップが済んだ。記録して次へ進む */
  private finishWaitStep(step: Step): void {
    window.clearTimeout(this.settleTimer);
    window.clearTimeout(this.hintTimer);
    const judge = this.waitJudge!;
    const ahead = this.aheadNotes(this.current);
    // 先の位置の音を先に押していた（和音の一部を早めに押した等）ときは、押さえていれば持ち越し、間違いに数えない
    const held = new Set(this.cb.heldNotes());
    const early = judge.extras.filter((m) => held.has(m) && ahead.has(m));
    this.record({
      step,
      correct: judge.extras.length === early.length,
      missing: [],
      extras: judge.extras.filter((m) => !early.includes(m)),
      reactionMs: this.firstPressAt === null ? null : Math.max(0, this.firstPressAt - this.shownAt),
      deviations: [],
    });
    if (this.current + 1 < this.steps.length) this.showWaitStep(this.current + 1, early);
    else this.stop();
  }

  /** i 番目より後の、少し先までのステップに出てくる音（先に押してしまった音の持ち越し先） */
  private aheadNotes(i: number): Set<number> {
    const out = new Set<number>();
    for (const st of this.steps.slice(i + 1, i + 1 + LOOKAHEAD_STEPS)) for (const n of st.notes) out.add(n.midi);
    return out;
  }

  // ---- テンポモード ----

  private startTempo(): void {
    const { numerator, denominator } = this.loaded!.timeSignature;
    this.beatMs = 60000 / this.bpm;
    // カウントは1小節（4分音符で数える）
    const countIn = Math.max(1, Math.round((numerator * 4) / denominator));
    const origin = performance.now() + 400 + countIn * this.beatMs;
    // 抜粋は最初の小節の頭から数える（休符から始まる小節もあるため）
    const zero = this.zeroTime ?? this.steps[0].time - (this.steps[0].time % ((numerator * 4) / denominator));
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
    this.creditFrom = 0;
    this.finalized = 0;
    this.cursorAt = -1;
    this.endAt = this.stepTimes[this.stepTimes.length - 1] + windowMs + 300;
    this.clock = new BeatClock(this.metronome, origin, this.beatMs, numerator, countIn, this.settings!.metronome, this.endAt);
    this.score.moveCursor(this.steps[0].entryIndex);
    this.renderMini(this.steps[0], () => 'pending', []);
    this.cb.feedback(`カウント ${countIn} 拍のあと始まります（♩=${Math.round(this.bpm)}）`, '');
    this.cb.status(this.progressText(0));
    this.loop();
  }

  private loop(): void {
    const now = performance.now();
    this.clock!.tick(now);
    // カーソルはそのステップの時刻に合わせて進める
    let k = this.cursorAt;
    while (k + 1 < this.steps.length && this.stepTimes[k + 1] <= now + 30) k++;
    if (k !== this.cursorAt && k >= 0) {
      this.cursorAt = k;
      this.score.moveCursor(this.steps[k].entryIndex);
      this.score.revealTiesUpTo(this.steps[k].time);
      this.cb.status(this.progressText(k));
    }
    this.creditHeld(now);
    for (const t of this.matcher!.expire(now)) {
      const { step, note } = this.targetOf[t];
      this.paint(this.steps[step].notes[note], this.cb.colors().missing);
    }
    this.finalizeTempo(now);
    if (now > this.endAt) {
      this.stop();
      return;
    }
    if (this.running) this.raf = requestAnimationFrame(() => this.loop());
  }

  /**
   * 押し直しが起きない音（sustained で鳴り続けている音／前から押さえたままの鍵盤）を、押鍵なしで当たりにする。
   * 弾き直してもよいので、受け付ける時間（窓）が終わるまで待ち、弾き直されなかったときだけ当たりにする。
   * 同じ手で押さえたままの鍵盤（held）は、そのステップのほかの音を弾いたときに限る（待機モードと同じ）。
   */
  private creditHeld(now: number): void {
    const m = this.matcher!;
    let sounding: Set<number> | null = null;
    for (let i = this.creditFrom; i < m.targets.length && m.targets[i].time <= now; i++) {
      if (m.result(i).hit || this.optionalTargets.has(i)) continue;
      const { step, note } = this.targetOf[i];
      const n = this.steps[step].notes[note];
      sounding ??= new Set(this.cb.sounding());
      const before = m.targets[i].time - m.windowMs;
      const at = this.cb.heldSince(n.midi);
      if (n.sustained && sounding.has(n.midi)) this.optionalTargets.set(i, 'sustained');
      else if (heldByOtherHand(n.hand, this.owners.get(n.midi), at, before)) this.optionalTargets.set(i, 'blocked');
      else if (heldFromBefore(at, before)) this.optionalTargets.set(i, 'held');
    }
    while (this.creditFrom < m.targets.length && m.targets[this.creditFrom].time + m.windowMs < now) {
      const i = this.creditFrom++;
      const kind = this.optionalTargets.get(i);
      const step = this.targetOf[i].step;
      const pressedHere = () => this.targetOf.some((t, j) => t.step === step && j !== i && m.result(j).hit);
      if (kind && (kind !== 'held' || pressedHere()) && m.credit(i)) {
        const { step, note } = this.targetOf[i];
        this.paint(this.steps[step].notes[note], this.cb.colors().correct);
      }
    }
  }

  private pressTempo(ev: NoteEvent): void {
    const r = this.matcher!.press(ev.note, ev.time);
    if (r.kind === 'hit') {
      const { step, note } = this.targetOf[r.target];
      const s = this.steps[step];
      this.owners.set(ev.note, { hand: s.notes[note].hand, pressedAt: ev.time });
      this.paint(s.notes[note], this.cb.colors().correct);
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
      // 押さえたままで当たりにした音（ずれ null）はタイミングの集計に入れない
      const deviations = results.flatMap((t) => (t.r.hit && t.r.deviationMs !== null ? [t.r.deviationMs] : []));
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
    const record: AnswerRecord = {
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
    };
    this.records.push(record);
    // テンポモードは戻れないので、すぐ保存する
    if (s.songMode === 'tempo') this.flush();
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

  private paint(n: StepNote, color: string | null): void {
    for (const r of n.refs) this.score.colorNote(r.entryIndex, r.rawIndex, color);
  }

  private setOwner(midi: number, hand: Step['notes'][number]['hand']): void {
    const at = this.cb.heldSince(midi);
    if (at !== undefined) this.owners.set(midi, { hand, pressedAt: at });
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
