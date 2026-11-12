/**
 * Plays the game in headless Chromium with real audio and prints what the
 * simulation did: a tyre spun up and let go, the ladder walked under it, where it came down.
 * It drives the game through its own hooks (`window.__kiln`): held keys, and a ladder man who is
 * told where the tyre is heading. Usage: bun tools/kiln-check.ts [url] [outdir] [solid]
 * (needs the dev or preview server)
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://127.0.0.1:5327/";
const out = process.argv[3] ?? "out/kiln";
const solid = process.argv[4] === "solid";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(url);
await page.waitForFunction("window.__kiln");
const run = <T>(fn: string) => page.evaluate(`(async () => { const g = window.__kiln, sleep = (ms) => new Promise((r) => setTimeout(r, ms)); ${fn} })()`) as Promise<T>;
const shot = (name: string) => page.screenshot({ path: `${out}/${name}${solid ? "-solid" : ""}.png` });
// the game opens solid; G (here, its handle) switches to wire
await run(`g.setSolid(${solid})`);
await page.waitForTimeout(600);
await shot("0-card");
await page.getByRole("button", { name: "Start" }).click();
await page.waitForFunction(`window.__kiln.debug.phase === "spin"`);
console.log("audio:", await run(`return g.debug.audio + ", " + g.debug.clips + " clips"`));

// three tyres: the lever held open to a tread speed, the ladder walked to where the tyre is heading
const plan: [number, number][] = [[54, 76.5], [44, 70], [57, 79]];
for (let i = 0; i < plan.length; i++) {
  const [tread, lean] = plan[i];
  await run(`g.drive({ lean: ${(lean * Math.PI) / 180}, down: ["KeyW"] }); for (let n = 0; n < 400 && g.debug.tread < ${tread}; n++) await sleep(30);`);
  const spun = await run<{ rpm: number; tread: number; hot: number }>(`const d = g.debug; return { rpm: Math.round(d.rpm), tread: +d.tread.toFixed(1), hot: Math.round(d.hot) };`);
  await shot(`${i + 1}a-spun`);
  await run(`g.drive({ up: ["KeyW"], press: "Space" }); await sleep(170);`);
  await shot(`${i + 1}a-knock`);
  // the ladder man: steps towards where the tyre will cross his line
  await run(`for (let n = 0; n < 100 && g.debug.phase === "spin"; n++) await sleep(5); for (let n = 0; n < 600 && g.debug.phase === "roll" && g.debug.pos[0] < 13; n++) { const d = g.debug; const ahead = d.pos[2] + Math.tan(d.heading) * (26 - d.pos[0]); const off = ahead - d.man.z; g.drive(off > 0.06 ? { down: ["KeyD"], up: ["KeyA"] } : off < -0.06 ? { down: ["KeyA"], up: ["KeyD"] } : { up: ["KeyA", "KeyD"] }); await sleep(12); }`);
  await shot(`${i + 1}b-rolling`);
  await run(`for (let n = 0; n < 600 && g.debug.phase === "roll" && g.debug.pos[0] < 22; n++) { const d = g.debug; const ahead = d.pos[2] + Math.tan(d.heading) * (26 - d.pos[0]); const off = ahead - d.man.z; g.drive(off > 0.06 ? { down: ["KeyD"], up: ["KeyA"] } : off < -0.06 ? { down: ["KeyA"], up: ["KeyD"] } : { up: ["KeyA", "KeyD"] }); await sleep(12); }`);
  await shot(`${i + 1}b-closing`);
  await run(`for (let n = 0; n < 600 && g.debug.phase === "roll" && g.debug.sim !== "ladder"; n++) { const d = g.debug; const ahead = d.pos[2] + Math.tan(d.heading) * (26 - d.pos[0]); const off = ahead - d.man.z; g.drive(off > 0.06 ? { down: ["KeyD"], up: ["KeyA"] } : off < -0.06 ? { down: ["KeyA"], up: ["KeyD"] } : { up: ["KeyA", "KeyD"] }); await sleep(12); } g.drive({ up: ["KeyA", "KeyD"] });`);
  // from the blow on: where the tyre is in the picture (0 the top, 1 the bottom), every 50 ms
  const sweep = await run<string>(`const ys = []; for (let n = 0; n < 24; n++) { const d = g.debug, at = g.yard.screen(d.pos); ys.push(at ? (at[1] / innerHeight).toFixed(2) : "out"); await sleep(50); } return ys.join(" ");`);
  console.log("   in the picture after the blow:", sweep);
  await shot(`${i + 1}b-ladder`);
  await run(`for (let n = 0; n < 400 && g.debug.phase === "roll"; n++) await sleep(8); await sleep(60);`);
  await shot(`${i + 1}c-launch`);
  await run(`for (let n = 0; n < 60 && g.debug.phase === "fly" && g.debug.pos[1] < 9; n++) await sleep(25);`);
  await shot(`${i + 1}c-flight`);
  await run(`for (let n = 0; n < 400 && g.debug.phase !== "after"; n++) await sleep(30); await sleep(1500);`);
  await shot(`${i + 1}d-after`);
  const o = await run<Record<string, unknown>>(`const o = g.debug.outcome; return o && { kind: o.kind, apex: +o.apex.toFixed(1), miss: o.miss && { along: +o.miss.along.toFixed(2), across: +o.miss.across.toFixed(2) }, arrive: +o.arrive.toFixed(1), launch: +o.launch.toFixed(1), lean: +o.lean.toFixed(1) };`);
  console.log(`tyre ${i + 1}: spun to`, JSON.stringify(spun), "->", JSON.stringify(o));
  await run(`await sleep(1500); g.drive({ press: "Space" }); await sleep(900);`);
}
console.log("count:", await run(`return "tyres " + g.debug.tries + ", in " + g.debug.wins`), " errors:", errors.length ? errors : "none");
await browser.close();
