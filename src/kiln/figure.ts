/**
 * People and their limbs, for the kiln game's yard: a wire figure (or, on a `Beams` that has
 * `solids`, a lit one in cloth and skin) with a trunk, legs that stand, walk, sit or kneel, arms
 * that reach where they are told, hands, shoes and a plain head.
 *
 * This is the figure code of the CHIMERA show stages, gathered into one file for this game.
 */
import { Beams, Poly } from "../ui/render/beams3d.ts";
import { V, mix } from "../ui/colors.ts";

export type V3 = [number, number, number];

/** the world against the real head: the head is the star, so it reads a little large */
export const S = 0.74;
const BODY = V.blue, BRIGHT = mix(V.blue, V.white, 0.45);
export const SKIN = mix(V.white, V.red, 0.3);
export const SHOE = "#2b2622";
const TAU = Math.PI * 2;

// ---- vectors, lines and rings
export const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
export const mixV = (a: V3, b: V3, u: number): V3 => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
export const smooth = (u: number) => {
  const c = Math.max(0, Math.min(1, u));
  return c * c * (3 - 2 * c);
};
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const clamp01 = (u: number) => Math.max(0, Math.min(1, u));
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const poly = new Poly();
export function path(B: Beams, pts: V3[], color: string, width: number, alpha = 1, close = false, hot = false) {
  poly.reset();
  for (const p of pts) poly.p(p[0], p[1], p[2]);
  B.poly(poly, color, width, { alpha, close, hot });
}
export function circle(c: V3, ux: V3, uy: V3, r: number, n = 28): V3[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return add(add(c, ux, Math.cos(a) * r), uy, Math.sin(a) * r);
  });
}

// ---- limbs

export interface Arm { e: V3; w: V3; h: V3; curl: number; point: number }

/** the bend of a two-bone limb from s to w, pushed out towards `hint` */
export function bend(s: V3, w: V3, hint: V3, a: number, b: number): { e: V3; w: V3 } {
  let d = sub(w, s), L = Math.hypot(d[0], d[1], d[2]);
  const max = a + b - 0.4;
  if (L > max) {
    w = add(s, unit(d), max);
    d = sub(w, s);
    L = max;
  }
  const dir = unit(d);
  const along = (a * a - b * b + L * L) / (2 * L);
  const out = Math.sqrt(Math.max(0, a * a - along * along));
  const side = unit(sub(hint, scale(dir, dot(hint, dir))));
  return { e: add(add(s, dir, along), side, out), w };
}

/** a limb's wire tube through its centre points */
export function tube(B: Beams, c: V3[], radius: (i: number) => number, color: (i: number) => string, width: number, sides = 8) {
  const rings = c.map((p, i) => {
    const t = unit(sub(c[Math.min(i + 1, c.length - 1)], c[Math.max(i - 1, 0)]));
    const u = unit(cross(t, Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), v = cross(t, u);
    return circle(p, u, v, radius(i), sides);
  });
  if (B.solids) return B.solids.loft(rings, color);
  rings.forEach((r, i) => path(B, r, color(i), width, 1, true));
  for (let s = 0; s < sides; s++) path(B, rings.map((r) => r[s]), color(0), 0.85, 0.75);
}

/** a trunk's rings: wire hoops with a few lines down them, or cloth over them */
export function hoops(B: Beams, rings: V3[][], color: (i: number) => string, down: string, every = 2) {
  if (B.solids) return B.solids.loft(rings, color);
  rings.forEach((ring, i) => path(B, ring, color(i), 1.05, 0.9, true));
  for (let s = 0; s < rings[0].length; s += every) path(B, rings.map((ring) => ring[s]), down, 0.6, 0.6);
}

export function hand(B: Beams, wrist: V3, a: Arm) {
  const dir = a.h;
  const across = unit(cross(dir, Math.abs(dir[1]) > 0.8 ? [1, 0, 0.3] : [0, -1, 0]));
  const palm = cross(across, dir);
  const base = add(wrist, dir, 8);
  const S = B.solids;
  // solid: the palm a flattened tube, each finger and the thumb a thin one
  const slab = (c: V3, half: number): V3[] => Array.from({ length: 10 }, (_, i) => add(add(c, across, half * Math.cos((i / 10) * Math.PI * 2)), palm, 1.5 * Math.sin((i / 10) * Math.PI * 2)));
  const digit = (pts: V3[], r: number) => tube(B, pts, (i) => r * (1 - 0.08 * i), () => SKIN, 1, 6);
  if (S) S.loft([slab(add(wrist, dir, -1), 3.2), slab(add(wrist, dir, 3), 4.2), slab(base, 4.5)], () => SKIN);
  else path(B, [add(wrist, across, 3.4), add(base, across, 4.4), add(base, across, -4.4), add(wrist, across, -3.4)], SKIN, 1.3, 1, true);
  for (let f = 0; f < 4; f++) {
    let at = add(base, across, 3.3 - f * 2.2);
    const curl = f === 0 ? lerp(a.curl, 0.08, a.point) : a.curl;
    const pts: V3[] = [at];
    let d = dir;
    for (let j = 0; j < 3; j++) {
      d = unit(add(add(d, [0, 0, 0], 0), palm, Math.tan(curl * 0.65)));
      at = add(at, d, f === 0 ? 3.1 + a.point * 0.5 : 2.9);
      pts.push(at);
    }
    if (S) digit(pts, 1.15);
    else path(B, pts, SKIN, 1.3);
  }
  const thumb = add(wrist, across, 4);
  const tp = [thumb, add(add(thumb, dir, 5), across, 3.2), add(add(thumb, dir, 9), add(across, palm, a.curl * 0.6), 2.6)];
  if (S) digit(tp, 1.35);
  else path(B, tp, SKIN, 1.3);
}

/** a shoe as rings from heel to toe, from the point under the ankle on the floor */
export function shoe(at: V3, dir = 1): V3[][] {
  return [[-6.5, 2.4, 3.2], [-4, 5.2, 4.4], [3, 5.4, 4.6], [10, 4, 4.8], [18, 3.2, 4.4], [22.5, 1.6, 2.6]].map(([x, top, half]) => Array.from({ length: 10 }, (_, i): V3 => {
    const a = (i / 10) * Math.PI * 2;
    return [at[0] + dir * x, at[1] + Math.max(0, top * (0.5 + 0.5 * Math.sin(a))), at[2] + half * Math.cos(a)];
  }));
}

// ---- people

/** an arm's target in its owner's frame, from his head's centre: [forward, up, to his right] (cm) */
export interface Reach { w: V3; h: V3; curl: number; point?: number; hint?: V3 }
export interface Pose { R: Reach; L: Reach }
export const mirror = (r: Reach): Reach => ({ ...r, w: [r.w[0], r.w[1], -r.w[2]], h: [r.h[0], r.h[1], -r.h[2]], hint: r.hint && [r.hint[0], r.hint[1], -r.hint[2]] });
export const both = (r: Reach): Pose => ({ R: r, L: mirror(r) });
export const DOWN: Reach = { w: [1, -75, 25], h: [0.15, -0.98, 0], curl: 0.55 };
export const POSES: Record<string, Pose> = {
  down: both(DOWN),
  mic: { R: { w: [22, -15, 3], h: [0.2, 0.95, -0.25], curl: 1.2 }, L: { w: [24, -24, -3], h: [0.2, 0.95, 0.25], curl: 1.2 } },
  micOpen: { R: { w: [24, -34, 40], h: [0.5, 0.1, 0.85], curl: 0.12 }, L: { w: [24, -24, -3], h: [0.2, 0.95, 0.25], curl: 1.2 } },
  chest: { R: { w: [12, -27, 3], h: [0.1, 0.35, -0.93], curl: 0.7 }, L: { w: [24, -24, -3], h: [0.2, 0.95, 0.25], curl: 1.2 } },
  wide: both({ w: [6, -16, 66], h: [0.2, 0.3, 0.93], curl: 0.12 }),
  table: both({ w: [30, -49, 15], h: [0.96, 0, -0.28], curl: 0.45 }),
  tell: { R: { w: [30, -36, 26], h: [0.7, 0.3, 0.65], curl: 0.15 }, L: { w: [30, -49, -15], h: [0.96, 0, 0.28], curl: 0.45 } },
  chin: { R: { w: [14, -14, 4], h: [-0.1, 0.95, -0.3], curl: 0.9 }, L: { w: [30, -49, -15], h: [0.96, 0, 0.28], curl: 0.45 } },
  call: { R: { w: [30, 14, 20], h: [0.75, 0.62, 0.2], curl: 1.2, point: 1 }, L: { w: [10, -62, -24], h: [0.2, -0.95, -0.2], curl: 0.8 } },
  show: both({ w: [26, -30, 46], h: [0.55, 0.2, 0.8], curl: 0.08 }),
  plead: both({ w: [30, -30, 34], h: [0.6, 0.45, 0.65], curl: 0.1 }),
  self: { R: { w: [13, -24, 4], h: [-0.2, 0.3, -0.93], curl: 1.2, point: 1 }, L: { w: [30, -49, -15], h: [0.96, 0, 0.28], curl: 0.45 } },
  nudge: { R: { w: [30, -40, 34], h: [0.3, 0.2, 0.93], curl: 1.2, point: 1 }, L: { w: [30, -49, -15], h: [0.96, 0, 0.28], curl: 0.45 } },
  knees: both({ w: [24, -70, 11], h: [0.95, -0.3, 0], curl: 0.5 }),
  hip: { R: { w: [22, -34, 26], h: [0.6, 0.3, 0.75], curl: 0.15 }, L: { w: [2, -60, -21], h: [0.5, -0.6, 0.6], curl: 0.9, hint: [-0.6, 0, -0.8] } },
  hat: { R: { w: [14, 9, 9], h: [-0.2, 0.9, -0.4], curl: 1 }, L: mirror(DOWN) },
  talk: both({ w: [26, -42, 30], h: [0.6, 0, 0.8], curl: 0.1 }),
  clap: both({ w: [27, -32, 5], h: [0.5, 0.5, -0.7], curl: 0.2 }),
  counter: both({ w: [25, -40, 12], h: [0.95, 0.1, -0.2], curl: 0.6 }),
  sip: { R: { w: [15, -12, 5], h: [-0.2, 0.9, -0.3], curl: 1.1 }, L: { w: [25, -40, -12], h: [0.95, 0.1, 0.2], curl: 0.6 } },
  // flamenco: one arm curved overhead, the other out at the waist, and the other way round
  ole: { R: { w: [4, 26, 10], h: [-0.3, 0.6, -0.75], curl: 0.35, hint: [0, 0, 1] }, L: { w: [14, -34, -40], h: [0.3, 0.1, -0.95], curl: 0.3 } },
  ela: { L: { w: [4, 26, -10], h: [-0.3, 0.6, 0.75], curl: 0.35, hint: [0, 0, -1] }, R: { w: [14, -34, 40], h: [0.3, 0.1, 0.95], curl: 0.3 } },
  arms: { R: { w: [3, 27, 12], h: [-0.2, 0.7, -0.7], curl: 0.3, hint: [0, 0, 1] }, L: { w: [3, 27, -12], h: [-0.2, 0.7, 0.7], curl: 0.3, hint: [0, 0, -1] } },
};

export function mixReach(p: Reach, q: Reach, u: number): Reach {
  return {
    w: mixV(p.w, q.w, u), h: unit(mixV(p.h, q.h, u)), curl: lerp(p.curl, q.curl, u), point: lerp(p.point ?? 0, q.point ?? 0, u),
    hint: p.hint || q.hint ? mixV(p.hint ?? [-0.35, -1, 0.55 * Math.sign(p.w[2] || 1)], q.hint ?? [-0.35, -1, 0.55 * Math.sign(q.w[2] || 1)], u) : undefined,
  };
}

export type Hair = "dreads" | "long" | "bun" | "hat" | "none";
export interface Look {
  shirt: string[];
  /** how far down the upper arm the sleeve comes (0..1) */
  sleeve: number;
  legs: string;
  shoes: string;
  /** the head's centre above the feet, standing (cm), and how broad they are */
  tall: number;
  build: number;
  hair: Hair;
  tone: string;
  skirt?: string;
}
/** where someone is: the head's centre, the way they face (x towards z), their step, how far sat down, their arms */
export interface Body { h: V3; yaw: number; phase: number; gait: number; sit: number; pose: Pose; hit?: number; flare?: number; lean?: number; kneel?: number }
/** how high a head is (cm) on someone kneeling, sat back on his heels */
export const KNEEL = 100;
/** the top of a real head against its centre (head cm): how far up and how far forward */
export interface Crown { up: number; fwd: number }
export interface Drawn { P: (p: V3) => V3; D: (p: V3) => V3; hands: [V3, V3] }

/** how far a seat lowers a head */
const SEAT = 46;
export const headY = (look: Look, sit: number) => look.tall - SEAT * sit;

export function person(B: Beams, look: Look, b: Body, t: number, crown: Crown, dummy: boolean): Drawn {
  const k = look.build;
  const f: V3 = [Math.cos(b.yaw), 0, Math.sin(b.yaw)], r: V3 = [-Math.sin(b.yaw), 0, Math.cos(b.yaw)];
  const P = (p: V3): V3 => [b.h[0] + f[0] * p[0] + r[0] * p[2], b.h[1] + p[1], b.h[2] + f[2] * p[0] + r[2] * p[2]];
  const D = (p: V3): V3 => [f[0] * p[0] + r[0] * p[2], p[1], f[2] * p[0] + r[2] * p[2]];
  const hit = b.hit ?? 0, lean = b.lean ?? 0;
  const spine = -5;
  const fwd = (up: number) => spine + lean * 14 * clamp01((-12 - up) / 62);

  // ---- the trunk, shirt over trousers
  const TRUNK: [number, number, number][] = [[-12, 6.5, 6], [-15, 14.5, 8.5], [-18.5, 21, 10.5], [-27, 21.5, 11.5], [-38, 19.5, 11.5], [-50, 17.2, 10.5], [-61, 17, 10.5], [-73, 18, 11]];
  const n = 16;
  const rings = TRUNK.map(([up, hw, hd]) => Array.from({ length: n }, (_, i): V3 => {
    const a = (i / n) * TAU;
    return P([fwd(up) + Math.sin(a) * hd * k, up, Math.cos(a) * hw * k * (look.skirt && up < -30 ? 0.86 : 1)]);
  }));
  // a lit scene (its Beams has `solids`) gets cloth; a wire one, hoops and a few lines down them
  const F = B.solids;
  if (F) F.loft(rings, (i) => (i >= 6 ? look.legs : look.shirt[i % look.shirt.length]));
  else {
    rings.forEach((ring, i) => path(B, ring, i >= 6 ? look.legs : look.shirt[i % look.shirt.length], i >= 6 ? 0.85 : 1.05, 0.9, true));
    for (let s = 0; s < n; s += 2) {
      path(B, rings.slice(0, 7).map((ring) => ring[s]), look.shirt[0], 0.6, 0.6);
      path(B, rings.slice(6).map((ring) => ring[s]), look.legs, 0.6, 0.6);
    }
  }

  // ---- the legs: a step is a swing of the foot under the hip; sat down, the thighs go forward
  // kneeling: the thighs forward along the ground, the shins folded back under the hips
  const kneel = b.kneel ?? 0;
  const floor = -lerp(headY(look, b.sit), KNEEL, kneel);
  for (const side of [1, -1]) {
    const swing = Math.sin(b.phase) * side, lift = Math.max(0, Math.cos(b.phase) * side);
    const hip: V3 = [fwd(-74), -74, side * 9.5 * k];
    const ankle: V3 = [fwd(-74) + (swing * 27 * b.gait + 42 * b.sit) * (1 - kneel) - 2 * kneel, floor + 8 + lift * 9 * b.gait, side * (10.5 * k + b.sit * 2)];
    const leg = bend(hip, ankle, [1, (0.2 + b.sit) * (1 - kneel), side * 0.1], 46, 46);
    const pts: V3[] = [];
    for (let i = 0; i <= 5; i++) pts.push(P(mixV(hip, leg.e, i / 5)));
    for (let i = 1; i <= 5; i++) pts.push(P(mixV(leg.e, leg.w, i / 5)));
    if (!look.skirt) tube(B, pts, (i) => (8.6 - i * 0.44) * k, () => look.legs, 0.85);
    else tube(B, pts.slice(7), (i) => (4.6 - i * 0.3) * k, () => SKIN, 0.85, 6);
    const y = leg.w[1] - 8, z = leg.w[2], x = leg.w[0];
    if (F) F.loft(shoe([x, y, z]).map((ring) => ring.map(P)), () => look.shoes);
    else {
      path(B, [P([x - 6, y, z - 4.6]), P([x + 19, y, z - 4.4]), P([x + 23, y, z]), P([x + 19, y, z + 4.4]), P([x - 6, y, z + 4.6])], look.shoes, 1.05, 0.9, true);
      path(B, [P([x - 6, y + 9, z]), P([x + 6, y + 10, z]), P([x + 21, y + 3, z])], look.shoes, 1.05, 0.9);
    }
  }

  // ---- a skirt: hoops from the waist that swing out as she turns, a ruffle at the hem
  if (look.skirt) {
    const flare = b.flare ?? 0, hem = floor + 22;
    const m = 26, hoopsN = 7;
    const hoopsAll: V3[][] = [];
    for (let j = 0; j <= hoopsN; j++) {
      const u = j / hoopsN, y = lerp(-52, hem + flare * 26 * u, u);
      const rad = lerp(17, 34 + flare * 46, u ** (1.6 - flare * 0.7)) * k;
      hoopsAll.push(Array.from({ length: m }, (_, i): V3 => {
        const a = (i / m) * TAU - u * flare * 1.1;
        const ruffle = u > 0.7 ? Math.sin(a * 9 + t * 5) * 3.2 * (u - 0.7) * 3.3 : 0;
        return P([fwd(-60) + Math.sin(a) * (rad + ruffle), y + (u > 0.7 ? Math.cos(a * 9 + t * 5) * 1.6 : 0), Math.cos(a) * (rad + ruffle)]);
      }));
    }
    hoopsAll.forEach((ring, j) => path(B, ring, j === hoopsN ? V.pink : look.skirt!, j === hoopsN ? 1.3 : 0.85, 0.9, true, j === hoopsN));
    for (let s = 0; s < m; s += 2) path(B, hoopsAll.map((ring) => ring[s]), look.skirt, 0.6, 0.55);
  }

  // ---- the arms
  const hands: V3[] = [];
  for (const side of [1, -1]) {
    const reach = side > 0 ? b.pose.R : b.pose.L;
    const shoulder: V3 = [spine, -18, side * 19.5 * k];
    let w: V3 = add(reach.w, [3 * hit, -4 * hit, 0]);
    w = add(w, [-Math.sin(b.phase) * side * 14 * b.gait, 0, 0]);
    const arm = bend(shoulder, w, reach.hint ?? [-0.35, -1, side * 0.55], 30, 27);
    const pts: V3[] = [];
    for (let i = 0; i <= 6; i++) pts.push(P(mixV(shoulder, arm.e, i / 6)));
    for (let i = 1; i <= 6; i++) pts.push(P(mixV(arm.e, arm.w, i / 6)));
    const cut = Math.max(1, Math.round(12 * look.sleeve * 0.5 + (look.sleeve >= 1 ? 6 : 0)));
    tube(B, pts.slice(0, cut + 1), (i) => (5.4 - i * 0.12) * k, (i) => look.shirt[i % look.shirt.length], 1.05);
    if (cut < 12) tube(B, pts.slice(cut), (i) => Math.max(2.7, 4.5 * k - i * 0.17), () => SKIN, 0.85);
    const a: Arm = { e: P(arm.e), w: P(arm.w), h: unit(D(reach.h)), curl: reach.curl, point: reach.point ?? 0 };
    hand(B, a.w, a);
    hands.push(add(a.w, a.h, 7));
  }

  // ---- the head, when the real one is on the other screen: a skull, a nose, ears, a neck
  const up = crown.up / S, cf = crown.fwd / S, cm = 1 / S;
  const c: V3 = [cf - 0.6 * cm, up - 11.3 * cm, 0];
  if (dummy && F) {
    // solid: a head of skin, with hair over the top and the back unless a hat or nothing is on it
    const bald = look.hair === "none" || look.hair === "hat";
    F.sheet(11, 16, (i, j) => {
      const v = Math.sin(((i / 10) * 2 - 1) * 1.55), rad = Math.sqrt(1 - v * v), a = (j / 16) * TAU;
      return P([c[0] + Math.sin(a) * 9.7 * cm * rad, c[1] + v * 11.4 * cm, Math.cos(a) * 7.7 * cm * rad]);
    }, (i, j) => (!bald && (i >= 8 || (i >= 4 && Math.sin((j / 16) * TAU) < -0.25)) ? look.tone : SKIN), { wrap: true });
    path(B, [P([c[0] + 9.2 * cm, c[1] + 1.5 * cm, 0]), P([c[0] + 12 * cm, c[1] - 2.6 * cm, 0]), P([c[0] + 9.4 * cm, c[1] - 3.4 * cm, 0])], BRIGHT, 1.05);
    tube(B, [P([c[0] - 2.5 * cm, c[1] - 9 * cm, 0]), P([spine + 1, -12, 0])], () => 5.6 * cm, () => SKIN, 0.85);
  } else if (dummy) {
    for (const v of [-0.82, -0.45, 0, 0.45, 0.82]) {
      const rad = Math.sqrt(1 - v * v);
      path(B, Array.from({ length: 18 }, (_, i): V3 => {
        const a = (i / 18) * TAU;
        return P([c[0] + Math.sin(a) * 9.7 * cm * rad, c[1] + v * 11.4 * cm, Math.cos(a) * 7.7 * cm * rad]);
      }), BODY, 0.85, 0.8, true);
    }
    for (const turn of [0, 1]) {
      path(B, Array.from({ length: 22 }, (_, i): V3 => {
        const a = (i / 22) * TAU;
        return P([c[0] + (turn ? 0 : Math.sin(a) * 9.7 * cm), c[1] + Math.cos(a) * 11.4 * cm, turn ? Math.sin(a) * 7.7 * cm : 0]);
      }), BRIGHT, 1.05, 0.9, true);
    }
    path(B, [P([c[0] + 9.2 * cm, c[1] + 1.5 * cm, 0]), P([c[0] + 12 * cm, c[1] - 2.6 * cm, 0]), P([c[0] + 9.4 * cm, c[1] - 3.4 * cm, 0])], BRIGHT, 1.05);
    for (const side of [1, -1]) {
      path(B, circle(P([c[0] - 1 * cm, c[1] - 0.5 * cm, side * 7.9 * cm]), D([1, 0, 0]), [0, 1, 0], 2.6 * cm, 10), BODY, 0.85, 0.8, true);
      path(B, [P([c[0] + 6.6 * cm, c[1] + 3 * cm, side * 4.6 * cm]), P([c[0] + 7.6 * cm, c[1] + 3 * cm, side * 2.2 * cm])], BRIGHT, 1.05);
    }
    tube(B, [P([c[0] - 2.5 * cm, c[1] - 9 * cm, 0]), P([spine + 1, -12, 0])], () => 5.6 * cm, () => SKIN, 0.85);
  }

  // ---- what is on it
  const around = (az: number, out: number, y: number, sway = 0): V3 => P([c[0] - 1 * cm + Math.cos(az) * 9.9 * cm * out, c[1] + y * cm, Math.sin(az) * 8 * cm * out + sway]);
  if (look.hair === "dreads" || look.hair === "long") {
    // locks from the crown down past the collar, the ones at the sides in front of the shoulders
    const locks = look.hair === "dreads" ? 15 : 13, long = look.hair === "dreads" ? 25 : 31;
    for (let i = 0; i < locks; i++) {
      const az = lerp(0.3, 1.7, i / (locks - 1)) * Math.PI;
      const drop = long * (0.8 + 0.2 * Math.sin(i * 2.4)) * (Math.abs(Math.cos(az)) * 0.3 + 0.7);
      const sway = Math.sin(t * 2.3 + i * 1.7) * 0.8 + (b.pose.R.w[2] > 50 ? Math.sin(t * 6 + i) * 1.2 : 0);
      const pts = [around(az, 0.25, 11.6), around(az, 0.72, 9.4), around(az, 1.04, 3.5, sway * 0.3), around(az, 1.1, -5, sway * 0.6), around(az, 1.06, -5 - drop * 0.5, sway), around(az, 1.0, -5 - drop, sway * 1.5)];
      path(B, pts, look.tone, look.hair === "dreads" ? 1.3 : 0.85, 0.9);
      if (look.hair === "dreads") for (let j = 3; j < 6; j++) path(B, [add(pts[j], [0, 0, 0]), add(pts[j], D([0.9, 0.5, 0.9]))], look.tone, 0.85, 0.7);
    }
    if (look.hair === "long") path(B, Array.from({ length: 9 }, (_, i) => around(lerp(0.26, 1.74, i / 8) * Math.PI - (i > 4 ? 0 : 0), 0.96, 8.6 - Math.abs(i - 4) * 1.5)), look.tone, 1.05, 0.9);
  } else if (look.hair === "bun") {
    for (const y of [5, 8.5, 11.2]) path(B, Array.from({ length: 12 }, (_, i) => around(lerp(0.32, 1.68, i / 11) * Math.PI, Math.sqrt(Math.max(0.05, 1 - (y / 11.6) ** 2)) * 1.03, y)), look.tone, 0.85, 0.9);
    const knot = P([c[0] - 10.5 * cm, c[1] + 4 * cm, 0]);
    for (const rad of [2.2, 3.8]) path(B, circle(knot, D([0, 0, 1]), [0, 1, 0], rad * cm, 10), look.tone, 0.85, 0.9, true);
    const rose = P([c[0] - 4 * cm, c[1] + 7.5 * cm, 7.6 * cm]);
    for (const rad of [1.2, 2.6]) path(B, circle(rose, D([1, 0, 0]), [0, 1, 0], rad * cm, 8), V.pink, 1.05, 1, true, rad > 2);
  } else if (look.hair === "hat") {
    const ring = (y: number, rad: number, n2 = 20) => Array.from({ length: n2 }, (_, i): V3 => {
      const a = (i / n2) * TAU;
      return P([c[0] + Math.cos(a) * 9.9 * cm * rad, c[1] + y * cm + (rad > 1.2 ? Math.cos(a) * -1.2 * cm : 0), Math.sin(a) * 8.4 * cm * rad]);
    });
    const brim = ring(6.2, 1.7), band = ring(6.4, 1.02), top = ring(13.4, 0.9);
    path(B, brim, look.tone, 1.3, 1, true);
    path(B, band, look.tone, 1.05, 0.9, true);
    path(B, ring(8, 1.0), V.amber, 0.85, 0.9, true);
    path(B, top, look.tone, 1.05, 0.9, true);
    for (let i = 0; i < 20; i += 4) path(B, [band[i], top[i]], look.tone, 0.6, 0.7);
    path(B, [top[0], top[10]], look.tone, 0.6, 0.6);
  }
  return { P, D, hands: [hands[0], hands[1]] };
}
