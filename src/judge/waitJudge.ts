import { DEFAULT_JUDGE_OPTIONS, type JudgeOptions } from './judge';

export type WaitPress = 'hit' | 'repeat' | 'extra';

const pitchClass = (n: number) => ((n % 12) + 12) % 12;

/**
 * 待機モードの1ステップの判定。押した音を順に受け取り、期待音がすべて押されたら完了。
 * 和音を同時に押さなくてもよい（右手と左手が少しずれても、押せた音は覚えておく）。
 * 期待音にない音は「余計な音」として数えるが、進行は止めない。
 */
export class WaitStepJudge {
  private readonly hit = new Set<number>();
  private readonly extra: number[] = [];
  /** いまの弾き方（restart してから）で押せた期待音と、押した時刻（押鍵なしで認めた音は入れない） */
  private readonly hitAt = new Map<number, number>();
  /** いまの弾き方で押した余計な音と、押した時刻 */
  private attemptExtras: { midi: number; time: number }[] = [];

  /** ignored は押しても余計な音に数えない音（判定しない装飾音など） */
  constructor(
    readonly expected: readonly number[],
    private readonly options: JudgeOptions = DEFAULT_JUDGE_OPTIONS,
    private readonly ignored: readonly number[] = [],
  ) {}

  /** time は押した時刻（ms）。和音に余計な音が混ざったかを見るのに使う */
  press(midi: number, time = Number.NaN): WaitPress {
    const target = this.expected.find((e) =>
      this.options.octaveEquivalent ? pitchClass(e) === pitchClass(midi) && !this.hit.has(e) : e === midi,
    );
    if (target === undefined) {
      if (this.ignored.includes(midi)) return 'repeat';
      if (this.options.octaveEquivalent && this.expected.some((e) => pitchClass(e) === pitchClass(midi))) return 'repeat';
      this.extra.push(midi);
      this.attemptExtras.push({ midi, time });
      return 'extra';
    }
    if (this.hit.has(target)) return 'repeat';
    this.hit.add(target);
    this.hitAt.set(target, time);
    return 'hit';
  }

  /**
   * いまの弾き方で、押せた期待音と windowMs 以内に押した余計な音（和音に混ざった音）。
   * 例: ド・ミの和音でドレミを同時に押したときのレ。
   * 余計な音を押してから少し間をおいて正しい音を押した（間違えてから弾き直した）ときは含めない
   */
  chordExtras(windowMs: number): number[] {
    const times = [...this.hitAt.values()];
    return this.attemptExtras.filter((x) => times.some((t) => Math.abs(t - x.time) <= windowMs)).map((x) => x.midi);
  }

  /** いまの弾き方で押した余計な音（押さえたままかどうかを確かめるのに使う） */
  get attemptExtraNotes(): number[] {
    return this.attemptExtras.map((x) => x.midi);
  }

  /**
   * 弾けた音を取り消して、はじめから弾き直す（和音に余計な音が混ざったとき）。
   * 余計な音の記録（extras）は残すので、この位置は間違いとして記録される
   */
  restart(): void {
    this.hit.clear();
    this.hitAt.clear();
    this.attemptExtras = [];
  }

  /**
   * 押鍵なしで弾けたことにする（押さえたままの鍵盤がその音のとき）。期待音でなければ何もしない。
   * 押し直しは起きないので、余計な音にも数えない
   */
  credit(midi: number): boolean {
    if (!this.expected.includes(midi) || this.hit.has(midi)) return false;
    this.hit.add(midi);
    return true;
  }

  get done(): boolean {
    return this.hit.size === this.expected.length;
  }

  get hits(): number[] {
    return this.expected.filter((e) => this.hit.has(e));
  }

  get missing(): number[] {
    return this.expected.filter((e) => !this.hit.has(e));
  }

  get extras(): number[] {
    return [...this.extra];
  }
}
