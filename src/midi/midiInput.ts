import { parseMidiMessage, parseSustainPedal } from './parse';
import type { NoteListener } from './types';

export type MidiStatus =
  | { kind: 'unsupported' }
  | { kind: 'denied'; message: string }
  | { kind: 'ready'; devices: string[] };

/** Web MIDI API から全入力デバイスのノートイベントを受け取る。抜き差しに追従する。 */
export class MidiInput {
  private access: MIDIAccess | null = null;

  constructor(
    private readonly onNote: NoteListener,
    private readonly onStatus: (status: MidiStatus) => void,
    private readonly onPedal: (down: boolean) => void = () => {},
  ) {}

  async start(): Promise<void> {
    if (!('requestMIDIAccess' in navigator)) {
      this.onStatus({ kind: 'unsupported' });
      return;
    }
    try {
      this.access = await navigator.requestMIDIAccess();
    } catch (e) {
      this.onStatus({ kind: 'denied', message: e instanceof Error ? e.message : String(e) });
      return;
    }
    this.access.onstatechange = () => this.attach();
    this.attach();
  }

  private attach(): void {
    if (!this.access) return;
    const devices: string[] = [];
    this.access.inputs.forEach((input) => {
      // 同じハンドラの再代入なので、何度呼ばれても二重登録にはならない
      input.onmidimessage = (e) => {
        if (!e.data) return;
        const ev = parseMidiMessage(e.data, e.timeStamp);
        if (ev) this.onNote(ev);
        const pedal = parseSustainPedal(e.data);
        if (pedal !== null) this.onPedal(pedal);
      };
      if (input.state === 'connected') devices.push(input.name ?? '不明なデバイス');
    });
    this.onStatus({ kind: 'ready', devices });
  }
}
