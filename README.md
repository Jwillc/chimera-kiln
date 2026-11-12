# KILN

A small browser game: spin a tyre up on a diesel engine, knock it loose, and get a ladder under
it so that it climbs the ladder and comes down a brick kiln's chimney.

**Play it: https://jwillc.github.io/chimera-kiln/**

It is seen from behind the engine, the way the clip that inspired it was filmed. The tyre, the
ladder and the air are simulated, and every sound in it is a synthesized voice.

## Controls

| Where | Keys | What they do |
|---|---|---|
| At the engine | `W` `S` | Open and close the throttle |
| | `Space` | Knock the tyre off the shaft |
| At the ladder | `A` `D` | Step the ladder left and right |
| | `W` `S` | Stand it up or lean it back |
| Any time | `Space` | Another tyre (after one has landed) |
| | `R` | Start this tyre over |
| | `G` | Switch between solid and wireframe |

On a phone or tablet the same controls are buttons on the screen, and it plays upright or on its
side.

A tyre needs about 50 m/s of tread speed to reach the chimney's mouth, and it starts to smoke and
lose grip if it is held at full speed. The ladder stays where you leave it between tyres; about
75° is a good place to start.

## How it works

- `src/kiln/physics.ts` is the whole simulation, in metres and seconds: the engine's governor, the
  tyre hung on the hub at the shaft's end, the heat in its tread, the way it claws itself up to
  speed across the dirt, the blow at the ladder where its remaining spin becomes climb, and the
  flight with drag, spin lift and wind. Nothing about a shot is scripted.
- `src/kiln/yard.ts` draws the yard and the men, in wireframe or with lit surfaces under it.
- `src/kiln/game.ts` is the keys, the camera and the sound.
- `tests/kiln-physics.test.ts` pins the numbers that make the game what it is, and checks that the
  tyre never gains energy from nowhere.

The sounds (`public/shows/kiln/`) were all rendered with CHIMERA, a physical model of a voice: the
engine is a beatboxer's kick played once per firing, the tyre is a held note whose pitch follows
its speed, the dust is a held "sh". `sounds/compose.py` is the script that made them; it needs a
command-line build of the engine that is not part of this repo, so the rendered files are checked
in.

## Run it locally

You need [Bun](https://bun.sh) and [Rust](https://rustup.rs) with the wasm target
(`rustup target add wasm32-unknown-unknown`).

```bash
bun install
bun run dev        # http://127.0.0.1:5327
```

```bash
bun run test       # the physics tests
bun run build      # the site, in dist/
bun run check      # plays three tyres in headless Chromium against the dev server
bun run check:phone  # the same on a phone-sized touch screen, with the on-screen buttons
```

Pushing to `main` builds and publishes the site to GitHub Pages
(`.github/workflows/pages.yml`).

## Credits

- Built on [CHIMERA](https://github.com/jamesondh/chimera-vocal-synth) by Jameson Hodge, a
  physically modelled voice synthesizer (MIT). The voice engine in `crates/`, the head renderer and
  the supporting code under `src/ui`, `src/wasm`, `src/worklet` and `src/audio` come from it, with
  changes.
- Fonts: AV Hershey Simplex and Archivo; their licences are in `public/fonts/`.
- The idea comes from a widely shared clip of men at a brick kiln doing exactly this.

MIT licensed; see `LICENSE`.
