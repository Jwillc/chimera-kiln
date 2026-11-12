/** Messages between the main thread and the CHIMERA AudioWorklet. */
import type { HumanArtic } from "../wasm/types.ts";
import type { VoiceSource, VoiceTelemetry } from "../wasm/types.ts";
import type { Segment, PlannedSegment } from "../wasm/types.ts";
import type { Gesture } from "../wasm/types.ts";
import type { CreatureTelemetry } from "../wasm/types.ts";
import type { BeatStep, BodyMix } from "../wasm/types.ts";

export interface PhraseMsg {
  segments: Segment[];
  intonation?: "statement" | "question" | "flat";
  pause?: number;
}

export type BodyName = "male" | "female" | "child";

export type ToWorklet =
  | { type: "body"; body: BodyMix }
  | { type: "artic"; values: Partial<HumanArtic>; tipFree?: boolean }
  | { type: "source"; values: Partial<VoiceSource> }
  | { type: "gate"; level: number }
  | { type: "telemetry"; enabled: boolean }
  /** gestures planned on the main thread with times relative to "now" (the worklet adds its clock) */
  | { type: "schedule"; gestures: Gesture[]; segments: PlannedSegment[]; end: number; id: number; replace: boolean; lead?: number }
  | { type: "stopSpeech" }
  /** switch the active voice: "human" or a creature id */
  | { type: "creature"; id: string; params?: Record<string, number> }
  | { type: "cparams"; values: Record<string, number> }
  | { type: "call"; id: string; pitch?: number; amp?: number }
  | { type: "stopCall" }
  /** beatbox sequencer: any subset of its state */
  | { type: "beat"; steps?: (BeatStep | null)[]; bpm?: number; swing?: number; playing?: boolean }
  /** end the open-ended gestures with this tag now (a sung note released) */
  | { type: "release"; tag: number }
  /** play one beatbox sound as soon as the mouth can make it */
  | { type: "beatHit"; id: string; note?: number; accent?: number }
  /** what is being done to the throat (the interrogation game): any subset; the first one gives the voice its water model */
  | { type: "ordeal"; values: Partial<Ordeal> };

/** What is done to the throat: water at the lips (cm³/s), the head held back (degrees), injuries 0..1, blood (cm³/s). */
export interface Ordeal {
  pour: number;
  tilt: number;
  lip: number;
  jaw: number;
  nose: number;
  teeth: number;
  bleed: number;
}
export const ORDEAL_KEYS = ["pour", "tilt", "lip", "jaw", "nose", "teeth", "bleed"] as const;

/** The throat's state under an ordeal, as the engine reports it (crates/chimera/src/voice/water.rs). */
export interface Throat {
  /** cm³ in the tract; how far up the airway it stands (cm from the folds); its depth over them (cm) */
  volume: number;
  surface: number;
  depth: number;
  /** the gas path through it (cm²; -1 when no water spans the airway) */
  channel: number;
  /** bubbles that have broken through, counted from the start */
  bubbles: number;
  /** cm³/s going in at the lips, back out over them, and coughed out */
  enter: number;
  spill: number;
  spray: number;
  /** 0 none, 1 pressing, 2 blast, 3 after */
  cough: number;
  swallow: number;
  gag: number;
  gasp: number;
  /** how raw the folds are, how badly he needs a breath, how hard he is pushing (each 0..1) */
  sore: number;
  hunger: number;
  push: number;
  /** how far back the head is (degrees) */
  tilt: number;
  lip: number;
  jaw: number;
  nose: number;
  teeth: number;
  bleed: number;
}
export const THROAT_KEYS = ["volume", "surface", "depth", "channel", "bubbles", "enter", "spill", "spray", "cough", "swallow", "gag", "gasp", "sore", "hunger", "push", "tilt", "lip", "jaw", "nose", "teeth", "bleed"] as const;

export interface TelemetryMessage {
  type: "telemetry";
  t: VoiceTelemetry;
  /** fraction of the render-quantum budget used by the engine (smoothed) */
  load: number;
  body: BodyMix;
  nPh: number;
  nOr: number;
  /** beatbox step under the playhead (−1 when the sequencer is stopped) */
  beatStep: number;
  /** the throat's state, once an ordeal has begun */
  throat?: Throat;
}

export interface PlannedMessage {
  type: "planned";
  id: number;
  t0: number;
  end: number;
  segments: PlannedSegment[];
}

export interface CreatureTelemetryMessage {
  type: "ctelemetry";
  t: CreatureTelemetry;
  load: number;
}

export type FromWorklet =
  | { type: "ready"; sampleRate: number; body: BodyMix; nPh: number; nOr: number; creature: string }
  | TelemetryMessage
  | CreatureTelemetryMessage
  | PlannedMessage
  | { type: "error"; message: string };
