/**
 * The game's page: the yard, with a card over it until the first tyre. The card's
 * button is the user gesture that starts the audio.
 *
 * The sounds are in `public/shows/kiln/`, all CHIMERA airways; `sounds/compose.py` is how they
 * were rendered.
 */
import { useEffect, useState } from "react";
import { AnatomyView3D } from "../ui/components/AnatomyView3D.tsx";
import { Game, type Phase, type Snapshot } from "./game.ts";

/** one line of the controls: the keys (or, on a phone, the buttons), and what they do */
function Keys(props: { keys: string[]; does: string }) {
  return (
    <div className="kiln-key">
      <span>
        {props.keys.map((k) => (
          <kbd key={k}>{k}</kbd>
        ))}
      </span>
      <span>{props.does}</span>
    </div>
  );
}

/** whether this is played with fingers: a touch screen as the main pointer, or a touch has been seen */
function useTouch(): boolean {
  const [touch, setTouch] = useState(() => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);
  useEffect(() => {
    const seen = () => setTouch(true);
    window.addEventListener("touchstart", seen, { once: true, passive: true });
    return () => window.removeEventListener("touchstart", seen);
  }, []);
  return touch;
}

/**
 * The keys, as buttons under the thumbs: the throttle and the knock while the tyre is on the
 * shaft, then the ladder's step (left thumb) and its lean (right thumb), then the next tyre.
 */
function Pad(props: { game: Game; phase: Phase }) {
  const { game, phase } = props;
  // a button held is a key held: it lets go when the finger lifts, slides off or is taken by the system
  const held = (code: string, glyph: string, label: string) => (
    <button
      key={code}
      aria-label={label}
      onPointerDown={(e) => {
        // keep the finger's later moves coming here even if it slides off (some pointers cannot be captured)
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // it is still held until it lifts
        }
        game.key(code, true);
      }}
      onPointerUp={() => game.key(code, false)}
      onPointerCancel={() => game.key(code, false)}
      onLostPointerCapture={() => game.key(code, false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {glyph}
    </button>
  );
  const group = (name: string, row: boolean, ...buttons: React.ReactNode[]) => (
    <div className={row ? "kiln-pad-group row" : "kiln-pad-group"}>
      <div className="kiln-pad-buttons">{buttons}</div>
      <span>{name}</span>
    </div>
  );
  const spin = phase === "spin", ladder = phase === "roll" || phase === "after";
  return (
    <div className="kiln-pad" data-layout="overlay">
      {spin && group("Throttle", false, held("KeyW", "▲", "Open the throttle"), held("KeyS", "▼", "Close the throttle"))}
      {ladder && group("Step", true, held("KeyA", "◀", "Step the ladder left"), held("KeyD", "▶", "Step the ladder right"))}
      {phase === "after" && (
        <button className="kiln-pad-next" onClick={() => game.tap("Space")}>
          Another tyre
        </button>
      )}
      {spin && (
        <button className="kiln-pad-knock" onPointerDown={() => game.tap("Space")} onContextMenu={(e) => e.preventDefault()}>
          Knock
        </button>
      )}
      {ladder && group("Lean", false, held("KeyW", "▲", "Stand the ladder up"), held("KeyS", "▼", "Lean the ladder back"))}
    </div>
  );
}

export function KilnPage() {
  const [game, setGame] = useState<Game | null>(null);
  const [snap, setSnap] = useState<Snapshot>({ phase: "menu", solid: true });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let gone = false, made: Game | null = null;
    Game.create(`${import.meta.env.BASE_URL}shows/kiln/`, setSnap)
      .then((g) => {
        if (gone) return g.dispose();
        made = g;
        // a handle for the console and the browser checks
        (window as unknown as { __kiln: Game }).__kiln = g;
        setGame(g);
      })
      .catch((e: unknown) => !gone && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      gone = true;
      made?.dispose();
    };
  }, []);

  const touch = useTouch();
  useEffect(() => {
    if (game) game.touch = touch;
  }, [game, touch]);

  const { phase } = snap;
  return (
    <div className="fps tell kiln">
      <div className="tell-view">{game && <AnatomyView3D feed={game.feed} readouts={false} overlay={game.overlay} />}</div>
      {game && touch && phase !== "menu" && <Pad game={game} phase={phase} />}
      {phase === "menu" && (
        <div className="fps-card kiln-card" data-layout="overlay">
          <span className="wordmark">Chimera</span>
          <h1>Kiln</h1>
          {error ? (
            <p className="error">
              The game could not load: {error}. Its sounds should be in <code>public/shows/kiln/</code>.
            </p>
          ) : (
            <>
              <p className="lead">Spin a tyre up on the engine, knock it loose, and get the ladder under it so it flies into the chimney.</p>
              <div className="kiln-steps">
                <section>
                  <h2>1 &nbsp;At the engine</h2>
                  <Keys keys={touch ? ["▲", "▼"] : ["W", "S"]} does="Open and close the throttle" />
                  <Keys keys={[touch ? "Knock" : "Space"]} does="Knock the tyre off the shaft" />
                  <p className="tip">Let it go at about 50 m/s of tread, before the rubber smokes.</p>
                </section>
                <section>
                  <h2>2 &nbsp;At the ladder</h2>
                  <Keys keys={touch ? ["◀", "▶"] : ["A", "D"]} does="Step the ladder left and right" />
                  <Keys keys={touch ? ["▲", "▼"] : ["W", "S"]} does="Stand it up or lean it back" />
                  <p className="tip">Get it in the tyre's path. It stays where you leave it; start near 75°.</p>
                </section>
              </div>
              {!touch && (
                <div className="kiln-also">
                  <Keys keys={["Space"]} does="Another tyre" />
                  <Keys keys={["R"]} does="Start this tyre over" />
                </div>
              )}
              <button className="primary large" disabled={!game} onClick={() => void game?.start()}>
                {game ? "Start" : "Loading…"}
              </button>
              <p className="hint">The tyre, the ladder and the air are simulated. Every sound is a throat.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
