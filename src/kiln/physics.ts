/**
 * The kiln game's physics: an engine's flywheel spins a tyre up, the tyre is let go across a dirt
 * yard, climbs a ladder a man is holding, and flies, with luck into the kiln's chimney. Nothing
 * here knows about the screen or the sound; the game steps it and reads it.
 *
 * It is a model with parameters, not a script: whether the tyre goes in comes out of how fast it
 * was spun, how hot it got, where the ladder stood and how it leaned, and the wind.
 *
 *   on the shaft     the tyre hangs by its bead on the hub at the end of the engine's shaft; the
 *                    governor chases the lever, the tyre follows the hub by friction and heats
 *                    with its speed
 *   on the ground    all spin, no speed: it claws itself forward (kinetic friction) until it
 *                    rolls; a leaning tyre turns, and the yard's bumps knock it about
 *   at the ladder    the spin is what climbs: the blow against the rungs has a friction impulse
 *                    up the ladder for as long as the tread is still slipping
 *   in the air       gravity, drag (more broadside than edge-on), the lift of a spinning body,
 *                    wind; the chimney's shaft and rim are things to hit
 *
 * Metres, seconds, kilograms. x runs down the yard from the engine to the chimney, y up, z to the
 * right of someone looking down the yard.
 */

export type V3 = [number, number, number];

export const G = 9.81;
/** the tyre: its moment of inertia is k·m·r²; `bead` is the radius of the hole it hangs by */
export const TYRE = { m: 7.5, r: 0.31, wide: 0.19, k: 0.9, bead: 0.186 };
/** a small single-cylinder diesel, the kind that runs a pump: it idles near 900 and is governed near 3000 */
export const ENGINE = {
  idle: 870, max: 3110,
  /** the hub on the shaft's end that the tyre hangs on, the flywheel beside it (m); all that turns (kg m²) */
  hubR: 0.11, flyR: 0.26, inertia: 0.512,
  torque: 29.9, drag: 1.93, governor: 1.163,
  /** how hard the bead bears on the hub, as a force at the tread (N), and the rubber's grip on it */
  press: 130, grip: 0.85,
};
/** the tread's speed for each rad/s of the shaft, when the bead is not slipping on the hub (m) */
export const DRIVE = (ENGINE.hubR * TYRE.r) / TYRE.bead;
export const HEAT = { air: 30, perSpeed: 0.078, cool: 0.2, smoke: 110, fire: 230, slip: 0.0007 };
export const YARD = {
  /** where the tyre meets the ground when it is knocked off, and how high the shaft it hung on is */
  release: 0.95, shaft: 0.62,
  dirt: 0.55, rolling: 0.03,
  /** the ladder: where its foot stands down the yard, its length, half the gap between its rails */
  ladderX: 26, ladderLen: 4.2, ladderHalf: 0.3, rungs: 0.3, rungGrip: 1.0, bounce: 0.1,
  /** how far he can carry it to either side, and how he can lean it (rad from the ground) */
  reach: 4.5, leanMin: 0.75, leanMax: 1.45,
  /** the stack of bricks behind the ladder, and the kiln's wall behind that */
  stack: { x0: 28.4, x1: 30.6, top: 2.5, half: 5.5 },
  wall: { x: 32, top: 3.2 },
  chimney: { x: 35.5, z: 0, tall: 14, base: 2.2, top: 1.45, mouth: 1.15 },
};
const AIR = { rho: 1.2, cdEdge: 1.0, cdBroad: 1.15, lift: 0.35 };

export type Phase = "held" | "ground" | "ladder" | "air" | "done";
export type End =
  | "in" | "rim" | "shaft" | "over" | "short" | "wide" | "low"
  | "stalled" | "clipped" | "man" | "bricks" | "slow";

export interface Outcome {
  kind: End;
  /** the tyre's highest point (m) */
  apex: number;
  /** where it came down through the height of the chimney's mouth, from the mouth's centre:
   *  along the yard (+ is past it) and across (+ is right); null if it never got that high */
  miss: { along: number; across: number } | null;
  /** its speed arriving at the ladder and leaving it (m/s), the ladder's lean (deg) */
  arrive: number;
  launch: number;
  lean: number;
  rpm: number;
  hot: number;
}

export type Event =
  | { kind: "release" | "launch" | "in" | "burn" | "stall" }
  | { kind: "impact" | "rung" | "rim" | "shaft" | "ground" | "bricks" | "man" | "clip"; hard: number };

/** a small seeded generator, so a test can replay a shot */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const STEP = 1 / 600;

export class Sim {
  phase: Phase = "held";
  /** the lever (0..1), the flywheel and the tyre (rad/s), the tread's temperature (°C) */
  lever = 0;
  fly = (ENGINE.idle * Math.PI) / 30;
  spin = 0;
  hot = HEAT.air;
  burning = false;
  /** where the crank is in its two turns (rad, 0..4π): it fires once in them */
  crank = 0;
  fired = 0;
  /** the tyre: its centre, its velocity, the way it is rolling (rad from +x towards +z), its lean */
  pos: V3 = [YARD.release, YARD.shaft - (TYRE.bead - ENGINE.hubR), 0];
  vel: V3 = [0, 0, 0];
  heading = 0;
  camber = 0;
  /** how far it has turned (rad): for whoever draws it */
  turned = 0;
  /** tread speed over the ground it is on, less its own speed (m/s): dust, smoke, squeal */
  slip = 0;
  /** the ladder, as the man has it: its foot across the yard (m), its lean (rad from the ground) */
  ladder = { z: 0, lean: 1.2 };
  /** along the ladder from its foot (m), while it is on it */
  rung = 0;
  /** the ladder as it was when the tyre took it: fixed from then on */
  private taken: { foot: V3; yaw: number; lean: number } | null = null;
  wind: V3 = [0, 0, 0];
  private gust: V3 = [0, 0, 0];
  private readonly calm: V3;
  readonly events: Event[] = [];
  outcome: Outcome | null = null;
  apex = 0;
  private miss: Outcome["miss"] = null;
  private arrive = 0;
  private launch = 0;
  private rpmAt = 0;
  private hotAt = 0;
  private bounces = 0;
  private rimmed = false;
  private struck: End | null = null;
  private left = 0;
  private readonly rand: () => number;
  private carry = 0;
  /** time since the game began (s) */
  t = 0;

  constructor(seed: number, wind?: V3) {
    this.rand = seeded(seed);
    const dir = this.rand() * Math.PI * 2, speed = 0.3 + 1.7 * this.rand() ** 1.5;
    this.calm = wind ?? [Math.cos(dir) * speed, 0, Math.sin(dir) * speed];
    this.wind = [...this.calm];
  }

  private gauss(): number {
    return Math.sqrt(-2 * Math.log(1 - this.rand())) * Math.cos(2 * Math.PI * this.rand());
  }

  get rpm(): number {
    return (this.fly * 30) / Math.PI;
  }
  /** the tread's speed (m/s) */
  get tread(): number {
    return this.spin * TYRE.r;
  }
  /** how much the rubber still grips: less as it cooks, least alight */
  get grip(): number {
    return this.burning ? 0.72 : 1 - 0.22 * clamp((this.hot - HEAT.smoke) / (HEAT.fire - HEAT.smoke), 0, 1);
  }
  /** the ladder's foot, the way it runs along the ground (it is kept pointed at the chimney) and its top */
  ladderNow(): { foot: V3; yaw: number; lean: number; top: V3 } {
    const l = this.taken ?? { foot: [YARD.ladderX, 0, this.ladder.z] as V3, yaw: Math.atan2(YARD.chimney.z - this.ladder.z, YARD.chimney.x - YARD.ladderX), lean: this.ladder.lean };
    const c = Math.cos(l.lean) * YARD.ladderLen;
    return { ...l, top: [l.foot[0] + Math.cos(l.yaw) * c, Math.sin(l.lean) * YARD.ladderLen, l.foot[2] + Math.sin(l.yaw) * c] };
  }

  /** the tyre is knocked off the shaft: it drops to the ground with the spin it has */
  release(): void {
    if (this.phase !== "held") return;
    this.phase = "ground";
    this.rpmAt = this.rpm;
    this.hotAt = this.hot;
    this.pos = [YARD.release, TYRE.r, 0];
    this.vel = [0, 0, 0];
    // hands are not a jig: it leaves a little off line and a little off upright, more so the faster it spins
    const wild = 0.6 + 0.6 * clamp(this.tread / 60, 0, 1);
    this.heading = this.gauss() * 0.011 * wild;
    this.camber = this.gauss() * 0.014 * wild;
    this.events.push({ kind: "release" });
  }

  /** Advance by dt (the game's frame), in fixed small steps. `lever` is where the hand wants it (0..1). */
  step(dt: number, lever: number): void {
    this.carry += Math.min(dt, 0.1);
    while (this.carry >= STEP) {
      this.carry -= STEP;
      this.tick(STEP, lever);
    }
  }

  private tick(dt: number, lever: number): void {
    this.t += dt;
    this.lever = clamp(lever, 0, 1);
    this.engine(dt);
    // the wind: a steady part and a gust that wanders
    for (const i of [0, 2]) {
      this.gust[i] += (-this.gust[i] / 2.5) * dt + 0.45 * Math.sqrt(dt) * this.gauss();
      this.wind[i] = this.calm[i] + this.gust[i];
    }
    if (this.phase === "held") this.held(dt);
    else if (this.phase === "ground") this.ground(dt);
    else if (this.phase === "ladder") this.climb(dt);
    else if (this.phase === "air") this.fly3(dt);
    if (this.phase !== "held" && this.phase !== "done") {
      this.turned += this.spin * dt;
      this.apex = Math.max(this.apex, this.pos[1]);
      // out in the wind it cools; alight, it stays alight
      if (!this.burning) this.hot += -(this.hot - HEAT.air) * HEAT.cool * dt;
    }
  }

  private engine(dt: number): void {
    const want = ((ENGINE.idle + this.lever * (ENGINE.max - ENGINE.idle)) * Math.PI) / 30;
    let torque = clamp(ENGINE.governor * (want - this.fly), -ENGINE.drag * 3, ENGINE.torque) - ENGINE.drag;
    if (this.phase === "held") {
      // the hub drags the bead towards its own speed, and the bead drags back (all of it reckoned at the tread)
      const dv = this.fly * DRIVE - this.spin * TYRE.r;
      const push = ENGINE.grip * ENGINE.press * Math.tanh(dv / 1.2);
      torque -= push * DRIVE;
      const inertia = TYRE.k * TYRE.m * TYRE.r * TYRE.r;
      this.spin += ((push * TYRE.r - 0.008 * this.spin) / inertia) * dt;
      this.slip = dv;
      this.turned += this.spin * dt;
    }
    this.fly = Math.max(0, this.fly + (torque / ENGINE.inertia) * dt);
    const before = this.crank;
    this.crank = (this.crank + this.fly * dt) % (4 * Math.PI);
    if (this.crank < before) this.fired++;
  }

  private held(dt: number): void {
    // flexing at speed heats the tread, slipping on the rim more so; the air takes it away
    const v = this.tread;
    this.hot += (HEAT.perSpeed * v * v + HEAT.slip * Math.abs(this.slip) * ENGINE.press - (this.hot - HEAT.air)) * HEAT.cool * dt;
    if (!this.burning && this.hot > HEAT.fire) {
      this.burning = true;
      this.events.push({ kind: "burn" });
    }
  }

  private ground(dt: number): void {
    const mu = YARD.dirt * this.grip, r = TYRE.r;
    const f: V3 = [Math.cos(this.heading), 0, Math.sin(this.heading)];
    let v = this.vel[0] * f[0] + this.vel[2] * f[2];
    this.slip = this.spin * r - v;
    if (this.slip > 0.05) {
      v += mu * G * dt;
      this.spin -= ((mu * G) / (TYRE.k * r)) * dt;
    } else {
      v = Math.max(0, v - YARD.rolling * G * dt);
      this.spin = v / r;
    }
    // a leaning tyre turns towards its lean; the lean rights itself slowly; the yard is not flat
    this.heading += ((G * Math.tan(this.camber)) / Math.max(v, 4)) * dt;
    this.camber += (-this.camber / 3.5) * dt + 0.012 * Math.sqrt(dt) * this.gauss();
    this.heading += 0.006 * Math.sqrt(dt) * this.gauss();
    this.vel = [f[0] * v, 0, f[2] * v];
    this.pos = [this.pos[0] + this.vel[0] * dt, r, this.pos[2] + this.vel[2] * dt];
    if (v < 0.3 && this.slip <= 0.05 && this.t > 1) return this.finish("slow");

    // ---- the ladder, the man beside it, and what stands behind them
    const L = this.ladderNow();
    const a: V3 = [Math.cos(L.yaw), 0, Math.sin(L.yaw)], side: V3 = [-a[2], 0, a[0]];
    const rel: V3 = [this.pos[0] - L.foot[0], 0, this.pos[2] - L.foot[2]];
    const along = rel[0] * a[0] + rel[2] * a[2], across = rel[0] * side[0] + rel[2] * side[2];
    if (!this.left && along >= -r * Math.tan(L.lean / 2) && along < 0.6) {
      const off = Math.abs(across), turn = this.heading - L.yaw;
      if (off < YARD.ladderHalf + 0.2 && Math.abs(turn) < 0.5 && v > 1) return this.strike(L, v, across, turn);
      // he stands behind it, holding it up: what goes by close on either side takes his legs
      if (off < 0.85) {
        this.events.push({ kind: "man", hard: v });
        return this.finish("man");
      }
      this.left = 1;
    }
    const st = YARD.stack;
    if (this.pos[0] + r > st.x0 && Math.abs(this.pos[2]) < st.half) {
      this.events.push({ kind: "bricks", hard: v });
      return this.finish("bricks");
    }
    if (this.pos[0] + r > YARD.wall.x) {
      this.events.push({ kind: "bricks", hard: v });
      return this.finish("bricks");
    }
  }

  /** The blow against the ladder: what is left along it, and what the spin adds. */
  private strike(L: { foot: V3; yaw: number; lean: number }, v: number, across: number, turn: number): void {
    this.taken = { foot: L.foot, yaw: L.yaw, lean: L.lean };
    this.arrive = v;
    const r = TYRE.r, th = L.lean;
    // the rails turn it to the ladder's line; what was across them is lost
    const vin = v * Math.cos(turn);
    const blow = vin * Math.sin(th) * (1 + YARD.bounce);
    const toRoll = (this.spin * r - vin * Math.cos(th)) / (1 + 1 / TYRE.k);
    const j = clamp(toRoll, 0, YARD.rungGrip * this.grip * blow);
    let along = vin * Math.cos(th) + j;
    this.spin -= j / (TYRE.k * r);
    // caught by one rail: it gets on, but some of the blow goes into the rail, and it leaves crooked
    const clip = clamp((Math.abs(across) - YARD.ladderHalf * 0.6) / (YARD.ladderHalf * 0.4 + 0.2), 0, 1);
    if (clip > 0) {
      along *= 1 - 0.35 * clip;
      this.taken.yaw += Math.sign(across) * 0.3 * clip;
      this.struck = "clipped";
      this.events.push({ kind: "clip", hard: v });
    }
    this.events.push({ kind: "impact", hard: blow });
    this.phase = "ladder";
    this.rung = r * Math.tan(th / 2);
    this.heading = this.taken.yaw;
    this.camber = 0;
    this.vel = this.along(along);
    this.place();
  }

  private along(v: number): V3 {
    const L = this.taken!;
    return [Math.cos(L.yaw) * Math.cos(L.lean) * v, Math.sin(L.lean) * v, Math.sin(L.yaw) * Math.cos(L.lean) * v];
  }

  private place(): void {
    const L = this.taken!, r = TYRE.r, q = this.rung;
    const h = q * Math.cos(L.lean) - r * Math.sin(L.lean);
    this.pos = [L.foot[0] + Math.cos(L.yaw) * h, q * Math.sin(L.lean) + r * Math.cos(L.lean), L.foot[2] + Math.sin(L.yaw) * h];
  }

  private climb(dt: number): void {
    const L = this.taken!, r = TYRE.r, mu = YARD.rungGrip * this.grip;
    let v = Math.hypot(...this.vel) * Math.sign(this.vel[1] || 1);
    this.slip = this.spin * r - v;
    const rolling = -G * Math.sin(L.lean) / (1 + TYRE.k);
    if (this.slip <= 0.05 && TYRE.k * Math.abs(rolling) <= mu * G * Math.cos(L.lean)) {
      v += rolling * dt;
      this.spin = v / r;
    } else {
      // the tread outruns the climb (or gravity outruns the tread): the rungs push it up as hard as they grip
      v += (mu * G * Math.cos(L.lean) - G * Math.sin(L.lean)) * dt;
      this.spin -= ((mu * G * Math.cos(L.lean)) / (TYRE.k * r)) * dt;
    }
    const before = Math.floor(this.rung / YARD.rungs);
    this.rung += v * dt;
    if (Math.floor(this.rung / YARD.rungs) > before) this.events.push({ kind: "rung", hard: v });
    this.vel = this.along(v);
    this.place();
    if (v <= 0) {
      this.events.push({ kind: "stall" });
      return this.finish("stalled");
    }
    if (this.rung >= YARD.ladderLen) {
      this.launch = v;
      this.phase = "air";
      this.events.push({ kind: "launch" });
    }
  }

  private fly3(dt: number): void {
    const r = TYRE.r, m = TYRE.m;
    const h: V3 = [Math.cos(this.heading), 0, Math.sin(this.heading)], side: V3 = [-h[2], 0, h[0]];
    const rel: V3 = [this.vel[0] - this.wind[0], this.vel[1], this.vel[2] - this.wind[2]];
    const across = rel[0] * side[0] + rel[2] * side[2];
    const inPlane: V3 = [rel[0] - side[0] * across, rel[1], rel[2] - side[2] * across];
    const speed = Math.hypot(...inPlane);
    // drag: edge-on in its own plane, broadside across it
    const kEdge = (0.5 * AIR.rho * AIR.cdEdge * 2 * r * TYRE.wide) / m, kBroad = (0.5 * AIR.rho * AIR.cdBroad * Math.PI * r * r) / m;
    const acc: V3 = [-kEdge * speed * inPlane[0] - kBroad * Math.abs(across) * across * side[0], -G - kEdge * speed * inPlane[1], -kEdge * speed * inPlane[2] - kBroad * Math.abs(across) * across * side[2]];
    // lift: a body spinning as it rolled is pushed along (spin axis) × (its way through the air)
    if (speed > 0.5) {
      const cl = AIR.lift * clamp((this.spin * r) / speed, -1, 1);
      const k = kEdge * (cl / AIR.cdEdge) * speed;
      // the axis is up × heading; (up × h) × v, with v in the tyre's plane
      const fwd = inPlane[0] * h[0] + inPlane[2] * h[2];
      acc[0] += k * inPlane[1] * h[0];
      acc[1] += -k * fwd;
      acc[2] += k * inPlane[1] * h[2];
    }
    this.spin *= 1 - 0.08 * dt;
    const was = this.pos;
    this.vel = [this.vel[0] + acc[0] * dt, this.vel[1] + acc[1] * dt, this.vel[2] + acc[2] * dt];
    this.pos = [was[0] + this.vel[0] * dt, was[1] + this.vel[1] * dt, was[2] + this.vel[2] * dt];

    // ---- the chimney: a tapering shaft, a rim, a mouth
    const c = YARD.chimney;
    const dx = this.pos[0] - c.x, dz = this.pos[2] - c.z, d = Math.hypot(dx, dz);
    if (was[1] >= c.tall && this.pos[1] < c.tall && this.vel[1] < 0) {
      if (!this.miss) this.miss = { along: dx, across: dz };
      if (d < c.mouth - 0.22) {
        this.events.push({ kind: "in" });
        return this.finish("in");
      }
      if (d < c.top + r * 0.8) {
        // on the rim: it jumps, and goes in or out by which side of the brickwork it met
        const inward = d < (c.mouth + c.top) / 2 ? -1 : 1, hard = -this.vel[1];
        this.events.push({ kind: "rim", hard });
        this.rimmed = true;
        this.vel[1] = hard * 0.32;
        const n = d > 1e-6 ? [dx / d, dz / d] : [1, 0];
        const out = this.vel[0] * n[0] + this.vel[2] * n[1];
        this.vel[0] += n[0] * (inward * (1.1 + 0.5 * this.rand()) - 0.6 * out);
        this.vel[2] += n[1] * (inward * (1.1 + 0.5 * this.rand()) - 0.6 * out);
        this.pos[1] = c.tall + 1e-4;
        this.spin *= 0.5;
        return;
      }
    }
    if (this.pos[1] < c.tall && this.pos[1] > 0) {
      const rad = c.base + (c.top - c.base) * (this.pos[1] / c.tall) + r * 0.7;
      if (d < rad && d > 1e-6) {
        const n = [dx / d, dz / d], into = this.vel[0] * n[0] + this.vel[2] * n[1];
        if (into < 0) {
          this.events.push({ kind: "shaft", hard: -into });
          this.vel[0] -= 1.35 * into * n[0];
          this.vel[2] -= 1.35 * into * n[1];
          this.struck ??= "shaft";
        }
        this.pos[0] = c.x + n[0] * rad;
        this.pos[2] = c.z + n[1] * rad;
      }
    }
    // ---- the bricks and the wall behind the ladder, then the ground
    const st = YARD.stack;
    const tops: [number, number, number, number][] = [[st.x0, st.x1, st.top, st.half], [YARD.wall.x, YARD.wall.x + 1.2, YARD.wall.top, 40]];
    for (const [x0, x1, top, half] of tops) {
      if (this.pos[0] > x0 - r && this.pos[0] < x1 + r && Math.abs(this.pos[2]) < half && this.pos[1] < top + r) {
        if (was[1] >= top + r && this.vel[1] < 0) {
          this.pos[1] = top + r;
          this.land();
        } else if (was[0] <= x0 - r && this.vel[0] > 0) {
          this.events.push({ kind: "bricks", hard: this.vel[0] });
          this.vel[0] *= -0.3;
          this.pos[0] = x0 - r;
          this.struck ??= "low";
        }
      }
    }
    if (this.pos[1] < r) {
      this.pos[1] = r;
      this.land();
    }
  }

  private land(): void {
    const hard = -this.vel[1];
    this.events.push({ kind: "ground", hard });
    this.bounces++;
    this.vel = [this.vel[0] * 0.6, hard * 0.4, this.vel[2] * 0.6];
    this.spin *= 0.5;
    if (this.bounces < 3 && hard > 2.5) return;
    const c = YARD.chimney, m = this.miss;
    const kind: End = this.struck ?? (this.rimmed ? "rim" : !m ? (this.apex < c.tall ? "low" : "short") : Math.abs(m.across) > Math.max(c.top, Math.abs(m.along)) ? "wide" : m.along > 0 ? "over" : "short");
    this.finish(kind);
  }

  private finish(kind: End): void {
    if (this.phase === "done") return;
    this.phase = "done";
    this.slip = 0;
    this.outcome = { kind, apex: this.apex, miss: this.miss, arrive: this.arrive, launch: this.launch, lean: ((this.taken?.lean ?? this.ladder.lean) * 180) / Math.PI, rpm: this.rpmAt, hot: this.hotAt };
  }
}

/**
 * One whole shot with nobody at the controls: the lever opened at a rate and held, let go at a
 * tread speed, the ladder where the tyre will come (if `follow`) at a lean. For the tests, and for
 * finding out what the yard allows.
 */
export function shoot(o: { seed: number; tread: number; lean: number; follow?: boolean; z?: number; wind?: V3 }): Outcome {
  const sim = new Sim(o.seed, o.wind);
  sim.ladder.lean = o.lean;
  sim.ladder.z = o.z ?? 0;
  const dt = 1 / 120;
  for (let i = 0; i < 120 * 60 && sim.phase === "held"; i++) {
    sim.step(dt, 1);
    if (sim.tread >= o.tread) sim.release();
  }
  if (sim.phase === "held") sim.release();
  for (let i = 0; i < 120 * 40 && !sim.outcome; i++) {
    if (o.follow && sim.phase === "ground") {
      // a man who never misjudges it: he walks to where it is heading
      const ahead = sim.pos[2] + Math.tan(sim.heading) * (YARD.ladderX - sim.pos[0]);
      sim.ladder.z += clamp(ahead - sim.ladder.z, -3.5 * dt, 3.5 * dt);
      sim.ladder.z = clamp(sim.ladder.z, -YARD.reach, YARD.reach);
    }
    sim.step(dt, 1);
  }
  return sim.outcome ?? { kind: "slow", apex: sim.apex, miss: null, arrive: 0, launch: 0, lean: 0, rpm: 0, hot: 0 };
}
