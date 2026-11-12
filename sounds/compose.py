# /// script
# dependencies = ["numpy", "scipy"]
# ///
"""KILN -- every sound of the tyre-and-chimney game.

Nothing in the game is a recording of an engine, a tyre or a brick: each sound is a CHIMERA airway.
The diesel's stroke is a beatboxer's kick with a puff after it, played once per firing by the game;
the tyre on the flywheel is a held low throat whose pitch the game turns with the tyre's speed; the
dust is a held "sh"; the rungs are a tongue's "t"; the whistle of the flight is a high "oo"; the
chimney is a kick and a falling "oh" put through a pipe. The men's shouts are lines.txt.

    SPEECH_ENGINE=/path/to/chimera uv run compose.py        # writes ../public/shows/kiln/

The rendered sounds are in the repo, so the game does not need this run. To run it you need a build
of the CHIMERA command-line engine whose `render text` takes --f0, --force, --rate and --glide (a
patched build the game's author keeps locally; the engine in this repo's crates/ is the browser's).
"""
import json
import os
import subprocess
import wave
from pathlib import Path

import numpy as np
from scipy.signal import butter, lfilter, sosfilt

HERE = Path(__file__).resolve().parent
SR = 48000
ENGINE = Path(os.environ.get("SPEECH_ENGINE") or HERE.parent.parent / "jug/engine/chimera")
TAKES = HERE / "takes"
SHOW = HERE.parent / "public/shows/kiln"
rng = np.random.default_rng(41)


# ---- what is done to a voice
def vari(x, ratio):
    """Varispeed: the same sound faster and higher, or slower and lower."""
    return np.interp(np.arange(0, len(x) - 1, ratio), np.arange(len(x)), x)


def to_rms(x, rms):
    return x * rms / max(np.sqrt(np.mean(x ** 2)), 1e-9)


def fade(x, a=.005, b=.005):
    x = x.copy()
    na, nb = min(int(a * SR), len(x)), min(int(b * SR), len(x))
    if na: x[:na] *= np.linspace(0, 1, na)
    if nb: x[-nb:] *= np.linspace(1, 0, nb)
    return x


def comb(x, hz, fb=.9):
    d = max(1, int(SR / hz))
    a = np.zeros(d + 1); a[0] = 1; a[d] = -fb
    return lfilter([1 - fb], a, x)


def bandpass(x, lo, hi): return sosfilt(butter(4, [lo, hi], "band", fs=SR, output="sos"), x)
def lowpass(x, hz): return sosfilt(butter(4, hz, "low", fs=SR, output="sos"), x)


def echo(x, delay, fb=.55, repeats=6):
    """Echoes off a wall, each quieter than the last. The result is longer than x by their tail."""
    out = np.concatenate([x, np.zeros(int((delay * repeats) * SR) + len(x))])
    gain = 1.
    for i in range(1, repeats + 1):
        gain *= fb
        at = int(delay * i * SR)
        out[at:at + len(x)] += x * gain
    return out

# who shouts: the man who places the tyre (his is the head on the screen), the man at the engine,
# the man at the ladder (far off); a line marked `all` is the three of them at once
VOICES = {
    "holder": {"body": "male", "f0": 124., "force": "13:.7:.04", "rate": 1.08},
    "driver": {"body": "male", "f0": 98., "force": "12:.66:.05", "rate": 1.0},
    "ladder": {"body": "male", "f0": 142., "force": "13.5:.72:.04", "rate": 1.1},
}
SAY = {"woo": "wu", "yeah": "jɛ", "hey": "heɪ", "oh": "oʊ", "ah": "ɑ", "oo": "u", "ee": "i", "no": "noʊ", "aw": "ɔ"}


def engine(*args):
    r = subprocess.run([str(ENGINE), "render", *map(str, args)], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"{args}: {r.stdout}{r.stderr}")


def wav(path):
    with wave.open(str(path)) as f:
        assert f.getframerate() == SR and f.getnchannels() == 1, path
        return np.frombuffer(f.readframes(f.getnframes()), "<i2") / 32768.


def write(name, x, peak=.92):
    x = x * min(1., peak / max(np.abs(x).max(), 1e-9))
    with wave.open(str(SHOW / f"{name}.wav"), "wb") as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(SR)
        f.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())
    return x


def highpass(x, hz):
    return sosfilt(butter(2, hz, "high", fs=SR, output="sos"), x)


def sounding(x, floor=.02, pad=.01):
    """the part of a take that is not silence"""
    hits = np.flatnonzero(np.abs(x) > floor * np.abs(x).max())
    return x[max(0, int(hits[0]) - int(pad * SR)):int(hits[-1]) + int(pad * SR)]


def loop(x, seconds, lap=.25):
    """a stretch of a steady sound whose end runs into its start"""
    n, k = int(seconds * SR), int(lap * SR)
    x = x[:n + k]
    ramp = np.linspace(0, 1, k)
    out = x[:n].copy()
    out[:k] = x[:k] * ramp + x[n:n + k] * (1 - ramp)
    return out


def held(name, word, midi, seconds, body="male", **source):
    """one syllable held on one note: the steady middle of it"""
    (TAKES / f"{name}.json").write_text(json.dumps({"bpm": 60, "t0": .1, "lyrics": f"{word} ~", "pronunciations": SAY, "vibrato": 0,
                                                    "notes": [[midi, seconds / 2 + .6], [midi, seconds / 2 + .6]], **source}))
    engine("notes", TAKES / f"{name}.json", TAKES / name, body)
    x = wav(TAKES / f"{name}.wav")
    return x[int(.55 * SR):int((.55 + seconds + .3) * SR)]


def sung(name, score, base, body="male", **source):
    """a cry: syllables on notes, [word, semitones above base, seconds]"""
    (TAKES / f"{name}.json").write_text(json.dumps({"bpm": 60, "t0": .1, "lyrics": " ".join(w for w, _, _ in score), "pronunciations": SAY, "vibrato": 0,
                                                    "notes": [[base + st, s] for _, st, s in score], **source}))
    engine("notes", TAKES / f"{name}.json", TAKES / name, body)
    return sounding(wav(TAKES / f"{name}.wav"))


def grains(src, seconds, each, rate, spread=.2):
    """a texture: bits of one sound scattered `rate` a second"""
    out = np.zeros(int(seconds * SR) + int(each * SR) + 1)
    for t in np.sort(rng.uniform(0, seconds, int(rate * seconds))):
        a = rng.integers(0, max(1, len(src) - int(each * SR)))
        g = fade(vari(src[a:a + int(each * SR)], rng.uniform(1 - spread, 1 + spread)), .003, each * .6) * rng.uniform(.5, 1)
        i = int(t * SR)
        out[i:i + len(g)] += g[:len(out) - i]
    return out[:int(seconds * SR)]


def envelope(x, hz=40):
    """how open a mouth saying this is, `hz` times a second (0..1)"""
    n = SR // hz
    e = np.array([np.sqrt(np.mean(x[i:i + n] ** 2)) for i in range(0, len(x) - n, n)])
    return [round(float(v), 2) for v in np.clip(e / max(e.max(), 1e-9), 0, 1) ** .6]


def main():
    TAKES.mkdir(exist_ok=True)
    SHOW.mkdir(parents=True, exist_ok=True)
    clips = {}

    def keep(name, x, gain=1., peak=.92, **more):
        x = write(name, x, peak)
        clips[name] = {"wav": f"{name}.wav", "seconds": round(len(x) / SR, 3), "gain": gain, **more}
        print(f"  {name:<9} {len(x) / SR:5.2f} s  rms {np.sqrt(np.mean(x ** 2)):.3f}  centroid {centroid(x):5.0f} Hz")

    engine("beatbox", TAKES / "kit", "B K t Pf kch tss m _K", "male", 120, 1)
    kit = {k: sounding(wav(TAKES / f"kit/{k}.wav"), .03, .002) for k in ("B", "K", "t", "Pf", "kch", "tss")}

    # ---- the engine: one firing stroke, twice over so no two running are the same
    for i, (cut, puff) in enumerate(((330, .5), (280, .65))):
        stroke = to_rms(fade(lowpass(kit["B"], cut)[:int(.16 * SR)], .001, .08), .2)
        chuff = to_rms(fade(bandpass(kit["Pf"], 500, 3800)[:int(.11 * SR)], .002, .07), .05 * puff / .5)
        x = np.zeros(int(.2 * SR))
        x[:len(stroke)] += stroke
        a = int(.035 * SR)
        x[a:a + len(chuff)] += chuff
        keep(f"putt{i + 1}", x, .8)

    # ---- the tyre on the rim: a held low throat (the game turns its pitch with the tyre), and a
    #      pinched high one for rubber that is too hot
    whirr = held("whirr", "oo", 41, 2.4, pressure=10, tension=.62, roughness=.35)
    keep("whirr", loop(to_rms(whirr + .5 * bandpass(whirr, 600, 2400), .12), 2.2), .7, loop=True)
    squeal = held("squeal", "ee", 88, 2.0, "female", pressure=15, tension=.97, roughness=.45)
    keep("squeal", loop(to_rms(bandpass(squeal, 1500, 7000), .08), 1.8), .5, loop=True)

    # ---- dust and air: a held "sh"
    engine("speech", TAKES / "sh", "ʃ ʃ ʃ ʃ ʃ ʃ", "male")
    sh = sounding(wav(TAKES / "sh.wav"), .15)
    hiss = to_rms(grains(highpass(sh, 900), 2.4, .12, 60), .1)
    keep("dust", loop(lowpass(hiss, 4500) + to_rms(grains(lowpass(kit["B"], 220), 2.4, .1, 26, .3), .05), 2.0), .8, loop=True)
    keep("wind", loop(to_rms(bandpass(hiss, 700, 3000), .08), 2.0), .6, loop=True)
    keep("fire", loop(to_rms(grains(bandpass(kit["kch"], 900, 6000), 2.4, .05, 34, .5), .05) + to_rms(lowpass(hiss, 500), .03), 2.0), .7, loop=True)

    # ---- the ladder: a rung, and the blow at its foot
    keep("rung", to_rms(fade(kit["t"][:int(.05 * SR)], .0005, .03), .12), .8)
    blow = to_rms(fade(kit["K"][:int(.2 * SR)], .001, .12), .16)
    blow[:int(.16 * SR)] += to_rms(fade(lowpass(kit["B"], 300)[:int(.16 * SR)], .001, .1), .16)
    keep("clang", fade(comb(np.concatenate((blow, np.zeros(int(.35 * SR)))), 410, .82), .001, .25), .9)

    # ---- the flight: a high "oo", whistled
    whistle = held("whistle", "oo", 93, 1.8, "female", pressure=7, tension=.92, roughness=0)
    keep("whistle", loop(to_rms(bandpass(whistle, 1200, 5000), .07), 1.6), .5, loop=True)

    # ---- brick: the rim, the shaft, the yard, the stack
    tonk = np.concatenate((to_rms(fade(lowpass(kit["K"], 1500)[:int(.12 * SR)], .001, .08), .2), np.zeros(int(.5 * SR))))
    keep("rim", fade(comb(tonk, 240, .86), .001, .3), .9)
    keep("shaft", fade(comb(vari(tonk, .7), 150, .8), .001, .3), .9)
    thud = to_rms(fade(lowpass(kit["B"], 210)[:int(.3 * SR)], .001, .2), .22)
    keep("thud", thud, .9)
    fall = np.concatenate((thud, np.zeros(int(1.0 * SR))))
    for t in (.12, .2, .31, .44, .52, .7, .95):
        g = to_rms(fade(vari(lowpass(kit["K"], 2200)[:int(.06 * SR)], rng.uniform(.7, 1.2)), .0005, .04), rng.uniform(.03, .09))
        i = int(t * SR)
        fall[i:i + len(g)] += g
    keep("bricks", fall, .9)

    # ---- the chimney taking it: a kick down a pipe, a falling "oh" after it, soot
    drop = sung("drop", [("oh", 12, .25), ("~", 5, .35), ("~", -4, .5), ("~", -12, .7)], 43, pressure=9, tension=.5, roughness=.2)
    n = int(3.2 * SR)
    foomp = np.zeros(n)
    k = to_rms(fade(lowpass(kit["B"], 180)[:int(.35 * SR)], .001, .25), .3)
    foomp[:len(k)] += k
    d = to_rms(lowpass(drop, 900), .09)
    a = int(.12 * SR)
    foomp[a:a + len(d)] += d[:n - a]
    for t in (.5, .78, 1.0, 1.3, 1.52, 1.9):
        g = to_rms(fade(lowpass(kit["K"], 1400)[:int(.07 * SR)], .0005, .05), .07 * (2.2 - t) / 2)
        i = int(t * SR)
        foomp[i:i + len(g)] += g
    soot = to_rms(fade(lowpass(hiss[:int(1.4 * SR)], 1600), .05, 1.1), .06)
    foomp[int(.3 * SR):int(.3 * SR) + len(soot)] += soot
    keep("in", fade(echo(comb(foomp, 62, .7), .13, .5, 5)[:int(3.8 * SR)], .001, .6), 1.)

    # ---- the men
    said = {}
    for row in (HERE / "lines.txt").read_text().splitlines():
        row = row.strip()
        if row and not row.startswith("#"):
            who, _, rest = row.partition(".")
            slot, _, text = rest.partition(":")
            said[slot.strip()] = (who.strip(), text.strip())
    for slot, (who, text) in said.items():
        if who == "all":
            # the three of them shout it together: the same words from each throat, not quite in step
            mix = np.zeros(1)
            for i, (name, late) in enumerate((("holder", 0.), ("driver", .05), ("ladder", .11))):
                v = VOICES[name]
                engine("text", TAKES / f"{slot}-{name}", text, v["body"], "--f0", v["f0"] * 1.12, "--force", "14.5:.76:.03", "--rate", 1.02, "--glide", "1.3:.86")
                x = to_rms(sounding(wav(TAKES / f"{slot}-{name}.wav"), .01, .03), .1)
                if name == "ladder":
                    x = echo(lowpass(x, 3600), .09, .3, 2)[:len(x) + int(.35 * SR)]
                pad = int(late * SR)
                both = np.zeros(max(len(mix), pad + len(x)))
                both[:len(mix)] += mix
                both[pad:pad + len(x)] += x * (.8 if i else 1.)
                mix = both
            # his is the mouth that is seen saying it
            keep(slot, fade(mix, .004, .08), 1., who="holder", text=text, env=envelope(mix))
            continue
        v = VOICES[who]
        engine("text", TAKES / slot, text, v["body"], "--f0", v["f0"], "--force", v["force"], "--rate", v["rate"], "--glide", "1.25:.82")
        x = to_rms(sounding(wav(TAKES / f"{slot}.wav"), .01, .03), .12)
        more = {"who": who, "text": text}
        if who == "holder":
            more["env"] = envelope(x)
        if who == "ladder":
            x = echo(lowpass(x, 3200), .09, .3, 2)             # he is thirty metres off, in front of a wall
        keep(slot, fade(x, .004, .04), .55 if who == "ladder" else 1., **more)

    # ---- everybody at once: a cheer, and the sound of nearly
    def crowd(name, cries, seconds):
        out = np.zeros(int(seconds * SR))
        for i, (at, score, base, body) in enumerate(cries):
            x = to_rms(sung(f"{name}{i}", score, base, body, pressure=14, tension=.7, roughness=.2), .1)
            j = int(at * SR)
            out[j:j + len(x)] += x[:len(out) - j]
        wet = echo(out, .11, .4, 3)
        wet[:len(out)] = wet[:len(out)] * .25 + out
        keep(name, fade(wet[:len(out) + int(.3 * SR)], .005, .3), 1.)
    crowd("cheer", [
        (0, [("yeah", 7, .3), ("~", 10, .5), ("~", 5, .4)], 50, "male"),
        (.15, [("woo", 12, .3), ("~", 19, .6), ("~", 14, .5)], 55, "male"),
        (.4, [("hey", 9, .2), ("hey", 9, .2), ("hey", 12, .5)], 47, "male"),
        (.9, [("woo", 15, .5), ("~", 22, .7)], 57, "female"),
        (1.3, [("yeah", 5, .25), ("yeah", 9, .25), ("yeah", 12, .7)], 52, "male"),
        (1.9, [("hey", 12, .3), ("~", 16, .6), ("~", 9, .4)], 49, "male"),
    ], 3.6)
    crowd("groan", [
        (0, [("oh", 7, .3), ("~", 3, .5), ("~", -3, .7)], 48, "male"),
        (.12, [("aw", 5, .4), ("~", 0, .5), ("~", -5, .6)], 43, "male"),
        (.3, [("no", 9, .3), ("~", 2, .8)], 52, "male"),
    ], 2.0)
    crowd("yelp", [(0, [("ah", 14, .15), ("~", 19, .2), ("~", 9, .35)], 52, "male")], .9)

    (SHOW / "kiln.json").write_text(json.dumps({"clips": clips}, indent=1))
    print("written to", SHOW)


def centroid(x):
    s = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return float((s * f).sum() / max(s.sum(), 1e-9))


if __name__ == "__main__":
    main()
