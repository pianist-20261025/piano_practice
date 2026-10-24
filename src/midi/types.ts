export type NoteSource = 'midi' | 'virtual' | 'keyboard';

/** MIDI・仮想鍵盤・PCキーボードで共通の入力イベント */
export interface NoteEvent {
  type: 'on' | 'off';
  /** MIDI ノート番号 0–127 */
  note: number;
  velocity: number;
  /** performance.now() 基準のミリ秒 */
  time: number;
  source: NoteSource;
}

export type NoteListener = (ev: NoteEvent) => void;
