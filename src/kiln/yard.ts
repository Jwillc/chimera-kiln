/**
 * The kiln game's yard, staged as the clip it comes from: a small diesel engine on two timbers,
 * the tyre hung on the end of its shaft; a man kneeling at its left with his hands on it, a man
 * standing by him with a pole (he knocks the tyre off the shaft), a man kneeling at its right who
 * put the tyre there and gets out of its way (his is the screen's real head); a long way down the
 * dirt a ladder with a man behind it, a stack of bricks and the kiln's wall, and the chimney.
 *
 * Nothing is decided here. Each frame the game hands over a `Scene` (the simulation, the camera,
 * what the men are feeling) and this draws it: in wire, or with lit surfaces under the wire.
 *
 * The physics is in metres; this is drawn in centimetres, like the other stages' people.
 * x runs down the yard, y up, z to the right of someone looking down it.
 */
import * as THREE from "three";
import { Beams } from "../ui/render/beams3d.ts";
import { FLESH, HAIR, Solids } from "../ui/render/solids.ts";
import { V, mix } from "../ui/colors.ts";
import type { Anatomy3D } from "../ui/render/anatomy3d.ts";
import type { HeadProp } from "../ui/components/AnatomyView3D.tsx";
import { type Body, type Look, type Pose, type V3, KNEEL, POSES, S, SKIN, add, both, circle, cross, lerp, mixReach, mixV, path, person, smooth, sub, tube, unit } from "./figure.ts";
import { ENGINE, HEAT, TYRE, YARD, type Sim } from "./physics.ts";

export interface Scene {
  /** seconds since the page opened */
  t: number;
  sim: Sim;
  /** the camera (m), and its vertical field of view on a wide screen (deg) */
  eye: V3;
  at: V3;
  fov: number;
  /** the man who put the tyre on: 0 kneeling at it, 1 on his feet and out of its way; how open his mouth is */
  up: number;
  mouth: number;
  mood: "work" | "watch" | "cheer" | "groan";
  /** when the mood began, when the ladder was struck, when the tyre went in, when the ladder's man was hit (-1: not) */
  since: number;
  struck: number;
  /** when the pole was swung at the tyre (-1: not yet) */
  knock: number;
  sunk: number;
  hit: number;
}

const M = 100;
/** how much taller than its wide-screen self the view may grow on an upright screen */
const TALL = 1.75;
const cm = (p: V3): V3 => [p[0] * M, p[1] * M, p[2] * M];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const clamp01 = (u: number) => Math.max(0, Math.min(1, u));
const TAU = Math.PI * 2;

const BODY = V.blue, DIM = V.blueDim, MID = V.blueMid, BRIGHT = mix(V.blue, V.white, 0.45);
const IRON = V.green, WOOD = V.amber, BRICK = mix(V.red, "#000000", 0.25), BRICK_DIM = mix(V.red, "#000000", 0.55);
const PURPLE = mix(V.pink, V.blue, 0.45), PURPLE_DIM = mix(PURPLE, "#000000", 0.4), ORANGE = mix(V.amber, V.red, 0.3), ORANGE_DIM = mix(ORANGE, "#000000", 0.4);
const CREAM = mix(V.white, V.amber, 0.12), CREAM_DIM = mix(CREAM, "#000000", 0.4), PLUM = mix(V.pink, "#000000", 0.2), PLUM_DIM = mix(V.pink, "#000000", 0.55);
/** what each wire colour is when the yard is solid */
const PAINT: [string, string][] = [
  [SKIN, FLESH], [IRON, "#2f6b52"], [WOOD, "#a07a4c"], [BRICK, "#8d4c38"], [BRICK_DIM, "#74402f"], [BRIGHT, "#3a3d42"], [V.white, "#18181a"],
  [PURPLE, "#63408c"], [PURPLE_DIM, "#553678"], [ORANGE, "#c86a22"], [ORANGE_DIM, "#b65d1c"], [CREAM, "#d9d4c6"], [CREAM_DIM, "#cbc5b6"], [PLUM, "#7c3560"], [PLUM_DIM, "#6b2d52"],
  [DIM, "#2a2622"], [MID, "#3b3631"], [BODY, "#4a4e55"],
];
const SMOKE = "#3d3c3b", SOOT = "#161515", DUST = "#a8946f", FLAME = "#ff9a2e", DIRT = "#5c4c36", SPARK = "#ffd27a";

const LOOKS = {
  driver: { shirt: [CREAM, CREAM_DIM], sleeve: 1, legs: CREAM, shoes: MID, tall: 160, build: 0.86, hair: "none", tone: HAIR },
  holder: { shirt: [PURPLE, PURPLE_DIM], sleeve: 1, legs: PURPLE, shoes: MID, tall: 172, build: 0.98, hair: "none", tone: HAIR },
  ladder: { shirt: [ORANGE, ORANGE_DIM], sleeve: 1, legs: ORANGE, shoes: MID, tall: 168, build: 0.95, hair: "none", tone: HAIR },
  watcher: { shirt: [PLUM, PLUM_DIM], sleeve: 1, legs: PLUM, shoes: MID, tall: 176, build: 1.02, hair: "none", tone: HAIR },
  far: { shirt: [CREAM_DIM, CREAM], sleeve: 1, legs: CREAM_DIM, shoes: MID, tall: 170, build: 0.98, hair: "none", tone: HAIR },
} satisfies Record<string, Look>;

/** the end of the engine's shaft, where the tyre hangs; the engine stands to the left of it */
const SHAFT: V3 = [YARD.release, YARD.shaft, 0];
/** where each man is (m): the one who places the tyre, the one at the engine, the one with the pole, one more far off */
const HOLDER = { x: YARD.release + 0.05, z: 0.82 };
const DRIVER: V3 = [YARD.release - 0.55, 0, -1.5];
const POLEMAN: V3 = [YARD.release + 0.45, 0, -2.05];
const FAR: V3 = [YARD.ladderX - 1, 0, -6.8];

const HOLD: Pose = both({ w: [50, -46, 13], h: [0.9, -0.35, 0], curl: 0.8 });
const HANDS_UP: Pose = both({ w: [26, -8, 26], h: [0.3, 0.9, 0.2], curl: 0.15 });
const ENGINE_HANDS: Pose = { R: { w: [52, -10, -10], h: [0.9, 0.1, 0], curl: 1.2 }, L: { w: [50, -24, -30], h: [0.95, -0.2, 0], curl: 0.6 } };
const RAIL: Pose = both({ w: [46, -8, 29], h: [0.35, 0.9, 0], curl: 1.4 });
const POLE_REST: Pose = { R: { w: [30, -42, 12], h: [0.3, 0.9, 0], curl: 1.4 }, L: POSES.down.L };
const POLE_JAB: Pose = { R: { w: [50, -64, 6], h: [0.9, -0.3, 0], curl: 1.4 }, L: { w: [24, -72, -8], h: [0.9, -0.3, 0], curl: 1.4 } };
const SHADE: Pose = { R: { w: [16, 6, 8], h: [-0.2, 0.5, -0.8], curl: 0.2 }, L: POSES.down.L };
const HEAD_HANDS: Pose = both({ w: [10, 4, 14], h: [-0.2, 0.9, -0.3], curl: 0.3 });

/** something small in the air: smoke and dust that drift and swell, or (`heavy`) dirt and sparks that fall */
interface Puff { p: V3; v: V3; born: number; life: number; size: number; grow: number; color: string; heavy?: boolean }

export class Yard {
  readonly side = 1 as const;
  private readonly world = new THREE.Group();
  private readonly fixed = new Beams({ fog: false });
  private readonly live = new Beams({ fog: false });
  private readonly land = new Solids();
  private readonly flesh = new Solids();
  private readonly sky: THREE.Mesh;
  private readonly sun = new THREE.DirectionalLight(new THREE.Color().setRGB(1, 0.93, 0.8), 2.9);
  private readonly ambient = new THREE.AmbientLight(new THREE.Color().setRGB(0.72, 0.8, 0.95), 1.15);
  /** skin, cloth, brick and dirt under the wires, lit by a low sun; off, the yard is wire alone */
  solid = false;
  private built = false;
  private host: Anatomy3D | null = null;
  private head = new THREE.Vector3();
  private crown = { up: 13, fwd: 0 };
  private readonly v = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private w = 1;
  private h = 1;
  private scene: Scene | null = null;
  private puffs: Puff[] = [];
  private trail: V3[] = [];
  private last = 0;
  private wasIn = false;
  /** the yard's own clock, what the tyre has left on the ground, and what has been seen of the ladder */
  private clock = 0;
  private track: V3[] = [];
  private rungSeen = -1;
  private struckSeen = -1;
  private yawNow = -Math.PI / 2;
  private seed = 1;

  constructor(private readonly tick: () => Scene) {
    const geo = new THREE.SphereGeometry(60000, 24, 12);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.36, 0.43, 0.5), side: THREE.BackSide, depthWrite: false });
    mat.fog = false;
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.renderOrder = -1;
    for (const [wire, paint] of PAINT) {
      this.land.paint.set(wire, paint);
      this.flesh.paint.set(wire, paint);
    }
  }

  attach(r: Anatomy3D, head: THREE.Vector3, top: THREE.Vector3) {
    this.host = r;
    this.head.copy(head);
    this.crown = { up: top.y - head.y, fwd: top.x - head.x };
    this.sun.position.set(-2600, 3400, -1900);
    this.sun.target.position.set(1500, 0, 0);
    this.world.add(this.fixed.group, this.live.group, this.land.group, this.flesh.group, this.sky, this.sun, this.sun.target, this.ambient);
    this.world.scale.setScalar(S);
    r.scene.add(this.world);
    if (!this.built) {
      this.built = true;
      this.fixed.solids = this.land;
      this.fixed.begin();
      this.land.begin();
      this.build(this.fixed, this.land);
      this.fixed.end();
      this.land.end();
      this.fixed.solids = null;
    }
  }

  update(_r: Anatomy3D, w: number, h: number) {
    this.w = w;
    this.h = h;
    for (const b of [this.fixed, this.live]) b.setResolution(w, h);
    this.scene = this.tick();
  }

  dispose() {
    if (this.host) {
      this.host.lean = 0;
      this.host.solid = false;
    }
    this.host = null;
    this.world.removeFromParent();
    for (const b of [this.fixed, this.live]) b.dispose();
    for (const s of [this.land, this.flesh]) s.dispose();
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    for (const l of [this.sun, this.ambient]) l.dispose();
  }

  readonly prop: HeadProp = {
    shot: () => null,
    update: (r) => this.scene && this.frame(r, this.scene),
    dispose: () => {},
  };

  /** a point of the yard (m) on the screen (CSS px), or null behind the camera */
  screen(p: V3): [number, number] | null {
    const r = this.host;
    if (!r) return null;
    this.world.localToWorld(this.v.set(p[0] * M, p[1] * M, p[2] * M)).project(r.camera);
    if (this.v.z > 1 || this.v.z < -1) return null;
    return [((this.v.x + 1) / 2) * this.w, ((1 - this.v.y) / 2) * this.h];
  }

  // ---------------------------------------------------------------- what never moves

  private build(B: Beams, F: Solids) {
    const line = (a: V3, b: V3, color: string, width: number, alpha = 1) => path(B, [cm(a), cm(b)], color, width, alpha);
    /** a block: lit faces, and its edges in wire */
    const block = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: string, width = 1.05, alpha = 0.85) => {
      F.box(x0 * M, x1 * M, y0 * M, y1 * M, z0 * M, z1 * M, color);
      for (const y of [y0, y1]) path(B, [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]].map((p) => cm(p as V3)), color, width, alpha, true);
      for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) line([x, y0, z], [x, y1, z], color, width, alpha);
    };
    // ---- the yard: dirt, scored by the wheels that have crossed it
    F.quad([-6000, -1, -9000], [9000, -1, -9000], [9000, -1, 9000], [-6000, -1, 9000], "#96825f");
    for (let x = -8; x <= 44; x += 4) line([x, 0, -14], [x, 0, 14], DIM, 0.6, x % 8 ? 0.22 : 0.4);
    for (let z = -14; z <= 14; z += 4) line([-8, 0, z], [44, 0, z], DIM, 0.6, 0.3);
    for (const z of [-0.5, 0.35, 0.9]) path(B, Array.from({ length: 14 }, (_, i): V3 => cm([2 + i * 1.8, 0.01, z + 0.25 * Math.sin(i * 1.3 + z * 4)])), DIM, 0.6, 0.5);

    // ---- the engine: two timbers across the yard, a crankcase with its head and tank, an exhaust.
    //      The tyre hangs on the right-hand end of its shaft; the flywheel, the hub and the lever are drawn live
    const sx = SHAFT[0], sy = SHAFT[1];
    for (const x of [sx - 0.24, sx + 0.24]) block(x - 0.09, x + 0.09, 0, 0.13, -1.75, 1.25, WOOD);
    block(sx - 0.3, sx + 0.3, 0.13, 0.8, -0.95, -0.32, IRON, 1.3, 1);
    block(sx - 0.2, sx + 0.2, 0.8, 1.0, -0.86, -0.46, IRON, 1.05, 0.9);
    block(sx - 0.52, sx - 0.3, 0.42, 0.72, -0.86, -0.46, IRON, 1.05, 0.9);
    for (let i = 0; i < 4; i++) path(B, [[sx - 0.2, 0.84 + i * 0.045, -0.46], [sx + 0.2, 0.84 + i * 0.045, -0.46], [sx + 0.2, 0.84 + i * 0.045, -0.86]].map((p) => cm(p as V3)), IRON, 0.85, 0.7);
    // the exhaust comes out low on the far side and points away to the left, out of the camera's line down the yard
    path(B, [[sx + 0.3, 0.6, -0.7], [sx + 0.44, 0.6, -0.7], [sx + 0.44, 0.6, -1.1]].map((p) => cm(p as V3)), BRIGHT, 1.3, 0.9);
    path(B, circle(cm([sx + 0.44, 0.6, -1.1]), [1, 0, 0], [0, 1, 0], 4, 10), BRIGHT, 1.05, 0.9, true);
    line([sx, sy, -0.32], [sx, sy, 0.24], BRIGHT, 1.6, 1);
    // the tyres still to go, on the ground to the right, and rags by them
    for (const [x, z] of [[sx + 1.7, 1.7], [sx + 2.1, 2.2]]) for (const y of [0.02, 0.19]) for (const rad of [TYRE.r, TYRE.r * 0.6]) path(B, circle(cm([x, y, z]), [1, 0, 0], [0, 0, 1], rad * M, 20), MID, 0.85, 0.7, true);
    F.loft([circle(cm([sx + 1.7, 0.02, 1.7]), [1, 0, 0], [0, 0, 1], TYRE.r * M, 14), circle(cm([sx + 1.7, 0.2, 1.7]), [1, 0, 0], [0, 0, 1], TYRE.r * M, 14)], () => V.white);

    // ---- the bricks behind the ladder: a stack, some loose, the kiln's wall and its earth
    const st = YARD.stack;
    block(st.x0, st.x1, 0, st.top, -st.half, st.half, BRICK, 1.3, 0.95);
    for (let y = 0.25; y < st.top; y += 0.25) line([st.x0, y, -st.half], [st.x0, y, st.half], BRICK_DIM, 0.6, 0.6);
    for (let z = -st.half; z < st.half; z += 0.5) line([st.x0, 0, z], [st.x0, st.top, z], BRICK_DIM, 0.6, 0.35);
    block(YARD.wall.x, YARD.wall.x + 1.2, 0, YARD.wall.top, -22, 22, BRICK_DIM, 1.05, 0.8);
    for (let y = 0.4; y < YARD.wall.top; y += 0.4) line([YARD.wall.x, y, -22], [YARD.wall.x, y, 22], BRICK_DIM, 0.6, 0.5);
    for (const [x, z, n] of [[22.5, -7.5, 4], [24, 8.2, 3], [19, 10.5, 5], [27, -9.5, 6]]) for (let i = 0; i < n; i++) block(x, x + 1.1, i * 0.22, (i + 1) * 0.22, z + i * 0.06, z + 0.55 + i * 0.06, BRICK, 0.85, 0.7);

    // ---- the chimney: brick, tapering, banded; its mouth is black
    const c = YARD.chimney, n = 24;
    const ringAt = (y: number, rad: number): V3[] => Array.from({ length: n }, (_, i) => cm([c.x + Math.cos((i / n) * TAU) * rad, y, c.z + Math.sin((i / n) * TAU) * rad]));
    const radAt = (y: number) => lerp(c.base, c.top, y / c.tall);
    const rings: V3[][] = [];
    for (let y = 0; y <= c.tall + 1e-6; y += 1) rings.push(ringAt(y, radAt(y)));
    F.loft(rings, (i) => (i % 4 === 3 ? BRICK_DIM : BRICK), [false, false]);
    rings.forEach((ring, i) => path(B, ring, i === rings.length - 1 ? V.white : i % 2 ? BRICK_DIM : BRICK, i === rings.length - 1 ? 1.6 : 0.85, i === rings.length - 1 ? 1 : 0.7, true));
    for (let i = 0; i < n; i += 2) path(B, rings.map((ring) => ring[i]), BRICK, 0.85, 0.6);
    const lip = ringAt(c.tall, c.top), mouth = ringAt(c.tall, c.mouth), throat = ringAt(c.tall - 1.6, c.mouth * 0.96);
    F.loft([lip, mouth], () => BRICK_DIM, [false, false]);
    F.loft([mouth, throat], () => DIM, [false, true]);
    path(B, mouth, V.white, 1.05, 0.9, true);
    for (const band of [4.5, 9.5, 13.2]) path(B, ringAt(band, radAt(band) + 0.04), BRIGHT, 1.3, 0.9, true);

    // ---- far off: a tree past the kiln, and the edge of the yard
    const tree: V3 = [47, 0, 9];
    path(B, [cm(tree), cm([47, 4, 9])], MID, 1.05, 0.7);
    for (let i = 0; i < 7; i++) path(B, circle(cm([47 + Math.sin(i * 2.4) * 1.3, 4.6 + (i % 3) * 0.9, 9 + Math.cos(i * 1.7) * 1.3]), [1, 0, 0], [0, 1, 0], 130 + (i % 2) * 40, 9), V.green, 0.6, 0.4, true);
    F.loft([circle(cm([47, 3.6, 9]), [1, 0, 0], [0, 0, 1], 60, 8), circle(cm([47, 5.2, 9]), [1, 0, 0], [0, 0, 1], 260, 8), circle(cm([47, 7.2, 9]), [1, 0, 0], [0, 0, 1], 60, 8)], () => "#3f5f3a");
    F.loft([circle(cm(tree), [1, 0, 0], [0, 0, 1], 22, 6), circle(cm([47, 4, 9]), [1, 0, 0], [0, 0, 1], 16, 6)], () => "#4a3a2c");
  }

  // ---------------------------------------------------------------- one frame

  private frame(r: Anatomy3D, sc: Scene) {
    const t = sc.t, sim = sc.sim, dt = Math.min(0.05, Math.max(0, t - this.last));
    this.last = t;
    const rand = () => {
      this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
      return this.seed / 4294967296;
    };
    const dy = dt, yt = (this.clock += dy);

    // ---- the man who placed the tyre carries the real head: the yard is moved so that it sits on his neck.
    //      He kneels at the tyre, then gets up and out to the right, clear of the tyre and of the camera's line
    const look = LOOKS.holder;
    const away = smooth(clamp01(sc.up));
    const bob = sc.mood === "cheer" ? Math.abs(Math.sin((t - sc.since) * 9)) * 9 : 0;
    const yawGoal = sc.up > 0.5 ? (sc.mood === "work" ? -0.9 : 0) : -Math.PI / 2;
    this.yawNow += (yawGoal - this.yawNow) * Math.min(1, dt * 5);
    const head: V3 = [lerp(HOLDER.x, HOLDER.x - 0.4, away) * M, lerp(KNEEL, look.tall, away) + bob, lerp(HOLDER.z, 2.9, away) * M];
    const yaw = this.yawNow;
    this.world.rotation.y = yaw;
    this.v.set(head[0] * S, head[1] * S, head[2] * S).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    this.world.position.copy(this.head).sub(this.v);
    this.world.updateMatrixWorld(true);
    const aloft = sim.phase === "air" ? Math.atan2(sim.pos[1] - 1.6, Math.max(4, sim.pos[0] - HOLDER.x)) : sc.mood === "cheer" ? 0.25 : sc.mood === "groan" ? -0.3 : 0;
    r.lean += (aloft * 0.8 - r.lean) * Math.min(1, dt * 6);

    // ---- wire, or wire over lit surfaces
    const F = this.solid ? this.flesh : null;
    r.solid = this.solid;
    for (const o of [this.land.group, this.flesh.group, this.sky, this.sun, this.ambient]) o.visible = this.solid;
    for (const b of [this.fixed, this.live]) b.depth = this.solid;
    const B = this.live;
    B.solids = F;
    F?.begin();
    B.begin();
    const line = (a: V3, b: V3, color: string, width: number, alpha = 1) => path(B, [cm(a), cm(b)], color, width, alpha);

    // ---- the camera's own axes, for what always faces it
    const cf = unit(sub(sc.at, sc.eye)), cr = unit(cross(cf, [0, 1, 0])), cu = cross(cr, cf);

    // ---- the engine's moving parts: the flywheel on the shaft, the hub at its end, the lever
    const turn = sim.crank, sx = SHAFT[0], sy = SHAFT[1];
    const disc = (z: number, rad: number, n = 22) => circle(cm([sx, sy, z]), [1, 0, 0], [0, 1, 0], rad * M, n);
    if (F) {
      F.loft([disc(-0.3, ENGINE.flyR), disc(-0.19, ENGINE.flyR)], () => BRIGHT);
      F.loft([disc(-0.19, ENGINE.hubR), disc(0.2, ENGINE.hubR)], () => IRON);
    }
    for (const z of [-0.3, -0.19]) path(B, disc(z, ENGINE.flyR, 24), BRIGHT, 1.6, 1, true);
    for (const z of [-0.19, 0.2]) path(B, disc(z, ENGINE.hubR, 14), IRON, 1.3, 1, true);
    for (let i = 0; i < 6; i++) {
      const a = -turn + (i / 6) * TAU;
      line([sx, sy, -0.188], [sx + Math.cos(a) * ENGINE.flyR, sy + Math.sin(a) * ENGINE.flyR, -0.188], i ? MID : V.white, i ? 0.85 : 1.3, 0.9);
      if (i % 2 === 0) line([sx, sy, 0.202], [sx + Math.cos(a) * ENGINE.hubR, sy + Math.sin(a) * ENGINE.hubR, 0.202], V.white, 0.85, 0.9);
    }
    const pivot: V3 = [sx - 0.3, 0.8, -0.9], la = lerp(-0.7, 0.9, sim.lever);
    const knob: V3 = [pivot[0] - 0.04, pivot[1] + Math.cos(la) * 0.3, pivot[2] + Math.sin(la) * 0.3];
    line(pivot, knob, V.white, 1.6, 1);
    path(B, circle(cm(knob), [0, 0, 1], [0, 1, 0], 3.2, 8), V.red, 1.3, 1, true, true);
    // each firing puts a ring of smoke up the pipe
    const pipe: V3 = [sx + 0.44, 0.6, -1.14];
    if (sim.fired !== this.firedSeen) {
      this.firedSeen = sim.fired;
      this.puffs.push({ p: pipe, v: [0.4, 0.5, -(2 + 2 * sim.lever)], born: yt, life: 0.55, size: 0.05, grow: 0.5, color: SMOKE });
    }

    // ---- the tyre
    // in the air it is seen from behind, edge on: it is drawn with the wobble a thrown wheel has
    const pos = sim.pos, heading = sim.heading + (sim.phase === "air" ? 0.55 * Math.sin(sim.turned * 0.021) : 0);
    const fwd: V3 = [Math.cos(heading), 0, Math.sin(heading)];
    const axle = unit(add([-fwd[2], 0, fwd[0]], [0, 1, 0], -Math.sin(sim.camber)));
    const upT = unit(cross(axle, fwd));
    const hotness = clamp01((sim.hot - HEAT.smoke) / (HEAT.fire - HEAT.smoke));
    const rubber = sim.burning ? V.amber : hotness > 0 ? mix(V.white, V.amber, hotness) : V.white;
    const gone = sim.outcome?.kind === "in";
    if (!gone) {
      const at = (ang: number, rad: number, off: number): V3 => cm(add(add(add(pos, fwd, Math.cos(ang) * rad), upT, Math.sin(ang) * rad), axle, off));
      const half = TYRE.wide / 2, inner = TYRE.r * 0.6;
      if (F) {
        const prof: [number, number][] = [[inner, -half], [TYRE.r * 0.93, -half], [TYRE.r, -half * 0.55], [TYRE.r, half * 0.55], [TYRE.r * 0.93, half], [inner, half]];
        F.sheet(21, prof.length, (i, j) => at((i / 20) * TAU, prof[j][0], prof[j][1]), () => V.white, { wrap: true });
      }
      for (const off of [-half, half]) {
        path(B, Array.from({ length: 24 }, (_, i) => at((i / 24) * TAU, TYRE.r, off * 0.6)), rubber, 1.6, 1, true, !F);
        path(B, Array.from({ length: 18 }, (_, i) => at((i / 18) * TAU, inner, off)), F ? MID : rubber, 1.05, 0.8, true);
      }
      // its tread: marks that turn with it (at speed they are a blur, so fewer of them show)
      const marks = Math.abs(sim.spin) > 60 ? 3 : 9;
      for (let i = 0; i < marks; i++) {
        const a = -sim.turned + (i / marks) * TAU;
        path(B, [at(a, TYRE.r, -half * 0.6), at(a, TYRE.r, half * 0.6)], rubber, 1.05, 0.9);
        if (i % 3 === 0) path(B, [at(a, inner, half), at(a, TYRE.r * 0.93, half)], F ? V.white : MID, 0.85, 0.7);
      }
    }
    // smoke off hot rubber, flame off burning rubber, dust off the ground it claws
    const speed = Math.hypot(...sim.vel);
    if (!gone && hotness > 0 && rand() < dy * (10 + 40 * hotness)) this.puffs.push({ p: add(pos, [0, TYRE.r * 0.8, 0]), v: [sim.vel[0] * 0.3 + (rand() - 0.5), 1.2 + rand(), sim.vel[2] * 0.3 + (rand() - 0.5)], born: yt, life: 1.1, size: 0.1, grow: 0.7, color: sim.burning ? SOOT : SMOKE });
    if (!gone && sim.burning) {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU + t * 3, flick = 0.25 + 0.3 * Math.abs(Math.sin(t * 23 + i * 2.1));
        const root = add(add(pos, fwd, Math.cos(a) * TYRE.r), upT, Math.sin(a) * TYRE.r);
        const tip = add(add(root, [0, flick, 0]), unit(add(sim.vel, [0, 0.001, 0])), -Math.min(1.2, speed * 0.06));
        path(B, [cm(root), cm(mixV(root, tip, 0.5)), cm(tip)], i % 2 ? V.red : FLAME, 1.6, 0.95, false, true);
      }
    }
    const running = sim.phase === "ground" || sim.phase === "ladder";
    if (running && sim.slip > 1.5) {
      // dust, kept low and short-lived: the camera looks down the yard over it, from behind the engine
      for (let n = dy * (40 + 10 * sim.slip) + rand(); n >= 1; n--) {
        const back = -(0.5 + rand()) * Math.min(9, sim.slip * 0.3);
        this.puffs.push({ p: add(pos, [0, -TYRE.r * 0.9, (rand() - 0.5) * 0.2]), v: [fwd[0] * back, 0.25 + 0.7 * rand(), fwd[2] * back + (rand() - 0.5)], born: yt, life: 0.6 + rand() * 0.5, size: 0.09, grow: 0.8, color: DUST });
      }
      // and the dirt itself, thrown back and up off the tread in a tail
      for (let n = dy * (18 + 4 * sim.slip) + rand(); n >= 1; n--) {
        const out = 2 + 6 * rand() * Math.min(1, sim.slip / 20);
        this.puffs.push({ p: add(pos, [-fwd[0] * 0.2, -TYRE.r * 0.8, (rand() - 0.5) * 0.15]), v: [sim.vel[0] * 0.5 - fwd[0] * out, 1.5 + 4.5 * rand(), sim.vel[2] * 0.5 - fwd[2] * out + (rand() - 0.5) * 2.4], born: yt, life: 0.9, size: 0.028, grow: 0, color: DIRT, heavy: true });
      }
    }
    // the groove it leaves in the yard
    if (sim.phase === "held") this.track = [];
    else if (sim.phase === "ground" && (!this.track.length || Math.hypot(...sub(pos, this.track[this.track.length - 1])) > 0.4)) this.track.push([pos[0], 0.012, pos[2]]);
    for (let i = 1; i < this.track.length; i++) {
      const a = this.track[i - 1], b = this.track[i];
      if (F) {
        const w = scale(unit(cross(sub(b, a), [0, 1, 0])), 0.07);
        F.quad(cm(add(a, w)), cm(add(b, w)), cm(sub(b, w)), cm(sub(a, w)), DIRT);
      } else line(a, b, V.amber, 0.85, 0.35);
    }
    // on the ground, seen from behind, speed is the wake it cuts: two lines opening back from it, longer the faster it goes
    if (!gone && sim.phase === "ground" && speed > 3) {
      const left: V3 = [-fwd[2], 0, fwd[0]], long = 0.22 * speed;
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const open = 0.16 + 0.07 * i + 0.03 * rand();
          const from = add([pos[0], 0.03, pos[2]], left, s * 0.1), to = add(add(from, fwd, -long * (1 - 0.2 * i)), left, s * long * open);
          line(from, to, i ? V.amber : V.white, i ? 0.85 : 1.3, (i ? 0.35 : 0.8) * Math.min(1, speed / 10));
        }
      }
    }
    // off the ground: lines of speed behind it, longer the faster it goes
    if (!gone && (sim.phase === "ladder" || sim.phase === "air") && speed > 5) {
      const dir = unit(sim.vel), n = 5 + Math.round(speed / 4);
      for (let i = 0; i < n; i++) {
        const from = add(add(add(pos, dir, -(TYRE.r + 0.1 + 0.5 * rand())), upT, (rand() - 0.5) * 2 * TYRE.r), axle, (rand() - 0.5) * 0.3);
        line(from, add(from, dir, -speed * (0.03 + 0.07 * rand())), i % 3 ? V.white : rubber, i % 3 ? 0.85 : 1.3, 0.25 + 0.5 * rand());
      }
    }
    // at the ladder: the blow throws the yard up at its foot, and each rung takes rubber off the tread
    if (sc.struck >= 0 && sc.struck !== this.struckSeen) {
      this.struckSeen = sc.struck;
      for (let i = 0; i < 46; i++) {
        const a = rand() * TAU, out = 1.5 + 5 * rand(), dirt = i % 3 > 0;
        this.puffs.push({ p: add(pos, [0, -TYRE.r * 0.7, 0]), v: [Math.cos(a) * out - fwd[0] * 2, dirt ? 2 + 6 * rand() : 0.5 + 1.5 * rand(), Math.sin(a) * out], born: yt, life: dirt ? 1.1 : 0.9 + rand() * 0.6, size: dirt ? 0.04 : 0.14, grow: dirt ? 0 : 1, color: dirt ? DIRT : DUST, heavy: dirt });
      }
    }
    const onRung = sim.phase === "ladder" ? Math.floor(sim.rung / YARD.rungs) : -1;
    if (onRung !== this.rungSeen) {
      this.rungSeen = onRung;
      if (onRung >= 0) {
        for (let i = 0; i < 7; i++) this.puffs.push({ p: add(pos, [0, -TYRE.r * 0.5, (rand() - 0.5) * 0.3]), v: [-fwd[0] * (3 + 5 * rand()) + (rand() - 0.5) * 2, 1 + 4 * rand(), -fwd[2] * (3 + 5 * rand()) + (rand() - 0.5) * 4], born: yt, life: 0.5 + 0.3 * rand(), size: 0.025, grow: 0, color: SPARK, heavy: true });
        this.puffs.push({ p: add(pos, [-fwd[0] * 0.2, 0, 0]), v: [-fwd[0] * 2, 1, (rand() - 0.5) * 1.5], born: yt, life: 0.7, size: 0.1, grow: 0.9, color: SMOKE });
      }
    }
    // where it has been through the air
    if (sim.phase === "air") {
      if (!this.trail.length || Math.hypot(...sub(pos, this.trail[this.trail.length - 1])) > 0.25) this.trail.push([...pos]);
    } else if (sim.phase === "held") this.trail = [];
    for (let i = 1; i < this.trail.length; i++) {
      const fresh = i / this.trail.length;
      line(this.trail[i - 1], this.trail[i], sim.burning ? FLAME : V.white, fresh > 0.8 && sim.phase === "air" ? 1.6 : 1.05, 0.25 + 0.6 * fresh);
    }

    // ---- the ladder, and how it rings when it is struck
    const L = sim.ladderNow();
    const along: V3 = [Math.cos(L.yaw), 0, Math.sin(L.yaw)], side: V3 = [-along[2], 0, along[0]];
    const ring = sc.struck >= 0 ? Math.exp(-(t - sc.struck) * 3.5) * Math.sin((t - sc.struck) * 46) * 0.07 : 0;
    const up: V3 = unit([along[0] * Math.cos(L.lean), Math.sin(L.lean), along[2] * Math.cos(L.lean)]);
    // it rings along its length, and bows away under the tyre where the tyre is
    const backOf = cross(up, side), push = backOf[0] * along[0] + backOf[2] * along[2] > 0 ? 1 : -1;
    const bow = (q: number) => (sim.phase === "ladder" ? 0.13 * push * Math.exp(-(((q - sim.rung) / 0.7) ** 2)) : 0);
    const onRail = (q: number, s: number): V3 => add(add(add(L.foot, up, q), side, s * YARD.ladderHalf), backOf, ring * Math.sin((q / YARD.ladderLen) * Math.PI) + bow(q));
    for (const s of [-1, 1]) {
      const rail = Array.from({ length: 9 }, (_, i) => cm(onRail((i / 8) * YARD.ladderLen, s)));
      if (F) tube(B, rail, () => 3.2, () => WOOD, 1, 6);
      path(B, rail, WOOD, 1.6, 1);
    }
    for (let q = 0.25; q < YARD.ladderLen; q += YARD.rungs) line(onRail(q, -1), onRail(q, 1), WOOD, 1.3, 0.95);

    // ---- the men
    const at = (h: V3, yawOf: number, o: Partial<Body> & { pose: Pose }): Body => ({ h, yaw: yawOf, phase: 0, gait: 0, sit: 0, ...o });
    const cheer = (since: number, who: number): Pose => {
      const beat = Math.sin((t - since) * 8 + who * 1.7);
      return { R: mixReach(POSES.arms.R, POSES.wide.R, 0.5 + 0.5 * beat), L: mixReach(POSES.arms.L, POSES.wide.L, 0.5 - 0.5 * beat) };
    };
    const jump = (since: number, who: number) => Math.abs(Math.sin((t - since) * 9 + who)) * 10;
    const mood = sc.mood, over = mood === "cheer" || mood === "groan";
    // the one who put the tyre on: kneeling with both hands on it, hands off and up as he rises, then watching
    const rising = Math.sin(clamp01(sc.up) * Math.PI);
    const calm: Pose = { R: mixReach(HOLD.R, mood === "watch" ? SHADE.R : POSES.down.R, away), L: mixReach(HOLD.L, POSES.down.L, away) };
    const holdPose: Pose = mood === "cheer" ? cheer(sc.since, 0) : mood === "groan" ? HEAD_HANDS : { R: mixReach(calm.R, HANDS_UP.R, rising), L: mixReach(calm.L, HANDS_UP.L, rising) };
    person(B, look, at(head, yaw, { kneel: 1 - away, pose: holdPose }), t, this.crown, false);
    // the one at the engine: small, kneeling at its left, both hands on it
    const dl = LOOKS.driver;
    person(B, dl, at([DRIVER[0] * M, (over ? dl.tall : KNEEL - 6) + (mood === "cheer" ? jump(sc.since, 1) : 0), DRIVER[2] * M], over ? 0.2 : Math.PI / 2 - 0.3, { kneel: over ? 0 : 1, lean: over ? 0 : 0.5, pose: mood === "cheer" ? cheer(sc.since, 1) : mood === "groan" ? POSES.hip : ENGINE_HANDS }), t, this.crown, true);
    // the one with the pole, standing by him: he swings it across and knocks the tyre off the shaft's end
    const pl = LOOKS.watcher;
    const jab = sc.knock < 0 ? 0 : smooth(clamp01((t - sc.knock) / 0.18)) * (1 - smooth(clamp01((t - sc.knock - 0.5) / 0.6)));
    const toTyre = Math.atan2(-POLEMAN[2], SHAFT[0] - POLEMAN[0]);
    const pd = person(B, pl, at([POLEMAN[0] * M, pl.tall + (mood === "cheer" ? jump(sc.since, 2) : 0), POLEMAN[2] * M], lerp(toTyre, 0.35, sim.phase === "held" ? 0 : smooth(clamp01((t - sc.knock - 0.6) / 0.5))), {
      pose: mood === "cheer" ? cheer(sc.since, 2) : { R: mixReach(POLE_REST.R, POLE_JAB.R, jab), L: mixReach(POLE_REST.L, POLE_JAB.L, jab) }, lean: 0.5 * jab,
    }), t, this.crown, true);
    if (mood !== "cheer") {
      // planted in the ground by his hand, or through both hands at the tyre's side
      const hand = pd.hands[0], butt = pd.hands[1], hit: V3 = cm([sx, sy - 0.1, -0.12]);
      const reach = unit(sub(hit, butt));
      const from = mixV([hand[0], 0, hand[2]], add(butt, reach, -25), jab), to = mixV([hand[0], 215, hand[2]], hit, jab);
      if (F) tube(B, [from, mixV(from, to, 0.5), to], () => 2, () => WOOD, 1, 6);
      path(B, [from, to], WOOD, 1.6, 1);
    }
    // the one at the ladder: behind it, facing up the yard, his hands on its rails, until there is something to cheer
    const ll = LOOKS.ladder;
    const down = sc.hit >= 0 ? smooth(clamp01((t - sc.hit) / 0.25)) : 0;
    const stand = add(L.foot, along, 0.95);
    const free = sim.phase === "air" || sim.phase === "done";
    const lp: Pose = down ? POSES.wide : mood === "cheer" && free ? cheer(sc.since, 3) : mood === "groan" && free ? HEAD_HANDS : RAIL;
    person(B, ll, at([stand[0] * M + along[0] * 60 * down, ll.tall - 86 * down + (mood === "cheer" && free ? jump(sc.since, 3) : 0), stand[2] * M + along[2] * 60 * down], L.yaw + Math.PI, { sit: down, pose: lp, lean: down ? -0.8 : sc.struck >= 0 ? -0.5 * Math.exp(-(t - sc.struck) * 2.5) : 0 }), t, this.crown, true);
    // and one more, off to the left of it, who only watches
    const fl = LOOKS.far;
    person(B, fl, at([FAR[0] * M, fl.tall + (mood === "cheer" ? jump(sc.since, 4) : 0), FAR[2] * M], Math.PI - 0.5, { pose: mood === "cheer" ? cheer(sc.since, 4) : mood === "groan" ? HEAD_HANDS : POSES.hip }), t, this.crown, true);

    // ---- the chimney's smoke goes with the wind; what goes in comes back out as soot
    const c = YARD.chimney;
    if (rand() < dy * 9) this.puffs.push({ p: [c.x + (rand() - 0.5) * 1.2, c.tall + 0.1, c.z + (rand() - 0.5) * 1.2], v: [sim.wind[0] * 0.8, 1.5 + rand(), sim.wind[2] * 0.8], born: yt, life: 5 + rand() * 2, size: 0.45, grow: 0.5, color: SMOKE });
    if (gone && !this.wasIn) {
      for (let i = 0; i < 36; i++) {
        const a = rand() * TAU, out = 1 + 3 * rand();
        this.puffs.push({ p: [c.x + Math.cos(a) * 0.5, c.tall + 0.2, c.z + Math.sin(a) * 0.5], v: [Math.cos(a) * out + sim.wind[0], 3 + 7 * rand(), Math.sin(a) * out + sim.wind[2]], born: yt, life: 2.5 + rand() * 2.5, size: 0.4, grow: 0.5, color: SOOT });
      }
    }
    this.wasIn = gone;
    this.puffs = this.puffs.filter((p) => yt - p.born < p.life && p.p[1] > -0.05);
    for (const p of this.puffs) {
      const age = yt - p.born, k = age / p.life;
      p.p = [p.p[0] + p.v[0] * dy, p.p[1] + p.v[1] * dy, p.p[2] + p.v[2] * dy];
      if (p.heavy) {
        // dirt and sparks: thrown, and falling
        p.v[1] -= 9.81 * dy;
        const tail = add(p.p, p.v, -0.035);
        if (F && p.color === DIRT) F.loft([circle(cm(p.p), cr, cu, p.size * M, 5), circle(cm(p.p), cr, cu, 0.2, 5)], () => DIRT, [false, false]);
        else path(B, [cm(tail), cm(p.p)], p.color === SPARK ? FLAME : V.amber, p.color === SPARK ? 1.6 : 0.85, (p.color === SPARK ? 1 : 0.7) * (1 - k), false, p.color === SPARK);
        continue;
      }
      p.v = [p.v[0] * (1 - 0.6 * dy) + sim.wind[0] * 0.6 * dy, p.v[1] * (1 - 0.5 * dy), p.v[2] * (1 - 0.6 * dy) + sim.wind[2] * 0.6 * dy];
      const rad = p.size * (1 + p.grow * age * 2), fade = (1 - k) * Math.min(1, age * 8);
      if (F) {
        // lit: a disc that faces the camera, shrinking away as it thins
        const q = rad * (0.5 + 0.5 * fade) * M;
        F.loft([circle(cm(p.p), cr, cu, q, 10), circle(cm(p.p), cr, cu, q * 0.02, 10)], () => p.color, [false, false]);
      } else path(B, circle(cm(p.p), cr, cu, rad * M, 8), p.color === DUST ? V.amber : p.color === SOOT ? BRIGHT : MID, p.color === SOOT ? 1.05 : 0.85, 0.75 * fade, true);
    }
    B.end();
    F?.end();

    // ---- the camera
    const cam = r.camera;
    // The field of view is given for a wide screen. A squarer one sees as far to each side by
    // seeing more above and below; a phone held upright gets some of that, not all of it, or
    // everything in the yard would be small: like the clip, it loses the men at the edges instead.
    const fov = (2 * Math.atan(Math.tan((sc.fov * Math.PI) / 360) * Math.max(1, Math.min(1.45 / cam.aspect, TALL))) * 180) / Math.PI;
    if (Math.abs(cam.fov - fov) > 1e-3 || cam.far < 100000) {
      cam.fov = fov;
      cam.near = 8;
      cam.far = 140000;
      cam.updateProjectionMatrix();
    }
    this.world.localToWorld(cam.position.set(sc.eye[0] * M, sc.eye[1] * M, sc.eye[2] * M));
    this.world.localToWorld(this.look.set(sc.at[0] * M, sc.at[1] * M, sc.at[2] * M));
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
    cam.updateMatrixWorld(true);
  }

  private firedSeen = 0;
}
