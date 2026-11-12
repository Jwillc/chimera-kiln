/**
 * Entry: load the voice engine (wasm) first, since the head on the screen is built from it, then
 * import and show the game. A failed load can be retried.
 */
import "./ui/styles.css";
import { initChimera } from "./wasm/chimera.ts";

const root = document.getElementById("root")!;

async function boot(): Promise<void> {
  try {
    await initChimera();
  } catch (err) {
    root.replaceChildren();
    const box = document.createElement("div");
    box.className = "boot-error";
    const msg = document.createElement("p");
    msg.textContent = `The voice engine could not load: ${err instanceof Error ? err.message : String(err)}`;
    const retry = document.createElement("button");
    retry.className = "primary";
    retry.textContent = "Try again";
    retry.onclick = () => void boot();
    box.append(msg, retry);
    root.append(box);
    return;
  }
  const { mount } = await import("./kiln/mount.tsx");
  mount(root);
}

void boot();
