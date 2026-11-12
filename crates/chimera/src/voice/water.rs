//! Water in the airway, and what else can be done to a throat: the Jug show's model, and the
//! interrogation game's (`?tell`), where it runs live. A voice without one (`HumanVoice::water`
//! is `None`) is exactly the voice it was.
//!
//! Water poured into the mouth of a head tipped back runs to the lowest point, the larynx, and
//! fills the tract from there upward, section by section. What that does to the voice:
//!
//!  - **Less air.** In a flooded section the gas keeps only a narrow way of its own up through
//!    the water, the same whatever the tongue is doing there, so what the mouth shapes stops
//!    shaping the sound; the air the water displaces leaves through the mouth.
//!  - **A liquid valve.** Where water spans the lumen nothing passes until the pressure under it
//!    beats the weight of the column: its depth in cm is the pressure it needs in cmH2O, the unit
//!    lung pressure is given in. Then a bubble pushes through, the water falls shut behind it, and
//!    the pressure builds again. Deeper than the lungs are pushing and nothing comes out at all.
//!  - **Pushing.** A speaker who gets nothing out pushes harder, up to a few times the pressure of
//!    speech, and eases off when air moves again.
//!  - **Bubbles ring.** Each one that breaks the surface is a small resonator (Minnaert: radius
//!    times frequency is about 326 cm Hz) and is put into the tract as a volume source, as are the
//!    stream landing in the mouth and the small bubbles it carries in.
//!  - **Wet folds.** Water on the vocal folds is mass: the pitch drops and the cycles turn uneven.
//!  - **Reflexes.** Water leaks past the folds whenever no air is coming up to hold it (Torricelli:
//!    √(2g·depth) through the glottal area). Enough of it and the body coughs: the glottis shuts,
//!    the lungs press, the glottis flies open and part of the pool goes out with the blast. A full
//!    throat swallows, which stops everything for a third of a second. A throat that stays full
//!    to the brim gags: the pharynx clamps and the chest heaves against it, voiced and low.
//!  - **Air hunger.** All the while he cannot breathe, the need to builds. Once the airway is
//!    clear enough he gasps: the chest pulls, the folds stand apart, and air (and whatever water
//!    is still on the folds) goes in. That is how a cough follows a gasp.
//!  - **Injuries.** Split, swollen lips open less; a jaw that has been hit opens less; a broken
//!    nose is shut; pulled front teeth take away what a hiss is made against; and blood in the
//!    mouth is more liquid in the airway, with everything above.
//!  - **Raw folds.** Every cough and gag, and the water that got past, leaves the folds swollen
//!    for a long while after: they close badly, leak air and beat unevenly. That is the rasp.

use super::human_airway::HumanAirway;
use crate::airway::network::AirwayNetwork;
use crate::math::{PI, Rng, TAU, cbrt, clamp, cos, exp, js_max, js_min, sin, smoothstep, sqrt};
use crate::physics::CM_H2O;

/// the gas's own way up through a flooded section (cm² at an adult male's size)
const GAS: f64 = 0.45;
/// how much harder than speech the lungs will push against a blocked throat (×(1 + this))
pub const PUSH: f64 = 2.6;
const RINGS: usize = 28;
/// values in a log row (see `Water::log`)
pub const LOG_ROW: usize = 18;
/// values in `Water::state`: volume, surface, depth, channel, bubbles so far, entering, spilling,
/// coughed out, cough phase, swallowing, gagging, gasping, rawness, air hunger, push, tilt,
/// lips, jaw, nose, teeth, bleeding
pub const STATE: usize = 21;

#[derive(Clone, Copy, Debug)]
pub struct WaterKey {
    /// voice clock (s)
    pub t: f64,
    /// water arriving at the lips (cm³/s)
    pub pour: f64,
    /// how far the head is tipped back from upright (degrees, 0..90)
    pub tilt: f64,
}

#[derive(Clone, Copy, Debug, Default)]
struct Ring {
    node: usize,
    phase: f64,
    step: f64,
    amp: f64,
    decay: f64,
}

#[derive(Clone, Debug)]
pub struct Water {
    keys: Vec<WaterKey>,
    /// with no track: what is being done now (the game sets these), followed at a hand's speed
    pub pour_in: f64,
    pub tilt_in: f64,
    pour_now_in: f64,
    tilt_now: f64,
    /// injuries, each 0..1: lips and jaw swollen, nose shut, front teeth gone
    pub lip: f64,
    pub jaw: f64,
    pub nose: f64,
    pub teeth: f64,
    /// blood running into the mouth (cm³/s); it slows by itself
    pub bleed: f64,
    teeth_gain: f64,
    /// this control step's state, for whoever is drawing it (see `STATE`)
    pub state: [f64; STATE],
    bubbles_total: f64,
    /// coughing and swallowing
    pub reflexes: bool,
    /// water in the tract (cm³)
    pub volume: f64,
    frac: Vec<f64>,
    wet_ph: Vec<f64>,
    wet_or: Vec<f64>,
    wmin_ph: Vec<f64>,
    wmin_or: Vec<f64>,
    // the liquid valve
    open: bool,
    a_ch: f64,
    a_goal: f64,
    state_t: f64,
    shut_for: f64,
    p_open: f64,
    v_bubble: f64,
    passed: f64,
    below: usize,
    above: usize,
    branch: usize,
    // means over a control block
    dp_acc: f64,
    dps_acc: f64,
    u_acc: f64,
    dpg_acc: f64,
    ag_acc: f64,
    n_acc: f64,
    // sources
    rings: [Ring; RINGS],
    next_ring: usize,
    fs: f64,
    n_hp: f64,
    n_lp: f64,
    hp_c: f64,
    lp_c: f64,
    pour_amp: f64,
    pour_now: f64,
    pour_node: usize,
    flut: f64,
    rng: Rng,
    // reflexes
    aspirated: f64,
    cough_t: f64,
    cough_p: f64,
    cough_again: bool,
    cough_rest: f64,
    swallow_t: f64,
    swallow_rest: f64,
    /// time since water last came in (s)
    since_pour: f64,
    gasp_t: f64,
    gasp_rest: f64,
    /// 0..1: how badly he needs a breath
    pub hunger: f64,
    gag_t: f64,
    gag_p: f64,
    gag_rest: f64,
    /// how long the throat has been full to the brim (s)
    flooded_for: f64,
    /// 0..1: how hard he is pushing against a blocked throat, beyond the pressure of speech
    pub push: f64,
    /// 0..1: how raw the folds are (coughs, gags and aspirated water add; it heals over a minute)
    pub sore: f64,
    /// what the voice tells the water each control step: how hard it is trying to breathe out
    /// (its gate, 0..1) and the lung pressure it is applying (cmH2O)
    pub trying: f64,
    pub lungs: f64,
    /// a reflex's own phonation: fry (0..1), and whether the folds are held together to sound
    pub fry: f64,
    pub voiced: bool,
    squeeze: f64,
    /// the airway's own aspiration-noise gain (a cough's blast raises it)
    hiss: f64,
    /// what the voice takes from the water each control step
    pub wet_folds: f64,
    pub closure: f64,
    pub abduct: f64,
    /// lung pressure a reflex asks for (cmH2O) and how far it overrides the breath (0..1)
    pub pressure: f64,
    pub pressure_mix: f64,
    /// rows of `LOG_ROW` values every 10 ms: t, volume, surface (cm along the tract from the
    /// glottis), depth (cm of water over the glottis), channel area (cm², -1 with no valve),
    /// bubbles since the last row, water entering (cm³/s), spilling, coughed out, cough phase
    /// (0 none, 1 pressing, 2 blast, 3 after), swallowing, tilt, the biggest bubble (cm³), gagging,
    /// how raw the folds are (0..1), lung pressure (cmH2O), gasping, air hunger (0..1)
    pub log: Vec<f32>,
    next_log: f64,
    bursts: f64,
    biggest: f64,
    spill: f64,
    spray: f64,
    enter: f64,
}

impl Water {
    pub fn new(fs: f64, aw: &HumanAirway, mut keys: Vec<WaterKey>, init: f64, sore: f64, hunger: f64, reflexes: bool, seconds: f64) -> Self {
        keys.sort_by(|a, b| a.t.total_cmp(&b.t));
        let (n_ph, n_or) = (aw.n_ph, aw.n_or);
        Water {
            keys,
            pour_in: 0.0,
            tilt_in: 0.0,
            pour_now_in: 0.0,
            tilt_now: 0.0,
            lip: 0.0,
            jaw: 0.0,
            nose: 0.0,
            teeth: 0.0,
            bleed: 0.0,
            teeth_gain: aw.noise_gain.teeth,
            state: [0.0; STATE],
            bubbles_total: 0.0,
            reflexes,
            volume: init,
            frac: vec![0.0; n_ph + n_or],
            wet_ph: vec![0.0; n_ph],
            wet_or: vec![0.0; n_or],
            wmin_ph: vec![0.0; n_ph],
            wmin_or: vec![0.0; n_or],
            open: true,
            a_ch: 9.0,
            a_goal: 0.3,
            state_t: 0.0,
            shut_for: 0.01,
            p_open: 1.0,
            v_bubble: 1.0,
            passed: 0.0,
            below: aw.pharynx.node(0),
            above: aw.pharynx.node(1),
            branch: aw.pharynx.branch(0),
            dp_acc: 0.0,
            dps_acc: 0.0,
            u_acc: 0.0,
            dpg_acc: 0.0,
            ag_acc: 0.0,
            n_acc: 0.0,
            rings: [Ring::default(); RINGS],
            next_ring: 0,
            fs,
            n_hp: 0.0,
            n_lp: 0.0,
            hp_c: 1.0 - exp(-TAU * 700.0 / fs),
            lp_c: 1.0 - exp(-TAU * 5200.0 / fs),
            pour_amp: 0.0,
            pour_now: 0.0,
            pour_node: aw.oral.node(n_or / 2),
            flut: 0.0,
            rng: Rng::new(90210),
            aspirated: 0.0,
            cough_t: -1.0,
            cough_p: 0.0,
            cough_again: false,
            cough_rest: 0.25,
            swallow_t: -1.0,
            swallow_rest: 0.4,
            since_pour: 0.0,
            gasp_t: -1.0,
            gasp_rest: 0.3,
            hunger,
            gag_t: -1.0,
            gag_p: 0.0,
            gag_rest: 0.8,
            flooded_for: 0.0,
            push: 0.0,
            sore,
            trying: 0.0,
            lungs: 0.0,
            fry: 0.0,
            voiced: false,
            squeeze: 0.0,
            hiss: aw.noise_gain.glottis,
            wet_folds: 0.0,
            closure: 0.0,
            abduct: 0.0,
            pressure: 0.0,
            pressure_mix: 0.0,
            log: Vec::with_capacity(LOG_ROW * (seconds * 100.0 + 16.0) as usize),
            next_log: 0.0,
            bursts: 0.0,
            biggest: 0.0,
            spill: 0.0,
            spray: 0.0,
            enter: 0.0,
        }
    }

    /// A throat to be acted on live: no track, no log, nothing in it yet.
    pub fn live(fs: f64, aw: &HumanAirway) -> Self {
        Self::new(fs, aw, Vec::new(), 0.0, 0.0, 0.0, true, 0.0)
    }

    /// (pour, tilt) at voice time t
    fn at(&self, t: f64) -> (f64, f64) {
        let k = &self.keys;
        if k.is_empty() {
            return (0.0, 0.0);
        }
        if t <= k[0].t {
            return (k[0].pour, k[0].tilt);
        }
        for w in k.windows(2) {
            if t < w[1].t {
                let u = (t - w[0].t) / js_max(1e-9, w[1].t - w[0].t);
                return (w[0].pour + (w[1].pour - w[0].pour) * u, w[0].tilt + (w[1].tilt - w[0].tilt) * u);
            }
        }
        let l = k[k.len() - 1];
        (l.pour, l.tilt)
    }

    /// A bubble of `v` cm³ rings at `node`.
    fn ring(&mut self, node: usize, v: f64, amp: f64, q: f64) {
        let r = cbrt(3.0 * v / (4.0 * PI));
        let f = js_min(326.0 / js_max(r, 0.03), 0.2 * self.fs);
        let i = self.next_ring;
        self.next_ring = (i + 1) % RINGS;
        self.rings[i] = Ring { node, phase: 0.0, step: f / self.fs, amp, decay: exp(-PI * f / (q * self.fs)) };
    }

    /// Once per internal sample, before the network steps.
    #[inline]
    pub fn tick(&mut self, net: &mut AirwayNetwork, dp_glottis: f64, a_glottis: f64) {
        // the air under the folds against the air over the water
        let over = net.p[self.below] - net.p[self.above];
        self.dps_acc += over;
        self.dp_acc += dp_glottis + over;
        self.u_acc += net.u[self.branch];
        self.dpg_acc += dp_glottis;
        self.ag_acc += a_glottis;
        self.n_acc += 1.0;
        self.pour_now += (self.pour_amp - self.pour_now) * 0.0006;
        if self.pour_now > 1e-4 {
            let w = self.rng.bipolar();
            self.n_hp += self.hp_c * (w - self.n_hp);
            self.n_lp += self.lp_c * (w - self.n_hp - self.n_lp);
            net.ext_flow[self.pour_node] += self.pour_now * self.n_lp;
        }
        for r in self.rings.iter_mut() {
            if r.amp > 1e-3 {
                net.ext_flow[r.node] += r.amp * sin(TAU * r.phase);
                r.phase += r.step;
                if r.phase >= 1.0 {
                    r.phase -= 1.0;
                }
                r.amp *= r.decay;
            }
        }
    }

    /// Once per control step, after the airway has its dry targets and before the block begins.
    pub fn control(&mut self, aw: &mut HumanAirway, t: f64, dt: f64) {
        let k = aw.body.scale;
        let (k2, k3) = (k * k, k * k * k);
        let (n_ph, n_or) = (aw.n_ph, aw.n_or);
        let n = n_ph + n_or;
        let (pour, tilt) = if self.keys.is_empty() {
            // live: the jug and the hand in his hair move at a hand's speed
            self.tilt_now += clamp(self.tilt_in - self.tilt_now, -150.0 * dt, 150.0 * dt);
            self.pour_now_in += clamp(self.pour_in - self.pour_now_in, -300.0 * dt, 300.0 * dt);
            (self.pour_now_in, self.tilt_now)
        } else {
            self.at(t)
        };
        let (st, ct) = (sin(tilt * PI / 180.0), cos(tilt * PI / 180.0));
        let node = |aw: &HumanAirway, g: usize| if g < n_ph { aw.pharynx.node(g) } else { aw.oral.node(g - n_ph) };

        // what the block just rendered did
        let inv = 1.0 / js_max(1.0, self.n_acc);
        let dp = self.dp_acc * inv / CM_H2O;
        self.dps_acc = 0.0;
        let flow = self.u_acc * inv;
        let dpg = self.dpg_acc * inv / CM_H2O;
        let ag = self.ag_acc * inv;
        (self.dp_acc, self.u_acc, self.dpg_acc, self.ag_acc, self.n_acc) = (0.0, 0.0, 0.0, 0.0, 0.0);

        // water in: only through open lips, and little of it during a swallow
        let lips = aw.or_areas[n_or - 1];
        let enter = pour * smoothstep(0.08 * k2, 0.5 * k2, lips) * (if self.swallow_t >= 0.0 { 0.35 } else { 1.0 });
        self.volume += enter * dt;
        self.enter = enter;
        // blood: what does not run out of an upright mouth goes down the throat
        self.volume += self.bleed * (0.3 + 0.7 * st) * dt;
        self.bleed *= exp(-dt / 9.0);
        aw.noise_gain.teeth = self.teeth_gain * (1.0 - 0.92 * self.teeth);
        self.since_pour = if enter > 0.5 { 0.0 } else { self.since_pour + dt };
        // a film left on the walls drains away by itself, slowly
        self.volume = js_max(0.0, self.volume - 0.05 * dt);

        // fill from the larynx upward
        let (dxp, dxo) = (aw.ph_len / n_ph as f64, aw.or_len / n_or as f64);
        let mut left = self.volume;
        let (mut depth, mut surface, mut capacity) = (0.0, 0.0, 0.0);
        let mut top = 0usize;
        for g in 0..n {
            let (a, dx, rise) = if g < n_ph { (aw.ph_areas[g], dxp, ct) } else { (aw.or_areas[g - n_ph], dxo, st) };
            // the lips' own section never floods: water over the brim runs out of the mouth
            // and the mouth is a basin only while the head is tipped back
            let basin = if g < n_ph { 1.0 } else { smoothstep(0.14, 0.6, st) };
            let cap = if g == n - 1 { 0.0 } else { (a - js_min(a, GAS * k2)) * dx * basin };
            capacity += cap;
            let w = js_min(cap, left);
            left -= w;
            let f = if cap > 1e-6 { w / cap } else if left > 0.0 && g < n - 1 { 1.0 } else { 0.0 };
            self.frac[g] = f;
            if f > 0.0 {
                top = g;
                depth += dx * f * rise;
                surface += dx * f;
            }
        }
        // what the tract cannot hold runs out of the mouth
        self.spill = js_max(0.0, left) / dt;
        self.volume -= js_max(0.0, left);
        // a flooded section is water that gas crosses only as bubbles; the one the surface is in
        // joins as it fills
        let front = smoothstep(0.3, 0.9, self.frac[top]);
        let bridged = if top == 0 { front } else { 1.0 };
        let wet = smoothstep(0.0, 0.8, self.volume);
        self.wet_folds = wet;

        // reflexes
        self.closure = 0.0;
        self.abduct = 0.0;
        self.pressure_mix = 0.0;
        self.spray = 0.0;
        self.fry = 0.0;
        self.voiced = false;
        self.squeeze = 0.0;
        let mut cough_phase = 0.0;
        let mut gagging = 0.0;
        let mut gasping = 0.0;
        let mut inhaling = false;
        aw.noise_gain.glottis = self.hiss;
        // nothing is getting out, and he is trying: the chest pushes harder; it eases when air moves
        let blocked = bridged > 0.5 && flow < 25.0;
        let busy = self.cough_t >= 0.0 || self.swallow_t >= 0.0 || self.gag_t >= 0.0 || self.gasp_t >= 0.0;
        // no breath to be had under water, or in the middle of a cough
        if self.volume > 2.0 * k3 || (busy && self.gasp_t < 0.0) {
            self.hunger = js_min(1.0, self.hunger + 0.16 * dt);
        }
        self.push = clamp(self.push + dt * (if self.trying > 0.3 && !busy { if blocked { 3.0 } else { -0.6 } } else { -1.5 }), 0.0, 1.0);
        self.sore *= exp(-dt / 120.0);
        if self.reflexes {
            // the throat full to the brim, and staying so
            self.flooded_for = if self.volume > 0.7 * capacity || self.spill > 0.0 { self.flooded_for + dt } else { js_max(0.0, self.flooded_for - 0.5 * dt) };
            // air coming up holds the water off the folds; without it the pool leaks through them
            let held = smoothstep(0.5, 2.0, dpg);
            let leak = dt * 44.3 * sqrt(js_max(depth, 0.05)) * ag * (1.0 - held) * wet;
            let leak = js_min(leak, self.volume);
            self.volume -= leak; // it has gone down the wrong way
            self.aspirated += leak;
            self.sore = js_min(1.0, self.sore + 0.0015 * leak);
            self.aspirated *= exp(-dt / 2.0);
            if self.cough_t >= 0.0 {
                let c = self.cough_t;
                self.pressure = self.cough_p;
                self.pressure_mix = 1.0;
                if c < 0.09 {
                    cough_phase = 1.0;
                    self.closure = 1.0;
                    self.pressure = self.cough_p * smoothstep(0.0, 0.09, c);
                } else if c < 0.25 {
                    cough_phase = 2.0;
                    if c - dt < 0.09 {
                        self.sore = js_min(1.0, self.sore + 0.05);
                    }
                    let u = (c - 0.09) / 0.16;
                    self.abduct = 0.42 * sin(PI * js_min(1.0, 0.1 + u));
                    self.pressure = self.cough_p * exp(-1.3 * u);
                    // the blast: far more turbulence at the folds than speech ever makes
                    aw.noise_gain.glottis = self.hiss * (1.0 + 45.0 * sin(PI * js_min(1.0, 0.1 + u)));
                    let out = self.volume * (1.0 - exp(-dt * 3.4));
                    self.volume -= out;
                    self.spray = out / dt;
                } else if c < 0.36 {
                    cough_phase = 3.0;
                    self.pressure = self.cough_p * exp(-1.3);
                    self.pressure_mix = 1.0 - (c - 0.25) / 0.11;
                } else {
                    self.aspirated = 0.0;
                    self.pressure_mix = 0.0;
                    if self.cough_again {
                        self.cough_again = false;
                        self.cough_p *= 0.8;
                        self.cough_t = -dt; // the second one follows at once
                    } else {
                        self.cough_t = -1.0 - dt;
                        self.cough_rest = 0.9 + 1.0 * self.rng.next();
                    }
                }
                self.cough_t += dt;
            } else if self.gag_t >= 0.0 {
                // a retch: shut, press, then heave against a clamped pharynx with the folds together
                let g = self.gag_t;
                gagging = 1.0;
                self.pressure = self.gag_p;
                self.pressure_mix = 1.0;
                if g < 0.1 {
                    self.closure = 1.0;
                    self.pressure = self.gag_p * smoothstep(0.0, 0.1, g);
                } else if g < 0.52 {
                    let u = (g - 0.1) / 0.42;
                    self.voiced = true;
                    self.fry = 0.85;
                    self.squeeze = 0.55 * sin(PI * u);
                    self.pressure = self.gag_p * (1.0 - 0.6 * u);
                    let out = self.volume * (1.0 - exp(-dt * 0.9));
                    self.volume -= out;
                    self.spray = out / dt;
                    if g - dt < 0.1 {
                        self.sore = js_min(1.0, self.sore + 0.05);
                    }
                } else {
                    self.pressure = self.gag_p * 0.4;
                    self.pressure_mix = js_max(0.0, 1.0 - (g - 0.52) / 0.1);
                }
                self.gag_t = if g >= 0.62 { -1.0 } else { g + dt };
                if self.gag_t < 0.0 {
                    self.gag_rest = 1.1 + 1.3 * self.rng.next();
                    self.flooded_for = 0.0;
                }
            } else if self.gasp_t >= 0.0 {
                // a gasp: the chest pulls air in through folds held apart, then lets a little go
                let g = self.gasp_t;
                gasping = 1.0;
                self.pressure_mix = 1.0;
                if g < 0.5 {
                    let u = sin(PI * g / 0.5);
                    inhaling = true;
                    self.pressure = -(8.0 + 8.0 * self.hunger) * u;
                    self.abduct = 0.16 + 0.1 * u;
                    aw.noise_gain.glottis = self.hiss * (1.0 + 10.0 * u);
                    self.hunger = js_max(0.0, self.hunger - 0.7 * dt);
                } else if g < 0.78 {
                    let u = sin(PI * (g - 0.5) / 0.28);
                    self.pressure = 5.0 * u;
                    self.abduct = 0.2;
                    aw.noise_gain.glottis = self.hiss * (1.0 + 5.0 * u);
                } else {
                    self.pressure_mix = 0.0;
                }
                self.gasp_t = if g >= 0.8 { -1.0 } else { g + dt };
                if self.gasp_t < 0.0 {
                    self.gasp_rest = 0.12 + 0.2 * self.rng.next();
                }
            } else if self.swallow_t >= 0.0 {
                let s = self.swallow_t;
                self.closure = 1.0;
                if s > 0.12 {
                    // down the gullet, all but a film that only a cough shifts
                    self.volume -= js_min(js_max(0.0, self.volume - 0.5 * k3), 16.0 * k3 / 0.22 * dt);
                }
                self.swallow_t = if s >= 0.34 { -1.0 } else { s + dt };
                if self.swallow_t < 0.0 {
                    self.swallow_rest = 0.6 + 0.6 * self.rng.next();
                }
            } else {
                self.cough_rest -= dt;
                self.swallow_rest -= dt;
                self.gag_rest -= dt;
                self.gasp_rest -= dt;
                if self.aspirated > 0.1 && self.cough_rest <= 0.0 {
                    self.cough_t = 0.0;
                    self.cough_p = 30.0 + 16.0 * self.rng.next();
                    self.cough_again = self.rng.next() < 0.45;
                } else if self.flooded_for > 0.4 && self.gag_rest <= 0.0 {
                    self.gag_t = 0.0;
                    self.gag_p = 28.0 + 10.0 * self.rng.next();
                } else if (self.volume > 15.0 * k3 || (self.volume > 1.2 * k3 && self.since_pour > 0.5)) && self.swallow_rest <= 0.0 {
                    self.swallow_t = 0.0;
                    // the gulp: one big low bubble as the pharynx closes on the water
                    let at = node(aw, (top + 1).min(n - 2));
                    self.ring(at, 5.0 * k3, 14.0 * k2, 5.0);
                } else if self.hunger > 0.3 && self.volume < 6.0 * k3 && self.trying < 0.3 && self.gasp_rest <= 0.0 {
                    self.gasp_t = 0.0;
                }
            }
        }

        self.above = node(aw, (top + 1).min(n - 1));
        if bridged < 0.02 {
            self.open = true;
            self.a_ch = 9.0;
            self.state_t = 0.0;
            aw.net.bias = 0.0;
        } else {
            if self.a_ch > 2.0 {
                self.a_ch = 0.5 * k2; // water has just closed over the lumen
            }
            // air going up through the water lifts it: the column's weight stands against the flow
            aw.net.bias_branch = self.branch;
            aw.net.bias = if inhaling { 0.0 } else { -depth * CM_H2O * bridged };
            let drive = dp - depth * bridged;
            self.state_t += dt;
            if cough_phase == 2.0 || inhaling {
                // a cough's blast holds its way through the water open; so does a breath dragged in
                self.open = true;
                self.passed = 0.0;
                self.state_t = 0.0;
                self.a_goal = 1.3 * k2;
                self.v_bubble = 3.0 * k3;
            }
            if self.open {
                self.passed += js_max(0.0, flow) * dt;
                if self.passed >= self.v_bubble || (flow < 0.0 && self.state_t > 0.004 && !inhaling) || self.state_t > 0.12 || self.swallow_t >= 0.0 {
                    // the water falls shut behind the bubble
                    self.open = false;
                    self.state_t = 0.0;
                    self.shut_for = 0.008 + 0.02 * self.rng.next() + 0.003 * depth;
                    self.p_open = 0.25 + 0.65 * self.rng.next();
                }
            } else if self.state_t >= self.shut_for && drive > self.p_open && ag > 0.004 * k2 && self.swallow_t < 0.0 {
                // gas has come through the folds with more behind it than the water weighs
                self.open = true;
                self.state_t = 0.0;
                self.passed = 0.0;
                let (r1, r2, r3) = (self.rng.next(), self.rng.next(), self.rng.next());
                self.v_bubble = (1.2 + 6.0 * r1 * r2) * (1.0 + 0.15 * depth) * k3;
                self.a_goal = clamp(0.2 + 0.04 * drive, 0.15, 1.4) * k2 * (0.7 + 0.6 * r3);
                self.bursts += 1.0;
                self.bubbles_total += 1.0;
                self.biggest = js_max(self.biggest, self.v_bubble);
                let v = self.v_bubble;
                self.ring(self.above, v, 5.0 * k2 * cbrt(v * v) * clamp(drive / 2.0, 0.3, 2.0), 8.0);
            }
            let goal = if self.open { self.a_goal } else { 0.0 };
            let d = goal - self.a_ch;
            self.a_ch += clamp(d, -60.0 * k2 * dt, 80.0 * k2 * dt);
        }

        // the stream landing: hiss, and the small bubbles it carries under
        let land = (top + 1).max(n_ph + (n_or * 35) / 100).min(n - 1);
        self.pour_node = node(aw, land);
        self.pour_amp = 5.0 * k2 * sqrt(enter / 30.0);
        if enter > 0.0 && self.rng.next() < 2.2 * enter * dt {
            let r = 0.06 + 0.24 * self.rng.next() * self.rng.next();
            let amp = 9.0 * k2 * (r / 0.2) * (r / 0.2) * (0.5 + self.rng.next());
            self.ring(self.pour_node, 4.19 * r * r * r, amp, 9.0);
        }

        // the wet tract
        self.flut += (self.rng.next() - self.flut) * js_min(1.0, dt / 0.012);
        for g in 0..n {
            let (a, m) = if g < n_ph { (aw.ph_areas[g], aw.ph_min[g]) } else { (aw.or_areas[g - n_ph], aw.or_min[g - n_ph]) };
            let f = self.frac[g];
            // a retch clamps the middle of the pharynx
            let clamp_ = if g * 10 >= n_ph * 3 && g * 10 <= n_ph * 8 { 1.0 - self.squeeze } else { 1.0 };
            // injuries: a hit jaw will not open the front of the mouth far; swollen lips part less
            let mouth = g >= n_ph + (n_or * 2) / 5;
            let a = if mouth && self.jaw > 0.0 { js_min(a, a + (js_min(a, 1.3 * k2) - a) * self.jaw) } else { a };
            let lips_ = if g + 3 >= n { 1.0 - 0.6 * self.lip } else { 1.0 };
            let wa = (a - f * (a - js_min(a, GAS * k2))) * clamp_ * lips_;
            let mut wm = js_min(m * lips_, wa);
            if f > 0.0 && f < 1.0 {
                // a loose surface in the airstream: it flaps
                wm *= 1.0 - 0.5 * f * (1.0 - f) * 4.0 * self.flut;
            }
            if g <= top {
                wm += (js_min(wm, self.a_ch) - wm) * (if g == top { front } else { 1.0 });
            }
            if g < n_ph {
                self.wet_ph[g] = wa;
                self.wmin_ph[g] = wm;
            } else {
                self.wet_or[g - n_ph] = wa;
                self.wmin_or[g - n_ph] = wm;
            }
        }
        aw.net.set_tube_targets(aw.pharynx, &self.wet_ph, None, Some(&self.wmin_ph));
        aw.net.set_tube_targets(aw.oral, &self.wet_or, None, Some(&self.wmin_or));
        if self.nose > 0.0
            && let Some(port) = aw.frame.as_ref().map(|f| f.velum_port)
        {
            aw.net.set_port_target(aw.velum_port, port * (1.0 - self.nose));
        }
        // turbulence where the wet tract is narrowest
        core::mem::swap(&mut aw.ph_min, &mut self.wmin_ph);
        core::mem::swap(&mut aw.or_min, &mut self.wmin_or);
        aw.renoise();
        core::mem::swap(&mut aw.ph_min, &mut self.wmin_ph);
        core::mem::swap(&mut aw.or_min, &mut self.wmin_or);

        let ch = if bridged < 0.02 { -1.0 } else { self.a_ch };
        let swallowing = if self.swallow_t >= 0.0 { 1.0 } else { 0.0 };
        self.state = [self.volume, surface, depth, ch, self.bubbles_total, self.enter, self.spill, self.spray, cough_phase, swallowing, gagging, gasping, self.sore, self.hunger, self.push, tilt, self.lip, self.jaw, self.nose, self.teeth, self.bleed];
        if t >= self.next_log && self.log.len() + LOG_ROW <= self.log.capacity() {
            self.next_log += 0.01;
            self.log.extend([t, self.volume, surface, depth, ch, self.bursts, self.enter, self.spill, self.spray, cough_phase, swallowing, tilt, self.biggest, gagging, self.sore, self.lungs, gasping, self.hunger].map(|x| x as f32));
            self.bursts = 0.0;
            self.biggest = 0.0;
        }
    }
}
