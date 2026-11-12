/**
 * Films takes of the game for a trailer, as a phone shows it: upright, with the on-screen buttons.
 *
 * Not a screen recording: the page runs on a clock this script owns (`performance.now` and the
 * animation frames are replaced before it loads), so each step is exactly one video frame however
 * long it takes to draw and capture, and none is dropped. A scripted player works the game through
 * its real buttons (pointer events on them, so they light as a finger's would): it holds the
 * throttle to a tread speed, taps Knock, and walks the ladder to where the tyre is heading, or a
 * little off it when the take is meant to go wrong. What the tyre then does is the simulation's.
 *
 * The page's sound is not recorded (it would run on the real clock). Instead every sound the game
 * plays is logged with its frame: `tools/kiln-trailer-audio.py` rebuilds the mix from the log.
 *
 * Each take is written as <outdir>/<name>.mp4 (picture only) and <name>.json (what happened, on
 * which frames, and the sound log). A take is filmed again until it ends the way it is meant to.
 *
 * Usage: bun tools/kiln-trailer.ts <outdir> [take ...] [--url http://127.0.0.1:5327/]
 *        takes: cards hero man over shaft final (default: all). Needs the dev server and ffmpeg.
 */
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const at = args.indexOf("--url");
const url = at >= 0 ? args.splice(at, 2)[1] : "http://127.0.0.1:5327/";
const out = args.shift() ?? "out/trailer";
mkdirSync(out, { recursive: true });

/** the picture: a 9:16 phone, 432 x 768 CSS px drawn at 2.5, so 1080 x 1920 */
const W = 432, H = 768, SCALE = 2.5, FPS = 60;

interface Take {
  /** the tread speed the throttle is held to (m/s), and the ladder's lean (deg) */
  tread: number;
  lean: number;
  /** stand the ladder up by this much with its button once the tyre is rolling (deg): the lean above is where it ends */
  nudge?: number;
  /** how far from the tyre's path the ladder man stands (m): 0 is under it */
  off?: number;
  /** the words over the picture, by phase */
  titles?: boolean;
  /** filming starts with the tyre being put on, or just before it is knocked off */
  from: "placing" | "knock";
  /** seconds filmed after the tyre has landed, and how the take has to end to be kept */
  after: number;
  need: string[];
}
const TAKES: Record<string, Take> = {
  hero: { tread: 52, lean: 75, nudge: 1.5, titles: true, from: "placing", after: 4.2, need: ["in"] },
  man: { tread: 52, lean: 75, off: -0.68, from: "knock", after: 2.6, need: ["man"] },
  over: { tread: 55, lean: 67, from: "knock", after: 2.4, need: ["over"] },
  shaft: { tread: 43, lean: 73, from: "knock", after: 2.4, need: ["shaft", "low"] },
  final: { tread: 54, lean: 77, from: "knock", after: 6.6, need: ["in"] },
};
const wanted = args.length ? args : ["cards", ...Object.keys(TAKES)];

const browser = await chromium.launch({
  channel: "chromium",
  args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE, hasTouch: true, isMobile: true });

// ---- the two cards: plain pages in the game's own type
if (wanted.includes("cards")) {
  const page = await context.newPage();
  // on the game's own page, so that its typeface is the one already loaded there
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction("window.__kiln");
  const card = async (name: string, html: string) => {
    await page.evaluate((html) => {
      document.body.innerHTML = `<style>
        html, body { margin: 0; height: 100%; background: #000; }
        body { display: grid; place-content: center; justify-items: center; gap: 26px; font-family: Hershey, sans-serif; font-weight: 500; text-transform: uppercase; text-align: center; color: #eef6f8; }
        .big { font-size: 40px; letter-spacing: 0.16em; line-height: 1.55; padding: 0 20px; }
        .name { font-size: 84px; letter-spacing: 0.34em; margin-right: -0.34em; color: #ffb340; }
        .small { font-size: 21px; letter-spacing: 0.1em; color: #4fb6f2; }
        .rule { width: 150px; height: 3px; background: #4fb6f2; }
      </style>${html}`;
    }, html);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/${name}.png` });
  };
  await card("card-what-if", `<div class="big">What if this<br>was a<br>video game?</div>`);
  await card("card-end", `<div class="name">Kiln</div><div class="rule"></div><div class="big" style="font-size:29px">Play it free<br>in your browser</div><div class="small">jwillc.github.io/chimera-kiln</div>`);
  await page.close();
  console.log("cards written");
}

const takes = wanted.filter((n) => n in TAKES);
if (takes.length) {
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && console.log("page error:", m.text()));
  page.on("pageerror", (e) => console.log("page error:", e.message));
  // the page's clock: time only moves when __step says so, and a step runs the frames waiting on it
  await page.addInitScript(() => {
    let now = 0, next = 0;
    const waiting = new Map<number, FrameRequestCallback>();
    performance.now = () => now;
    window.requestAnimationFrame = (f) => (waiting.set(++next, f), next);
    window.cancelAnimationFrame = (i) => void waiting.delete(i);
    (window as unknown as { __step: (ms: number) => void }).__step = (ms) => {
      now += ms;
      const run = [...waiting.values()];
      waiting.clear();
      for (const f of run) f(now);
    };
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction("window.__kiln");
  await page.getByRole("button", { name: "Start" }).dispatchEvent("click");
  await page.waitForFunction(`window.__kiln.debug.phase === "spin"`, null, { polling: 100, timeout: 30000 });

  // ---- in the page: the sound log, the words over the picture, and the player
  await page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const g = (window as any).__kiln, W = window as any;
    const F: any = (W.__film = { on: false, frame: 0, shots: [], loops: [], marks: {}, now: {} });
    const play = g.play.bind(g), hold = g.hold.bind(g);
    g.play = (id: string, level = 1, rate = 1) => {
      const c = play(id, level, rate);
      if (c && F.on) F.shots.push([F.frame, id, +(c.gain * level).toFixed(4), +rate.toFixed(4)]);
      return c;
    };
    g.hold = (id: string, level: number, rate: number) => {
      F.now[id] = [+(Math.max(0, level) * (g.clips[id]?.gain ?? 1)).toFixed(4), +Math.min(4, Math.max(0.25, rate)).toFixed(4)];
      hold(id, level, rate);
    };
    const title = document.createElement("div");
    title.style.cssText = "position:fixed;left:0;right:0;top:25%;z-index:5;padding:13px 0 11px;background:rgba(0,0,0,0.68);border-top:2px solid #ffb340;border-bottom:2px solid #ffb340;font:500 27px Hershey,sans-serif;letter-spacing:0.14em;text-transform:uppercase;text-align:center;color:#fff;opacity:0;pointer-events:none";
    document.body.append(title);
    let showing = "", alpha = 0;
    const words = (text: string) => {
      // one line goes out before the next comes in
      if (text !== showing && alpha > 0) alpha = Math.max(0, alpha - 1 / 9);
      else if (text !== showing) title.textContent = showing = text;
      else alpha = Math.min(1, alpha + (text ? 1 / 9 : 0));
      title.style.opacity = String(showing ? alpha : 0);
    };
    const button = (label: string) => document.querySelector<HTMLElement>(`.kiln-pad button[aria-label="${label}"]`);
    const down = new Set<string>();
    /** a finger on a button, or off it; nothing happens while the button is not on the screen */
    const press = (label: string, on: boolean) => {
      if (down.has(label) === on) return;
      const el = button(label);
      if (!el) return void (on || down.delete(label));
      el.dispatchEvent(new PointerEvent(on ? "pointerdown" : "pointerup", { pointerId: 7, pointerType: "touch", bubbles: true }));
      if (on) down.add(label);
      else down.delete(label);
    };
    let take: any = null, age = 0, knockAt = -1, nudged = 0, endAt = -1;
    W.__begin = (t: any) => {
      take = t;
      age = 0;
      knockAt = endAt = -1;
      nudged = 0;
      down.clear();
      Object.assign(F, { on: t.from === "placing", frame: 0, shots: [], loops: [], marks: {} });
      g.drive({ lean: ((t.lean - (t.nudge ?? 0)) * Math.PI) / 180, z: 0 });
    };
    /** one frame: the player's hands, then the clock. Returns true when the take is over. */
    W.__frame = (ms: number) => {
      const d = g.debug, t = take, mark = (name: string) => F.marks[name] ?? (F.marks[name] = F.frame);
      age += ms / 1000;
      if (d.phase === "spin") {
        // the man who put the tyre on gets clear first; then the throttle, to the speed wanted; then the knock
        // (the pole takes a sixth of a second to land, and the tread gains about a metre a second in that)
        const opening = age > 1.5 && d.tread < t.tread - 1 && knockAt < 0;
        press("Open the throttle", opening);
        if (t.from === "knock" && d.tread >= t.tread - 4.5) F.on = true;
        if (age > 1.5 && d.tread >= t.tread - 1 && knockAt < 0) knockAt = age + 0.04;
        if (knockAt > 0 && age >= knockAt) {
          document.querySelector<HTMLElement>(".kiln-pad-knock")?.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 8, pointerType: "touch", bubbles: true }));
          mark("knock");
          F.marks.tread = +d.tread.toFixed(1);
          knockAt = Infinity;
        }
      } else if (d.phase === "roll" && d.sim === "ground") {
        mark("roll");
        // step to where the tyre will cross the ladder's line (or beside it, on a take meant to miss)
        const aim = d.pos[2] + Math.tan(d.heading) * (26 - d.pos[0]) + (t.off ?? 0), gap = aim - d.man.z;
        press("Step the ladder right", gap > 0.07);
        press("Step the ladder left", gap < -0.07);
        const more = t.nudge && nudged < t.nudge && F.frame - F.marks.roll > 30;
        press("Stand the ladder up", !!more);
        if (more) nudged = (d.man.lean * 180) / Math.PI - (t.lean - t.nudge);
      } else {
        for (const label of [...down]) press(label, false);
        if (d.sim === "ladder") mark("strike");
        if (d.sim === "air") mark("launch");
        if (d.phase === "after") {
          mark("landed");
          if (endAt < 0) endAt = age + t.after;
        }
      }
      if (t.titles) words(d.phase === "spin" ? (age > 0.7 ? "Control the motor" : "") : d.phase === "roll" ? "Control the ladder" : d.phase === "fly" ? "Make it into the kiln" : "");
      W.__step(ms);
      if (F.on) {
        F.loops.push(JSON.parse(JSON.stringify(F.now)));
        F.frame++;
      }
      return { on: F.on, over: endAt > 0 && age >= endAt, kind: d.outcome?.kind ?? null, tread: d.tread };
    };
    /** the next tyre, with nothing filmed */
    W.__next = () => {
      title.style.opacity = "0";
      showing = "";
      alpha = 0;
      g.tap("Space");
    };
  });

  for (const name of takes) {
    const take = TAKES[name];
    for (let tries = 1; ; tries++) {
      const file = `${out}/${name}.mp4`;
      const ffmpeg = Bun.spawn(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file],
        { stdin: "pipe", stdout: "inherit", stderr: "inherit" },
      );
      await page.evaluate((t) => (window as any).__begin(t), take);
      const started = Date.now();
      let frames = 0, kind: string | null = null;
      for (let k = 0; k < 60 * FPS; k++) {
        const s = (await page.evaluate((ms) => (window as any).__frame(ms), 1000 / FPS)) as { on: boolean; over: boolean; kind: string | null };
        if (s.on) {
          ffmpeg.stdin.write(await page.screenshot({ type: "jpeg", quality: 93 }));
          frames++;
        }
        kind = s.kind;
        if (s.over) break;
      }
      await ffmpeg.stdin.end();
      if (await ffmpeg.exited) throw new Error("ffmpeg failed");
      const film = (await page.evaluate(() => {
        const F = (window as any).__film;
        return { marks: F.marks, shots: F.shots, loops: F.loops };
      })) as { marks: Record<string, number>; shots: unknown[]; loops: unknown[] };
      const kept = !!kind && take.need.includes(kind);
      console.log(`${name} (try ${tries}): ${kind}, ${frames} frames, marks ${JSON.stringify(film.marks)}, ${((Date.now() - started) / 1000).toFixed(0)} s ${kept ? "kept" : "filmed again"}`);
      // the next tyre goes on either way: a second of nothing first, so the game will take the key
      for (let k = 0; k < 20; k++) await page.evaluate((ms) => (window as any).__step(ms), 1000 / FPS);
      await page.evaluate(() => (window as any).__next());
      for (let k = 0; k < 6; k++) await page.evaluate((ms) => (window as any).__step(ms), 1000 / FPS);
      if (kept) {
        writeFileSync(`${out}/${name}.json`, JSON.stringify({ name, fps: FPS, frames, kind, ...film }));
        break;
      }
      if (tries >= 6) throw new Error(`${name} would not end as ${take.need.join(" or ")}`);
    }
  }
}
await browser.close();
