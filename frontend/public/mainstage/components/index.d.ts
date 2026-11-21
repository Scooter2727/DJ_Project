// FLXHero: global namespace. Vanilla canvas, no framework.
export type Row = 'TRIM' | 'HI' | 'MID' | 'LOW' | 'CFX';
export type Channel = 1 | 2;
export type Dir = 'cw' | 'ccw';
export type Judgment = 'perfect' | 'good' | 'miss';

export interface LiveNote { id: string | number; channel: Channel; row: Row; dir: Dir; time: number; state: 'pending' | 'hit' | 'miss'; judgedAt?: number; degrees?: number; startPosition?: number; }
export interface AudioFrame { kick: number; bass: number; hats: number; energy: number; bands?: number[]; level?: [number, number]; }
export interface GameFrame { time: number; bpm: number; approach?: number; notes: LiveNote[]; score: number; combo: number; multiplier?: number; energy?: number; mode?: 'live' | 'keys' | 'demo'; audio?: AudioFrame; traces?: Record<string, number[]>; recordedMix?: boolean; entryCue?: string | null; }
export interface GameSource { frame(dt: number): GameFrame; attach?(screen: Screen): void; setRows?(rows: Row[]): void; }

export interface KnobEvent { channel: Channel; row: Row; position?: number; delta?: number; }
export interface Turn { channel: Channel; row: Row; dir: Dir | null; amount: number; position: number; }

export interface GameplayScreenProps { source?: GameSource; rows?: Row[]; camera?: { c?: number; k?: number }; knobSmoothing?: number; show?: { venue?: boolean; crowd?: boolean; deck?: boolean; hud?: boolean; webcam?: boolean }; webcam?: MediaStream | HTMLVideoElement; webcamMirror?: boolean; }
export interface Screen {
  el: HTMLElement;
  knob(ev: KnobEvent): Turn | null;
  showJudgment(ev: { channel: Channel; row: Row; judgment: Judgment; reason?: 'wrong-way' }): void;
  onTurn(fn: (t: Turn) => void): () => void;
  setSource(src: GameSource): void;
  setRows(rows: Row[]): void;
  setWebcam(src: MediaStream | HTMLVideoElement | null): void;
  getEnergy(): number;
  destroy(): void;
}
export declare function createScreen(el: HTMLElement, props?: GameplayScreenProps): Screen;
export declare function createSampleSource(opts?: { autoplay?: boolean; keyboard?: boolean; approach?: number; chart?: object }): GameSource & { setAutoplay(on: boolean): void; on(evt: 'judge' | 'mode', fn: (d: any) => void): void };

export interface DeckProps { beat: number; e: number; fxOn?: boolean; }
export interface NoteProps { r?: number; side?: Channel; tail?: boolean; alpha?: number; }
export interface HitMarkerProps { ready?: number; flashT?: number; flashJ?: Judgment; now?: number; }
export interface CrowdProps { t: number; e: number; beat: number; }

export declare class Equalizer { constructor(bands?: number); update(dt: number, audio: AudioFrame, t: number): void; drawBank(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cols: number, rows: number, mirror?: boolean): void; drawMeter(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rows: number, side: 0 | 1): void; }
export declare function sampleAudio(time: number, bpm: number): AudioFrame;
export interface TitleProps { text?: string; sub?: string; size?: number; px?: number; maxWidth?: number; beat?: number; t?: number; }
export declare const Title: { draw(ctx: CanvasRenderingContext2D, cx: number, cy: number, o?: TitleProps): void };
export interface Track { id: string; name: string; color: string; icon: 'mic' | 'star' | 'bolt'; bpm: number; }
export interface TrackSelectPage { el: HTMLElement; jog(ev: { side: 'left' | 'right'; delta: number }): void; knob(ev: KnobEvent): void; select(i: number): void; next(): void; prev(): void; confirm(): void; selected(): Track; destroy(): void; }
export declare const TrackSelect: { create(el: HTMLElement, opts?: { tracks?: Track[]; index?: number; keyboard?: boolean; onChange?(t: Track, i: number): void; onConfirm?(t: Track, i: number): void }): TrackSelectPage };
export declare const TRACKS: Track[];
