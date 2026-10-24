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

  constructor(
    readonly expected: readonly number[],
    private readonly options: JudgeOptions = DEFAULT_JUDGE_OPTIONS,
  ) {}

  press(midi: number): WaitPress {
    const target = this.expected.find((e) =>
      this.options.octaveEquivalent ? pitchClass(e) === pitchClass(midi) && !this.hit.has(e) : e === midi,
    );
    if (target === undefined) {
      if (this.options.octaveEquivalent && this.expected.some((e) => pitchClass(e) === pitchClass(midi))) return 'repeat';
      this.extra.push(midi);
      return 'extra';
    }
    if (this.hit.has(target)) return 'repeat';
    this.hit.add(target);
    return 'hit';
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
