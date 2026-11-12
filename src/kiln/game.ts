/**
 * The kiln game: spin a tyre up on a diesel engine's flywheel, let it go across the
 * yard, and as the man at the ladder get it under the tyre at the right lean, so that the tyre
 * climbs it and comes down the kiln's chimney.
 *
 * The player is two men in turn. At the engine: the lever (W and S), and when the man with the
 * pole knocks the tyre off the shaft (Space).
 * Once the tyre is rolling: the ladder, a step to either side (A and D) and its lean (W and S).
 * It is all seen from one place, behind the engine, as the clip it comes from was filmed.
 * What the tyre then does is `physics.ts`; this file is the hands, the camera and the ears.
 *
 * Every sound is a CHIMERA airway rendered ahead (`sounds/compose.py` wrote them into
 * `public/shows/kiln/`); the game only decides when each is heard, and turns the pitch of the
 * held ones with what the simulation is doing.
 */
import { getModel } from "../ui/useModel.ts";
import { NEUTRAL } from "../wasm/engine.ts";
import { label, labelWidth, ring } from "../ui/render/vector.ts";
import { V } from "../ui/colors.ts";
import type { HeadFeed } from "../ui/components/AnatomyView3D.tsx";
import type { OverlayFn } from "../ui/components/AnatomyView.tsx";
import { ENGINE, HEAT, Sim, YARD, type Outcome, type V3 } from "./physics.ts";
import { Yard, type Scene } from "./yard.ts";

export type Phase = "menu" | "spin" | "roll" | "fly" | "after";

export interface Snapshot {
  phase: Phase;
  /** lit surfaces under the wires */
  solid: boolean;
}

interface Clip { buffer: AudioBuffer; gain: number; env?: number[]; text?: string; who?: string }
interface Held { src: AudioBufferSourceNode; gain: GainNode }

const MALE = { female: 0, child: 0 };
const SOLID_KEY = "chimera.kiln.solid";
/** where the camera stands: behind the engine, on its line, looking down it at the chimney */
const HOME = { eye: [-2.85, 1.6, -0.55] as V3, at: [35.5, 4.4, 0] as V3, fov: 52 };
const LOOPS = ["whirr", "squeal", "dust", "wind", "whistle", "fire"] as const;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const deg = (rad: number) => (rad * 180) / Math.PI;

/** what happened, in the words on the screen */
function verdict(o: Outcome): [string, string] {
  const m = o.miss, by = (v: number) => `${Math.abs(v).toFixed(1)} m`;
  const flight = o.launch ? `off the ladder at ${o.launch.toFixed(0)} m/s and ${o.lean.toFixed(1)}°, ${o.apex.toFixed(0)} m up at the top` : "";
  switch (o.kind) {
    case "in": return ["in the chimney", flight];
    case "rim": return ["off the rim", flight];
    case "over": return [`over it by ${by(m!.along)}`, `${flight}: stand it up more`];
    case "short": return [m ? `short by ${by(m.along)}` : "short", `${flight}: lean it back more`];
    case "wide": return [`wide by ${by(m!.across)} to the ${m!.across > 0 ? "right" : "left"}`, flight];
    case "shaft": return ["into the side of the stack", `${flight}: ${o.apex < YARD.chimney.tall + 1 ? "it needs more spin" : "lean it back more"}`];
    case "low": return ["not high enough", `${flight}: it needs more spin`];
    case "stalled": return ["it stopped on the ladder", `it came in at ${o.arrive.toFixed(0)} m/s: it needs more spin`];
    case "clipped": return ["caught a rail", "the ladder was not square under it"];
    case "man": return ["it found the man behind the ladder", "he will be all right"];
    case "bricks": return ["past the ladder, into the bricks", "A and D put the ladder in its way"];
    default: return ["it never got there", "it needs more spin"];
  }
}

export class Game {
  readonly yard: Yard;
  readonly feed: HeadFeed;
  readonly overlay: OverlayFn;
  phase: Phase = "menu";
  sim = new Sim((Date.now() ^ (Math.random() * 2 ** 31)) >>> 0);
  tries = 0;
  wins = 0;
  private t = 0;
  private last = 0;
  private readonly keys = new Set<string>();
  private lever = 0;
  private readonly man = { z: 0, v: 0, lean: 1.2 };
  private readonly cam = { eye: [...HOME.eye] as V3, at: [...HOME.at] as V3, fov: HOME.fov };
  /** where the camera is looking and how long its lens is, before any shake or kick */
  private readonly gaze: V3 = [...HOME.at];
  private lens = HOME.fov;
  private mood: Scene["mood"] = "work";
  private since = 0;
  private up = 0;
  private struck = -1;
  private knock = -1;
  /** what has just shaken the camera, and the rush of air it has just been given; both die away */
  private jolt = 0;
  private whoosh = 0;
  private sunk = -1;
  private hit = -1;
  private doneAt = -1;
  private spinFrom = 0;
  private result: Outcome | null = null;
  private nagged = false;
  private smoked = false;
  private caption: { text: string; from: number; until: number } | null = null;
  private fired = 0;
  private ctx: AudioContext | null = null;
  private out: AudioNode | null = null;
  private raw: Record<string, { bytes: ArrayBuffer; gain: number; env?: number[]; text?: string; who?: string }> = {};
  private clips: Record<string, Clip> = {};
  private held: Partial<Record<(typeof LOOPS)[number], Held>> = {};
  private speaking: { clip: Clip; at: number } | null = null;
  private readonly queue: { at: number; run: () => void }[] = [];
  private readonly off: (() => void)[] = [];

  private constructor(private readonly onSnap: (s: Snapshot) => void) {
    this.yard = new Yard(() => this.tick());
    // solid unless G has been used to choose wire
    this.yard.solid = true;
    try {
      this.yard.solid = localStorage.getItem(SOLID_KEY) !== "0";
    } catch {
      // no storage: solid
    }
    this.feed = {
      get model() {
        return getModel(MALE, 48000);
      },
      view: { pressure: false, particles: false, grid: false, calipers: false },
      maxDpr: 1.5,
      facing: 1,
      stage: this.yard,
      prop: this.yard.prop,
      frame: () => {
        const m = this.mouth();
        return { tele: null, artic: { ...NEUTRAL, jaw: NEUTRAL.jaw + 1.9 * m, lipAp: NEUTRAL.lipAp + 1.5 * m }, epoch: 0 };
      },
    };
    this.overlay = (ctx, _r, _m, _f, _a, size) => this.hud(ctx, size.w, size.h);
  }

  /** Fetch the sounds (rendered by `sounds/compose.py`); they are decoded when the audio starts. */
  static async create(base: string, onSnap: (s: Snapshot) => void): Promise<Game> {
    const g = new Game(onSnap);
    const res = await fetch(base + "kiln.json");
    if (!res.ok) throw new Error(`kiln.json: ${res.status}`);
    const manifest = (await res.json()) as { clips: Record<string, { wav: string; gain: number; env?: number[]; text?: string; who?: string }> };
    await Promise.all(Object.entries(manifest.clips).map(async ([id, c]) => {
      const r = await fetch(base + c.wav);
      if (!r.ok) throw new Error(`${c.wav}: ${r.status}`);
      g.raw[id] = { bytes: await r.arrayBuffer(), gain: c.gain, env: c.env, text: c.text, who: c.who };
    }));
    return g;
  }

  private emit() {
    this.onSnap({ phase: this.phase, solid: this.yard.solid });
  }

  /** Lit surfaces under the wires, or wire alone (the G key); kept between games. */
  setSolid(on: boolean) {
    this.yard.solid = on;
    try {
      localStorage.setItem(SOLID_KEY, on ? "1" : "0");
    } catch {
      // it still holds for this game
    }
    this.emit();
  }

  /** The start button: the audio, the keys, and the first tyre. */
  async start(): Promise<void> {
    if (this.phase !== "menu") return;
    const ctx = (this.ctx = new AudioContext({ latencyHint: "interactive" }));
    await ctx.resume().catch(() => {});
    for (const [id, c] of Object.entries(this.raw)) this.clips[id] = { buffer: await ctx.decodeAudioData(c.bytes.slice(0)), gain: c.gain, env: c.env, text: c.text, who: c.who };
    // many throats at once must not clip
    const master = ctx.createGain(), comp = ctx.createDynamicsCompressor();
    master.gain.value = 0.9;
    comp.threshold.value = -14;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    master.connect(comp).connect(ctx.destination);
    this.out = master;
    for (const id of LOOPS) {
      const c = this.clips[id];
      if (!c) continue;
      const src = ctx.createBufferSource(), gain = ctx.createGain();
      src.buffer = c.buffer;
      src.loop = true;
      gain.gain.value = 0;
      src.connect(gain).connect(master);
      src.start();
      this.held[id] = { src, gain };
      this.off.push(() => src.stop());
    }
    this.listen();
    this.last = performance.now();
    this.fresh();
    this.after(0.5, () => this.say("ready"));
    this.emit();
  }

  private listen() {
    const on = <K extends keyof DocumentEventMap>(type: K, fn: (e: DocumentEventMap[K]) => void) => {
      document.addEventListener(type, fn);
      this.off.push(() => document.removeEventListener(type, fn));
    };
    on("keydown", (e) => {
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (!e.repeat) this.press(e.code);
    });
    on("keyup", (e) => this.keys.delete(e.code));
    on("visibilitychange", () => this.keys.clear());
  }

  private press(code: string) {
    if (code === "KeyG") this.setSolid(!this.yard.solid);
    else if (code === "KeyR" && this.phase !== "menu") this.fresh();
    else if (code === "Space") {
      if (this.phase === "spin" && this.knock < 0) {
        // the pole takes a moment to get there
        this.knock = this.t;
        this.after(0.16, () => this.sim.release());
      } else if (this.phase === "after" && this.t - this.doneAt > 0.8) this.fresh();
    }
  }

  dispose() {
    for (const f of this.off) f();
    this.off.length = 0;
    void this.ctx?.close().catch(() => {});
  }

  private after(delay: number, run: () => void) {
    this.queue.push({ at: this.t + delay, run });
  }

  /** Another tyre on the flywheel. The ladder stays where the last one left it. */
  private fresh() {
    const wasFirst = this.phase === "menu";
    this.sim = new Sim((Date.now() ^ (Math.random() * 2 ** 31)) >>> 0);
    this.phase = "spin";
    this.lever = 0;
    this.mood = "work";
    this.since = this.t;
    this.struck = this.sunk = this.hit = this.doneAt = this.knock = -1;
    this.result = null;
    this.nagged = this.smoked = false;
    this.spinFrom = this.t;
    this.fired = 0;
    this.queue.length = 0;
    this.tries += 1;
    if (!wasFirst) this.emit();
  }

  // ---------------------------------------------------------------- the ears

  private play(id: string, level = 1, rate = 1): Clip | null {
    const c = this.clips[id], ctx = this.ctx;
    if (!c || !ctx || !this.out || level <= 0.004) return null;
    const src = ctx.createBufferSource(), gain = ctx.createGain();
    src.buffer = c.buffer;
    src.playbackRate.value = rate;
    gain.gain.value = c.gain * level;
    src.connect(gain).connect(this.out);
    src.start();
    return c;
  }

  /** one of the men shouts; the one with the tyre moves his mouth, and the words go on the screen */
  private say(id: string, level = 1) {
    const c = this.play(id, level);
    if (!c) return;
    if (c.who === "holder") this.speaking = { clip: c, at: this.t };
    if (c.text) this.caption = { text: c.text, from: this.t, until: this.t + c.buffer.duration + 0.6 };
  }

  private mouth(): number {
    const s = this.speaking;
    if (!s?.clip.env) return 0;
    const i = Math.floor((this.t - s.at) * 40);
    if (i >= s.clip.env.length) {
      this.speaking = null;
      return 0;
    }
    return s.clip.env[Math.max(0, i)];
  }

  private hold(id: (typeof LOOPS)[number], level: number, rate: number) {
    const h = this.held[id], ctx = this.ctx;
    if (!h || !ctx) return;
    h.gain.gain.setTargetAtTime(Math.max(0, level) * (this.clips[id]?.gain ?? 1), ctx.currentTime, 0.04);
    h.src.playbackRate.setTargetAtTime(clamp(rate, 0.25, 4), ctx.currentTime, 0.04);
  }

  /** how loud something at a place is from where the camera stands */
  private near(p: V3, ref: number): number {
    const e = this.cam.eye;
    return 1 / (1 + Math.hypot(p[0] - e[0], p[1] - e[1], p[2] - e[2]) / ref);
  }

  private sounds() {
    const sim = this.sim, engineAt: V3 = [YARD.release, 0.7, -0.5];
    // the engine: one stroke a firing, quicker and harder with the lever
    if (sim.fired !== this.fired) {
      this.fired = sim.fired;
      const u = (sim.rpm - ENGINE.idle) / (ENGINE.max - ENGINE.idle);
      // at speed the strokes run into each other: each is quieter, so the whole is not louder
      const crowd = Math.sqrt(Math.max(1, (sim.rpm / 120) * 0.12));
      this.play(sim.fired % 2 ? "putt1" : "putt2", ((0.55 + 0.45 * sim.lever) * this.near(engineAt, 9) * 1.6) / crowd, 0.85 + 0.5 * u + 0.04 * Math.sin(sim.fired * 1.7));
    }
    const tread = sim.tread, speed = Math.hypot(...sim.vel), gone = sim.outcome?.kind === "in" || sim.phase === "done";
    const hot = clamp((sim.hot - HEAT.smoke) / (HEAT.fire - HEAT.smoke), 0, 1), nearTyre = this.near(sim.pos, 14);
    this.hold("whirr", gone ? 0 : clamp(Math.abs(tread) / 30, 0, 1) * (sim.phase === "held" ? this.near(engineAt, 9) * 1.5 : 0.5 * nearTyre), 0.35 + Math.abs(tread) / 32);
    this.hold("squeal", gone ? 0 : (sim.phase === "held" ? hot * 0.7 + clamp(Math.abs(sim.slip) / 12, 0, 0.5) : 0) * this.near(engineAt, 9) * 1.5, 0.8 + tread / 150);
    // the dirt it throws is heard from the engine as a tearing that rises as the tyre gets away
    this.hold("dust", (sim.phase === "ground" || sim.phase === "ladder") && !gone ? clamp(sim.slip / 14, 0.2, 1) * (0.5 + nearTyre) * 1.5 : 0, 0.7 + speed / 14);
    this.hold("wind", (this.phase === "fly" ? clamp(speed / 30, 0, 0.6) : 0.1) + 1.6 * this.whoosh, 0.8 + speed / 50 + 1.2 * this.whoosh);
    this.hold("whistle", sim.phase === "air" ? clamp(speed / 22, 0.1, 1) * 0.8 : 0, 0.75 + speed / 36 - sim.vel[1] / 90);
    this.hold("fire", sim.burning && !gone ? nearTyre * 2 : 0, 1);
    for (const e of sim.events.splice(0)) {
      const hard = "hard" in e ? e.hard : 0;
      if (e.kind === "release") {
        this.say("go");
        this.play("thud", 0.9);
        this.jolt = 0.5;
        this.whoosh = 0.6;
        this.after(0.7, () => this.say("mine", 0.9));
      } else if (e.kind === "impact") {
        this.struck = this.t;
        this.play("clang", clamp(hard / 12, 0.5, 1.4));
        this.play("thud", 0.8, 0.8);
      } else if (e.kind === "rung") this.play("rung", 0.9, 0.9 + hard / 40);
      else if (e.kind === "launch") {
        // nothing checks it here: no shake, only the air it leaves behind
        this.whoosh = 1;
        this.play("thud", 0.5, 1.5);
      }
      else if (e.kind === "clip") this.play("rim", 0.8, 1.5);
      else if (e.kind === "rim") {
        this.play("rim", clamp(hard / 10, 0.4, 1.2));
        this.jolt = 0.4;
      }
      else if (e.kind === "shaft") this.play("shaft", clamp(hard / 6, 0.4, 1.2));
      else if (e.kind === "ground") this.play("thud", clamp(hard / 10, 0.15, 1) * this.near(sim.pos, 20) * 2);
      else if (e.kind === "bricks") this.play("bricks", clamp(hard / 10, 0.4, 1.1) * this.near(sim.pos, 20) * 2.2);
      else if (e.kind === "man") {
        this.hit = this.t;
        this.play("thud", 0.9);
        this.play("yelp", 0.9);
      } else if (e.kind === "burn") this.say("burn");
      else if (e.kind === "in") {
        this.sunk = this.t;
        this.play("in", 1.1);
        this.jolt = 0.5;
      }
    }
    if (this.phase === "spin") {
      if (!this.smoked && sim.hot > HEAT.smoke + 15) {
        this.smoked = true;
        this.say("smoke");
      }
      if (!this.nagged && this.t - this.spinFrom > 6 && sim.lever < 0.45) {
        this.nagged = true;
        this.say("more");
      }
    }
  }

  // ---------------------------------------------------------------- one frame

  private tick(): Scene {
    const now = performance.now(), dt = this.phase === "menu" ? 0 : Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const clock = now / 1000;
    if (this.phase !== "menu") {
      this.t += dt;
      while (this.queue.length) {
        const i = this.queue.findIndex((q) => q.at <= this.t);
        if (i < 0) break;
        this.queue.splice(i, 1)[0].run();
      }
      this.act(dt);
      this.sim.ladder.z = this.man.z;
      this.sim.ladder.lean = this.man.lean;
      this.jolt *= Math.exp(-dt / 0.2);
      this.whoosh *= Math.exp(-dt / 0.5);
      this.sim.step(dt, this.lever);
      this.sounds();
      this.follow(dt);
    }
    this.aim(dt, clock);
    return {
      t: this.phase === "menu" ? clock : this.t, sim: this.sim, eye: this.cam.eye, at: this.cam.at, fov: this.cam.fov,
      up: this.up, mouth: this.mouth(), mood: this.mood, since: this.since, struck: this.struck, knock: this.knock, sunk: this.sunk, hit: this.hit,
    };
  }

  /** the keys: the lever while the tyre is on the wheel, the ladder once it is not */
  private act(dt: number) {
    const k = this.keys;
    const upDown = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const leftRight = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    if (this.phase === "spin") this.lever = clamp(this.lever + upDown * (upDown > 0 ? 0.45 : 0.9) * dt, 0, 1);
    else {
      // with the tyre gone the engine is left to idle down
      this.lever = Math.max(0, this.lever - 0.5 * dt);
      if (this.sim.phase === "ground" || this.phase === "after") {
        this.man.lean = clamp(this.man.lean + upDown * 0.17 * dt, YARD.leanMin, YARD.leanMax);
        // he does not start or stop at once with four metres of ladder in his hands
        this.man.v += clamp(leftRight * 3.8 - this.man.v, -22 * dt, 22 * dt);
        this.man.z = clamp(this.man.z + this.man.v * dt, -YARD.reach, YARD.reach);
        if (Math.abs(this.man.z) >= YARD.reach) this.man.v = 0;
      } else this.man.v = 0;
    }
    // the man who put the tyre on has his hands on it for a moment, then gets up and out of its way
    this.up += clamp((this.t - this.spinFrom < 1.1 ? 0 : 1) - this.up, -dt / 0.5, dt / 0.9);
  }

  /** what phase the simulation has put the game in, and what the men make of it */
  private follow(_dt: number) {
    const sim = this.sim;
    if (this.phase === "spin" && sim.phase !== "held") {
      this.phase = "roll";
      this.mood = "watch";
      this.since = this.t;
      this.emit();
    }
    if (this.phase === "roll" && sim.phase === "air") this.phase = "fly";
    if (sim.outcome && this.phase !== "after") {
      const o = (this.result = sim.outcome), won = o.kind === "in";
      this.phase = "after";
      this.doneAt = this.t;
      this.mood = won ? "cheer" : "groan";
      this.since = this.t;
      if (won) {
        this.wins += 1;
        this.after(0.5, () => this.play("cheer", 1));
        this.after(0.9, () => this.say("inside"));
        // and then all of them, every time it goes in
        this.after(2.5, () => this.say("day"));
      } else {
        this.after(o.kind === "man" ? 0.6 : 0.25, () => this.play("groan", 0.8));
        const near = o.kind === "rim" || (o.miss && Math.hypot(o.miss.along, o.miss.across) < 2.5);
        if (near) this.after(1.1, () => this.say("close"));
        this.after(near ? 2.6 : 1.8, () => this.say("again", 0.9));
      }
      this.emit();
    }
  }

  /**
   * The camera stands where the one filming stood: behind the engine, for the whole of it. It
   * never moves from there; it turns and tilts after the tyre and zooms in as the tyre gets small.
   */
  private aim(dt: number, clock: number) {
    const sim = this.sim, cam = this.cam, p = sim.pos, menu = this.phase === "menu";
    // a hand holds it, on ground an engine is shaking
    const rattle = menu ? 0 : 0.004 * (0.3 + sim.lever);
    const eye: V3 = [HOME.eye[0] + rattle * Math.sin(clock * 61) + 0.02 * Math.sin(clock * 0.7), HOME.eye[1] + rattle * Math.sin(clock * 47) + 0.015 * Math.sin(clock * 0.9), HOME.eye[2] + (menu ? 0.12 : 0.02) * Math.sin(clock * 0.4)];
    let at: V3 = HOME.at, fov = HOME.fov, quick = 3, lensQuick = 0;
    /** the field of view that puts `tall` metres of the yard in the picture at a place */
    const frame = (q: V3, tall: number) => clamp(deg(2 * Math.atan(tall / 2 / Math.hypot(q[0] - eye[0], q[1] - eye[1], q[2] - eye[2]))), 8, HOME.fov);
    if (this.phase !== "spin" && !menu) {
      const c = YARD.chimney, mouth: V3 = [c.x, c.tall - 0.6, c.z];
      const kind = this.phase === "after" ? this.result?.kind : undefined;
      if (sim.phase === "ground" && !kind) {
        // the tyre at the bottom of the picture and the ladder at the top: as the one runs at the
        // other the gap between them closes, and the lens closes with it, faster and faster
        const L = sim.ladderNow();
        const seen = (q: V3) => ({ yaw: Math.atan2(q[2] - eye[2], q[0] - eye[0]), pitch: Math.atan2(q[1] - eye[1], Math.hypot(q[0] - eye[0], q[2] - eye[2])) });
        const a = seen([p[0], 0.2, p[2]]), b = seen([L.foot[0], 3.1, L.foot[2]]);
        const yaw = (a.yaw + b.yaw) / 2, pitch = (a.pitch + b.pitch) / 2 + 0.01;
        at = [eye[0] + 20 * Math.cos(pitch) * Math.cos(yaw), eye[1] + 20 * Math.sin(pitch), eye[2] + 20 * Math.cos(pitch) * Math.sin(yaw)];
        fov = clamp(deg(Math.abs(b.pitch - a.pitch)) * 1.35 + 5, 11, HOME.fov);
        quick = 9;
      } else if (kind === "in" || kind === "rim") {
        at = mouth;
        fov = frame(mouth, 7);
      } else if (kind && this.result?.launch) {
        // any other flight: the whole stack, and where it fell
        at = [c.x - 3, 6.5, p[2] * 0.3];
        fov = frame(at, 19);
      } else if (sim.phase === "ladder" || sim.phase === "air") {
        // It goes up the ladder and off it faster than a hand can follow. The camera does not hold
        // it still in the picture: the lens opens at once, the tyre shoots up through the frame,
        // and the camera is whipped up after it, catching it as it slows towards the top.
        // Near the top of the stack the mouth is kept in the picture too.
        const since = this.struck >= 0 ? this.t - this.struck : 9, caught = clamp((since - 0.45) / 0.6, 0, 1), lead = 0.1 * caught;
        const high = 0.4 * clamp((p[1] - 6) / 6, 0, 1);
        const q: V3 = [p[0] + sim.vel[0] * lead, p[1] + sim.vel[1] * lead, p[2] + sim.vel[2] * lead];
        at = [q[0] + (mouth[0] - q[0]) * high, q[1] + (mouth[1] - q[1]) * high, q[2] + (mouth[2] - q[2]) * high];
        fov = frame(at, 14 + 6 * high);
        quick = 1.9 + 5.6 * caught;
        lensQuick = 10;
      } else {
        at = [p[0], Math.max(1, p[1]), p[2]];
        fov = frame(at, 8);
        quick = 5;
      }
    }
    const k = menu ? 1 : Math.min(1, dt * quick);
    for (let i = 0; i < 3; i++) {
      cam.eye[i] = eye[i];
      this.gaze[i] += (at[i] - this.gaze[i]) * k;
    }
    this.lens += (fov - this.lens) * (menu ? 1 : Math.min(1, dt * (lensQuick || quick)));
    // a blow near the camera shakes the hand that holds it
    const far = Math.hypot(this.gaze[0] - eye[0], this.gaze[1] - eye[1], this.gaze[2] - eye[2]), shake = this.jolt * 0.011 * far;
    cam.at[0] = this.gaze[0];
    cam.at[1] = this.gaze[1] + shake * Math.sin(clock * 71);
    cam.at[2] = this.gaze[2] + shake * Math.sin(clock * 53 + 1);
    cam.fov = this.lens;
  }

  // ---------------------------------------------------------------- what is written over the picture

  private hud(ctx: CanvasRenderingContext2D, w: number, h: number) {
    if (this.phase === "menu") return;
    const sim = this.sim, t = this.t;
    const size = Math.max(10, Math.min(14, w / 80)), lh = size * 1.75, x0 = size * 1.6;
    const plate = (x: number, y: number, wide: number, tall: number, alpha = 0.72) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#000";
      ctx.fillRect(x, y, wide, tall);
      ctx.restore();
    };
    // ---- what the simulation has, top left
    const rows: [string, string, string][] = [];
    const hotTone = sim.burning ? V.red : sim.hot > HEAT.smoke ? V.amber : V.white;
    if (this.phase === "spin") {
      rows.push(["engine", `${Math.round(sim.rpm / 10) * 10} rpm`, V.white]);
      rows.push(["tread", `${sim.tread.toFixed(0)} m/s`, sim.tread > 50 ? V.green : V.white]);
      rows.push(["rubber", sim.burning ? "alight" : `${sim.hot.toFixed(0)} °c${sim.hot > HEAT.smoke ? "  smoking" : ""}`, hotTone]);
    } else if (this.phase === "roll") {
      rows.push(["speed", `${Math.hypot(...sim.vel).toFixed(0)} m/s`, V.white]);
      rows.push(["tread", `${sim.tread.toFixed(0)} m/s`, V.white]);
      rows.push(["to the ladder", `${Math.max(0, YARD.ladderX - sim.pos[0]).toFixed(0)} m`, V.white]);
    } else if (this.phase === "fly") {
      rows.push(["height", `${sim.pos[1].toFixed(1)} m`, sim.pos[1] > YARD.chimney.tall ? V.green : V.white]);
      rows.push(["speed", `${Math.hypot(...sim.vel).toFixed(0)} m/s`, V.white]);
    }
    rows.push(["ladder", `${deg(this.man.lean).toFixed(1)}°`, this.phase === "spin" ? V.blueMid : V.white]);
    const wind = Math.hypot(sim.wind[0], sim.wind[2]);
    const across = sim.wind[2], alongW = sim.wind[0];
    rows.push(["wind", `${wind.toFixed(1)} m/s ${Math.abs(across) > Math.abs(alongW) ? (across > 0 ? "to the right" : "to the left") : alongW > 0 ? "behind it" : "against it"}`, wind > 1.4 ? V.amber : V.blueMid]);
    plate(x0 - size * 0.8, size * 0.7, size * 31, rows.length * lh + size * 0.9);
    rows.forEach(([name, value, color], i) => {
      label(ctx, name.toUpperCase(), x0, size * 2.2 + i * lh, { size, color: V.blueMid, ls: 0.12 });
      label(ctx, value.toUpperCase(), x0 + size * 14, size * 2.2 + i * lh, { size, color, weight: "m", ls: 0.1 });
    });
    // the lever, as a bar
    if (this.phase === "spin") {
      const y = size * 2.2 + rows.length * lh + size * 0.6, wide = size * 28;
      plate(x0 - size * 0.8, y - size * 0.9, size * 31, size * 2.2);
      ctx.save();
      ctx.strokeStyle = V.blueMid;
      ctx.strokeRect(x0, y - size * 0.3, wide, size * 0.9);
      ctx.fillStyle = sim.lever > 0.98 ? V.amber : V.blue;
      ctx.fillRect(x0, y - size * 0.3, wide * sim.lever, size * 0.9);
      ctx.restore();
    }

    // ---- where the tyre is, when it is small against the sky
    if (this.phase === "fly") {
      const p = this.yard.screen(sim.pos);
      if (p) ring(ctx, p[0], p[1], size * 1.5, sim.burning ? V.amber : V.white, 1, { alpha: 0.7 });
    }

    // ---- the count, top right
    label(ctx, `TYRE ${this.tries}`, w - x0, size * 2.2, { size, color: V.blueMid, ls: 0.12, align: "right" });
    label(ctx, `IN THE CHIMNEY  ${this.wins}`, w - x0, size * 2.2 + lh, { size, color: this.wins ? V.green : V.blueMid, weight: "m", ls: 0.12, align: "right" });

    // ---- how it ended
    const o = this.result;
    if (this.phase === "after" && o && t - this.doneAt > 0.5) {
      const [head, sub] = verdict(o), big = Math.max(18, Math.min(40, w / 26)), alpha = Math.min(1, (t - this.doneAt - 0.5) / 0.3);
      const wide = Math.max(labelWidth(ctx, head.toUpperCase(), { size: big, weight: "m", ls: 0.1 }), labelWidth(ctx, sub.toUpperCase(), { size, ls: 0.1 }));
      plate((w - wide) / 2 - big, h * 0.24 - big * 1.5, wide + 2 * big, big * 1.9 + (sub ? lh * 1.3 : 0), 0.72 * alpha);
      label(ctx, head.toUpperCase(), w / 2, h * 0.24, { size: big, color: o.kind === "in" ? V.green : o.kind === "rim" ? V.amber : V.white, weight: "m", ls: 0.1, align: "center", alpha });
      if (sub) label(ctx, sub.toUpperCase(), w / 2, h * 0.24 + lh * 1.3, { size, color: V.white, ls: 0.1, align: "center", alpha: alpha * 0.85 });
    }

    // ---- what someone just shouted
    const cap = this.caption;
    if (cap && t < cap.until) {
      const cs = Math.max(13, Math.min(22, w / 46)), alpha = Math.min(1, (cap.until - t) / 0.3), text = cap.text.toUpperCase();
      const wide = labelWidth(ctx, text, { size: cs, weight: "m", ls: 0.06 });
      plate((w - wide) / 2 - cs, h - cs * 5.2, wide + 2 * cs, cs * 1.9, 0.72 * alpha);
      label(ctx, text, w / 2, h - cs * 3.95, { size: cs, color: V.white, weight: "m", ls: 0.06, align: "center", alpha });
    }

    // ---- what the player can do from here
    const tips = this.phase === "spin" ? ["W  S   the lever", "space   knock it off the shaft"]
      : this.phase === "roll" ? ["A  D   step the ladder across", "W  S   stand it up, lean it back"]
      : this.phase === "after" ? ["space   another tyre", "W  S  A  D   set the ladder for it"] : [];
    if (tips.length) {
      const opt = { size, ls: 0.12, weight: "m" } as const;
      const wide = Math.max(...tips.map((s) => labelWidth(ctx, s.toUpperCase(), opt)));
      const y0 = h - size * 1.6 - (tips.length - 1) * lh;
      plate(w - x0 - wide - size, y0 - size * 1.4, wide + 2 * size, tips.length * lh + size * 0.6, 0.7);
      tips.forEach((s, i) => label(ctx, s.toUpperCase(), w - x0, y0 + i * lh, { ...opt, color: i === 0 ? V.white : V.blue, align: "right" }));
    }
  }

  /** for the browser checks: the state that decides things */
  get debug() {
    const s = this.sim;
    return { phase: this.phase, sim: s.phase, rpm: s.rpm, tread: s.tread, hot: s.hot, burning: s.burning, pos: s.pos, vel: s.vel, heading: s.heading, lever: this.lever, man: { ...this.man }, outcome: s.outcome, tries: this.tries, wins: this.wins, wind: s.wind, clips: Object.keys(this.clips).length, audio: this.ctx?.state };
  }

  /** for the browser checks: hold or let go of keys, and put the ladder somewhere */
  drive(o: { down?: string[]; up?: string[]; press?: string; z?: number; lean?: number }) {
    for (const k of o.down ?? []) this.keys.add(k);
    for (const k of o.up ?? []) this.keys.delete(k);
    if (o.press) this.press(o.press);
    if (o.z !== undefined) this.man.z = o.z;
    if (o.lean !== undefined) this.man.lean = o.lean;
  }
}
