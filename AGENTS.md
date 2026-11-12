# KILN

A browser game on the CHIMERA voice engine: spin a tyre up on a diesel engine, knock it off the
shaft, and steer the man with the ladder so the tyre climbs it and drops into the chimney. See the
README. Live at https://jwillc.github.io/chimera-kiln/; a push to `main` rebuilds and redeploys it
(`.github/workflows/pages.yml`).

## Map

- `src/kiln/physics.ts`: the whole simulation (metres, seconds, seeded). No screen, no sound.
- `src/kiln/yard.ts`: draws the yard and the men, in wire or with lit surfaces under the wire.
  `src/kiln/figure.ts`: the people.
- `src/kiln/game.ts`: keys, camera, sound, the readouts. `KilnPage.tsx`: the title card.
- `public/shows/kiln/`: every sound, rendered ahead. `sounds/`: the script and the men's lines
  (re-rendering needs a command-line engine that is not in this repo).
- `crates/`, `src/ui`, `src/wasm`, `src/worklet`, `src/audio`: the parts of CHIMERA the game
  imports. Change them only when the game needs it.

## How the game is meant to be

- **Simulated, not scripted.** What a tyre does comes out of `physics.ts` and its parameters.
  Tune difficulty there (`ENGINE`, `YARD`, `HEAT`) and re-run the tests; do not add aim assists
  or fixed outcomes. Drama is presentation: it must not change the physics.
- **One camera, behind the engine**, on the engine's line with the chimney centred. It turns,
  tilts and zooms; it never moves.
- **No slowdown at the ladder.** No slow motion and no camera shake on the impact or the launch:
  both read as the tyre losing speed. The tyre is allowed to outrun the camera up the frame.
- **Solid graphics by default.** `G` switches to wireframe and back; the option is not shown on
  the title card.
- **Every sound is a CHIMERA voice.** No recordings of engines, tyres or people.
- From behind, anything drawn along the tyre's path is end-on and invisible: show speed with
  things that spread sideways or upward.

## Checks

| When you touch | Run |
|---|---|
| anything | `bun run build` (wasm, typecheck, bundle) and `bun run test` |
| `physics.ts` | read what the tests pin (spin needed, the lean window) before moving a number |
| `yard.ts`, `game.ts`, the card | `bun run dev`, then `bun run check [url] [outdir] [solid]`, and look at the screenshots |

`bun run check` plays three tyres in headless Chromium with real audio. Nobody can hear the sounds
or feel the controls from a headless run: say so when reporting.

Commit small, with what changed and what was run. Pushing to `main` publishes.
