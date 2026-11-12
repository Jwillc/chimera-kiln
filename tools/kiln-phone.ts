/**
 * Plays the game as a phone would: a touch screen the size of one, upright and on its side, with
 * the on-screen buttons. It holds the throttle button, taps Knock, nudges the ladder with the
 * step and lean buttons (and checks that they moved it), then lets a ladder man who knows where
 * the tyre is heading finish the shot. Screenshots of each stage go to the out folder.
 * Usage: bun tools/kiln-phone.ts [url] [outdir]   (needs the dev or preview server)
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://127.0.0.1:5327/";
const out = process.argv[3] ?? "out/phone";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
let failed = 0;
for (const [name, width, height] of [["upright", 390, 844], ["sideways", 844, 390]] as const) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction("window.__kiln");
  await page.waitForTimeout(700);
  const shot = (step: string) => page.screenshot({ path: `${out}/${name}-${step}.png` });
  const run = <T>(fn: string) => page.evaluate(`(async () => { const g = window.__kiln, sleep = (ms) => new Promise((r) => setTimeout(r, ms)); ${fn} })()`) as Promise<T>;
  await shot("0-card");
  const start = page.getByRole("button", { name: "Start" });
  const box = await start.boundingBox();
  const startSeen = !!box && box.y >= 0 && box.y + box.height <= height;
  const sideScroll = await page.evaluate("document.documentElement.scrollWidth > innerWidth + 1");
  await start.tap();
  await page.waitForFunction(`window.__kiln.debug.phase === "spin"`);
  const press = (label: string, type: "pointerdown" | "pointerup") => page.getByRole("button", { name: label }).dispatchEvent(type, { pointerId: 1, pointerType: "touch", isPrimary: true, bubbles: true });
  // the throttle button held until the tread is fast enough, then Knock
  await press("Open the throttle", "pointerdown");
  await run(`g.drive({ lean: ${(75 * Math.PI) / 180} }); for (let n = 0; n < 500 && g.debug.tread < 51; n++) await sleep(20);`);
  await shot("1-spinning");
  await press("Open the throttle", "pointerup");
  const lever = await run<number>(`return g.debug.lever`);
  await page.getByRole("button", { name: "Knock" }).dispatchEvent("pointerdown", { pointerId: 2, pointerType: "touch", bubbles: true });
  await page.waitForFunction(`window.__kiln.debug.phase === "roll"`, null, { timeout: 5000 });
  // a touch of each ladder button: it should move the ladder
  const before = await run<{ z: number; lean: number }>(`return g.debug.man`);
  await press("Step the ladder right", "pointerdown");
  await press("Stand the ladder up", "pointerdown");
  await page.waitForTimeout(260);
  await press("Step the ladder right", "pointerup");
  await press("Stand the ladder up", "pointerup");
  const after = await run<{ z: number; lean: number }>(`return g.debug.man`);
  await shot("2-rolling");
  // then a ladder man who never misjudges it, so the rest of the shot is seen
  await run(`g.drive({ lean: ${(75 * Math.PI) / 180} }); for (let n = 0; n < 600 && g.debug.phase === "roll"; n++) { const d = g.debug; const ahead = d.pos[2] + Math.tan(d.heading) * (26 - d.pos[0]); const off = ahead - d.man.z; g.drive(off > 0.06 ? { down: ["KeyD"], up: ["KeyA"] } : off < -0.06 ? { down: ["KeyA"], up: ["KeyD"] } : { up: ["KeyA", "KeyD"] }); await sleep(12); } g.drive({ up: ["KeyA", "KeyD"] });`);
  await run(`for (let n = 0; n < 60 && g.debug.phase === "fly" && g.debug.pos[1] < 10; n++) await sleep(25);`);
  await shot("3-flight");
  await run(`for (let n = 0; n < 400 && g.debug.phase !== "after"; n++) await sleep(30); await sleep(1400);`);
  await shot("4-after");
  const kind = await run<string>(`return g.debug.outcome.kind`);
  await page.getByRole("button", { name: "Another tyre" }).tap();
  await page.waitForFunction(`window.__kiln.debug.phase === "spin"`, null, { timeout: 5000 });
  const tries = await run<number>(`return g.debug.tries`);
  const ok = startSeen && !sideScroll && lever > 0.9 && after.z > before.z + 0.2 && after.lean > before.lean + 0.01 && tries === 2 && !errors.length;
  if (!ok) failed++;
  console.log(`${name} ${width}x${height}: start button in view ${startSeen}; page scrolls sideways ${sideScroll}; throttle reached ${lever.toFixed(2)}; step moved the ladder ${(after.z - before.z).toFixed(2)} m; lean moved it ${(((after.lean - before.lean) * 180) / Math.PI).toFixed(1)} deg; shot: ${kind}; next tyre: ${tries === 2}; errors: ${errors.length ? errors : "none"}`);
  await context.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
