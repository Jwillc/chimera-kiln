/**
 * The kiln game's physics (src/kiln/physics.ts): what the yard allows, and that nothing in it
 * makes energy. The numbers here are the game's difficulty, so a change that moves them is a
 * change to the game.
 */
import { describe, expect, test } from "bun:test";
import { ENGINE, G, HEAT, Sim, TYRE, YARD, shoot } from "../src/kiln/physics.ts";

const rad = (deg: number) => (deg * Math.PI) / 180;
const still: [number, number, number] = [0, 0, 0];

describe("kiln physics", () => {
  test("the engine takes several seconds to spin the tyre up, and a tyre held at full speed catches fire", () => {
    const sim = new Sim(3, still);
    let at50 = 0, alight = 0;
    for (let i = 1; i <= 30 * 60; i++) {
      sim.step(1 / 60, 1);
      if (!at50 && sim.tread >= 50) at50 = i / 60;
      if (!alight && sim.burning) alight = i / 60;
    }
    expect(at50).toBeGreaterThan(4);
    expect(at50).toBeLessThan(8);
    expect(sim.rpm).toBeLessThan(ENGINE.max + 1);
    expect(alight).toBeGreaterThan(at50 + 2);
    expect(sim.hot).toBeGreaterThan(HEAT.fire);
  });

  test("a well spun tyre goes in at the right lean, over it leaning back and short standing up", () => {
    const at = (deg: number) => shoot({ seed: 7, tread: 54, lean: rad(deg), follow: true, wind: still });
    expect(at(76.5).kind).toBe("in");
    const back = at(70), up = at(81);
    expect(back.kind).toBe("over");
    expect(back.miss!.along).toBeGreaterThan(3);
    expect(["shaft", "short"]).toContain(up.kind);
  });

  test("the window of leans that go in is a few degrees wide, not a hair and not a barn door", () => {
    let wide = 0;
    for (let deg = 70; deg <= 82; deg += 0.25) if (shoot({ seed: 7, tread: 54, lean: rad(deg), follow: true, wind: still }).kind === "in") wide += 0.25;
    expect(wide).toBeGreaterThan(1.5);
    expect(wide).toBeLessThan(5);
  });

  test("an under-spun tyre cannot reach the mouth at any lean", () => {
    for (let deg = 56; deg <= 83; deg += 1) {
      const o = shoot({ seed: 11, tread: 40, lean: rad(deg), follow: true, wind: still });
      expect(o.kind).not.toBe("in");
      expect(o.apex).toBeLessThan(YARD.chimney.tall);
    }
  });

  test("with the weather and the veer as they come, a man who is always under it gets most of them in", () => {
    let wins = 0;
    for (let seed = 1; seed <= 80; seed++) if (shoot({ seed, tread: 54, lean: rad(76.5), follow: true }).kind === "in") wins++;
    expect(wins).toBeGreaterThan(48);
    expect(wins).toBeLessThan(80);
  });

  test("a ladder that is not in the tyre's way does nothing for it", () => {
    const o = shoot({ seed: 5, tread: 54, lean: rad(76), z: 3.5, wind: still });
    expect(["bricks", "man"]).toContain(o.kind);
    expect(o.launch).toBe(0);
  });

  test("nothing in the yard makes energy: from the moment it is let go, the tyre only loses it", () => {
    for (const lean of [62, 70, 76.5, 82]) {
      const sim = new Sim(9, still);
      sim.ladder.lean = rad(lean);
      while (sim.tread < 56) sim.step(1 / 120, 1);
      sim.release();
      const energy = () => 0.5 * TYRE.m * (sim.vel[0] ** 2 + sim.vel[1] ** 2 + sim.vel[2] ** 2) + 0.5 * TYRE.k * TYRE.m * TYRE.r ** 2 * sim.spin ** 2 + TYRE.m * G * sim.pos[1];
      let before = energy();
      for (let i = 0; i < 40 * 600 && !sim.outcome; i++) {
        const ahead = sim.pos[2] + Math.tan(sim.heading) * (YARD.ladderX - sim.pos[0]);
        if (sim.phase === "ground") sim.ladder.z = ahead;
        sim.step(1 / 600, 0);
        const now = energy();
        expect(now).toBeLessThanOrEqual(before * 1.0005 + 0.5);
        before = now;
      }
    }
  });
});
