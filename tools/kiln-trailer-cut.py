# /// script
# dependencies = ["numpy", "scipy"]
# ///
"""Cuts the trailer from the takes `tools/kiln-trailer.ts` filmed, and gives them their sound.

The takes are silent: the game's sound ran on the real clock while the picture ran on the film's.
But the filming logged every sound the game played and on which frame (one-shots with their level
and speed; for the held sounds, the level and speed each frame), so the mix is rebuilt here from
the game's own sound files, sample for sample in step with the picture.

    uv run tools/kiln-trailer-cut.py [dir]        # dir: out/trailer; writes dir/kiln-trailer.mp4

The opening is somebody else's clip (dir/source.mp4, seconds 4 to 22); it is not part of this repo.
"""
import json
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
from scipy.signal import lfilter

HERE = Path(__file__).resolve().parent
DIR = Path(sys.argv[1] if len(sys.argv) > 1 else HERE.parent / "out/trailer")
SOUNDS = HERE.parent / "public/shows/kiln"
SR, FPS, W, H = 48000, 60, 1080, 1920


def read(path):
    with wave.open(str(path)) as f:
        x = np.frombuffer(f.readframes(f.getnframes()), "<i2").astype(np.float64) / 32768.
        if f.getnchannels() > 1:
            x = x.reshape(-1, f.getnchannels()).mean(axis=1)
        assert f.getframerate() == SR, path
        return x


def write(path, x):
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(SR)
        f.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())


CLIPS = {p.stem: read(p) for p in SOUNDS.glob("*.wav")}


def sound_of(take):
    """The game's mix for a filmed take, from its log."""
    n = int(take["frames"] / FPS * SR)
    out = np.zeros(n + SR)
    # what is played once: at its frame, at its level, faster or slower
    for frame, name, gain, rate in take["shots"]:
        clip = CLIPS[name]
        x = np.interp(np.arange(0, len(clip) - 1, rate), np.arange(len(clip)), clip) * gain
        i = int(frame / FPS * SR)
        out[i:i + len(x)] += x[:len(out) - i]
    # what is held: its level and speed follow the frames, eased as the game eases them (40 ms)
    a = 1 - np.exp(-1 / (.04 * SR))
    for name in take["loops"][0]:
        steps = np.array([f[name] for f in take["loops"]])
        gain, rate = (np.repeat(steps[:, k], SR // FPS)[:n] for k in (0, 1))
        gain = lfilter([a], [1, a - 1], gain, zi=[gain[0] * (1 - a)])[0]
        rate = lfilter([a], [1, a - 1], rate, zi=[rate[0] * (1 - a)])[0]
        clip = CLIPS[name]
        out[:n] += np.interp(np.cumsum(rate) % len(clip), np.arange(len(clip) + 1), np.append(clip, clip[0])) * gain
    out *= .9
    # many throats at once must not clip: the game's compressor (-14 dB, 5:1, quick up, slow down)
    level, env = 0., np.empty(len(out))
    up, down = 1 - np.exp(-1 / (.003 * SR)), 1 - np.exp(-1 / (.2 * SR))
    for i, v in enumerate(np.abs(out)):
        level += (up if v > level else down) * (v - level)
        env[i] = level
    over = np.maximum(0, 20 * np.log10(np.maximum(env, 1e-9)) + 14)
    return out * 10 ** (-over * (1 - 1 / 5) / 20)


def ffmpeg(*args):
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", *map(str, args)], capture_output=True, text=True)
    if r.returncode:
        sys.exit(r.stderr)


def main():
    takes = {n: json.loads((DIR / f"{n}.json").read_text()) for n in ("hero", "man", "over", "shaft", "final")}
    sounds = {n: sound_of(t) for n, t in takes.items()}
    m = {n: t["marks"] for n, t in takes.items()}
    s = lambda seconds: int(round(seconds * FPS))

    # ---- the cut: (what, first frame, last frame). A take's frames are its own; the clip's are at 60 a second too.
    hero, final = m["hero"], m["final"]
    cut = [
        ("source", s(4), s(22)),
        ("card-what-if", 0, s(2.3)),
        # control the motor: the tyre goes on and the throttle opens; then, as it comes up to speed, the knock
        ("hero", s(.5), s(3.3)),
        # control the ladder, make it into the kiln: one shot from the knock to the cheer
        ("hero", hero["knock"] - s(2.2), hero["landed"] + s(3.4)),
        # the ones that did not, quickly: the man, over the top, the side of the stack
        ("man", m["man"]["landed"] - s(1.0), m["man"]["landed"] + s(1.4)),
        ("over", m["over"]["launch"] + s(1.0), m["over"]["launch"] + s(2.8)),
        ("over", m["over"]["landed"] + s(.85), m["over"]["landed"] + s(1.6)),
        ("shaft", m["shaft"]["launch"] + s(.15), m["shaft"]["launch"] + s(2.0)),
        ("shaft", m["shaft"]["landed"] + s(.85), m["shaft"]["landed"] + s(1.6)),
        # and one more that did, from the middle of its run to the men shouting
        ("final", final["roll"] + s(1.3), final["landed"] + s(5.75)),
        ("card-end", 0, s(3.6)),
    ]
    for what, a, b in cut:
        assert what.startswith(("source", "card")) or 0 <= a < b <= takes[what]["frames"], (what, a, b, takes.get(what, {}).get("frames"))

    # ---- the picture
    files, graph, labels = [], [], []
    for i, (what, a, b) in enumerate(cut):
        if what.startswith("card"):
            files += ["-loop", "1", "-framerate", FPS, "-t", (b - a) / FPS, "-i", DIR / f"{what}.png"]
            graph.append(f"[{i}:v]scale={W}:{H},format=yuv420p,fade=t=in:st=0:d=0.25,fade=t=out:st={(b - a) / FPS - .25:.3f}:d=0.25,setsar=1[v{i}]" if what != "card-end"
                         else f"[{i}:v]scale={W}:{H},format=yuv420p,fade=t=in:st=0:d=0.5,setsar=1[v{i}]")
        else:
            files += ["-i", DIR / f"{what}.mp4"]
            graph.append(f"[{i}:v]fps={FPS},trim=start_frame={a}:end_frame={b},setpts=PTS-STARTPTS,scale={W}:{H}:flags=lanczos,format=yuv420p,setsar=1[v{i}]")
        labels.append(f"[v{i}]")
    graph.append("".join(labels) + f"concat=n={len(cut)}:v=1:a=0[v]")
    ffmpeg(*files, "-filter_complex", ";".join(graph), "-map", "[v]", "-r", FPS, "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", DIR / "picture.mp4")

    # ---- the sound: each piece laid where its picture is, with a short fade at each cut
    ffmpeg("-i", DIR / "source.mp4", "-vn", "-ac", "1", "-ar", SR, DIR / "source.wav")
    source = read(DIR / "source.wav")
    rms = lambda x: np.sqrt(np.mean(x ** 2))
    # the game is set a little under the clip, which was recorded standing next to the engine
    level = .8 * rms(source[4 * SR:22 * SR]) / rms(np.concatenate([sounds["hero"], sounds["final"]]))
    total = sum(b - a for _, a, b in cut)
    mix, at = np.zeros(int(total / FPS * SR) + SR), 0
    for what, a, b in cut:
        n, i = int((b - a) / FPS * SR), int(at / FPS * SR)
        if what == "card-what-if":
            x = np.zeros(n)
            hit = CLIPS["thud"] * 0.9 * level
            x[:len(hit)] += hit                                 # the cut lands on something
        elif what == "card-end":
            # the men are still shouting under it, dying away
            tail = sounds["final"][int(cut[-2][2] / FPS * SR):][:n] * level
            x = np.zeros(n)
            x[:len(tail)] = tail
            x *= np.clip(1 - np.arange(n) / (1.6 * SR), 0, 1) ** 2
        else:
            x = (source if what == "source" else sounds[what] * level)[int(a / FPS * SR):int(a / FPS * SR) + n].copy()
            ramp = int(.015 * SR)
            x[:ramp] *= np.linspace(0, 1, ramp)
            x[-ramp:] *= np.linspace(1, 0, ramp)
        mix[i:i + len(x)] += x
        at += b - a
    mix = mix[:int(total / FPS * SR)]
    mix *= .89 / np.abs(mix).max()
    write(DIR / "sound.wav", mix)

    ffmpeg("-i", DIR / "picture.mp4", "-i", DIR / "sound.wav", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-ac", "2", "-shortest", "-movflags", "+faststart", DIR / "kiln-trailer.mp4")
    t = 0
    for what, a, b in cut:
        print(f"  {t / FPS:6.2f} s  {what:<13} {(b - a) / FPS:5.2f} s")
        t += b - a
    print(f"wrote {DIR / 'kiln-trailer.mp4'}: {total / FPS:.1f} s, {W} x {H}, {FPS} fps")


if __name__ == "__main__":
    main()
