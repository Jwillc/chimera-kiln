/**
 * The game's page: the yard, with a card over it until the first tyre. The card's
 * button is the user gesture that starts the audio.
 *
 * The sounds are in `public/shows/kiln/`, all CHIMERA airways; `sounds/compose.py` is how they
 * were rendered.
 */
import { useEffect, useState } from "react";
import { AnatomyView3D } from "../ui/components/AnatomyView3D.tsx";
import { Game, type Snapshot } from "./game.ts";

/** one line of the controls: the keys, and what they do */
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

  const { phase } = snap;
  return (
    <div className="fps tell">
      <div className="tell-view">{game && <AnatomyView3D feed={game.feed} readouts={false} overlay={game.overlay} />}</div>
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
                  <Keys keys={["W", "S"]} does="Open and close the throttle" />
                  <Keys keys={["Space"]} does="Knock the tyre off the shaft" />
                  <p className="tip">Let it go at about 50 m/s of tread, before the rubber smokes.</p>
                </section>
                <section>
                  <h2>2 &nbsp;At the ladder</h2>
                  <Keys keys={["A", "D"]} does="Step the ladder left and right" />
                  <Keys keys={["W", "S"]} does="Stand it up or lean it back" />
                  <p className="tip">Get it in the tyre's path. It stays where you leave it; start near 75°.</p>
                </section>
              </div>
              <div className="kiln-also">
                <Keys keys={["Space"]} does="Another tyre" />
                <Keys keys={["R"]} does="Start this tyre over" />
              </div>
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
