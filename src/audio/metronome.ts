/** メトロノームのクリック音（Web Audio）。時刻は performance.now() 基準で指定する */
export class Metronome {
  private ctx: AudioContext | null = null;
  private nodes: OscillatorNode[] = [];

  /** 時刻 timeMs に1回鳴らす。accent なら高く大きい音 */
  click(timeMs: number, accent = false): void {
    const ctx = (this.ctx ??= new AudioContext());
    if (ctx.state === 'suspended') void ctx.resume();
    const at = Math.max(ctx.currentTime, ctx.currentTime + (timeMs - performance.now()) / 1000);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1760 : 1320;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.06);
    this.nodes.push(osc);
    osc.onended = () => (this.nodes = this.nodes.filter((n) => n !== osc));
  }

  /** 予約済みのクリックをすべて止める */
  stop(): void {
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        /* すでに止まっている */
      }
    }
    this.nodes = [];
  }
}
