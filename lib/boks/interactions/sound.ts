/**
 * The sound an interaction makes.
 *
 * Synthesised, not sampled. Twelve scenes with recorded audio would be a
 * licensing question, a megabyte each, and a file that has to exist before the
 * scene can ship - the manifest already asks for a `bell.mp3` that nobody
 * made. An oscillator costs nothing, is always there, and can be tuned by
 * changing a number rather than by commissioning a recording.
 *
 * The palette is keyed to the mechanic, not to the story, which is the whole
 * point: a new boks that drags something gets the drag sound for free. Where a
 * piece genuinely needs its own voice - a specific bell, a specific bird - the
 * scene names a different profile, and a recorded file can be added later
 * behind the same call.
 *
 * Nothing here runs until a finger has touched the screen. `unlock` is called
 * from the pointer handler, because a browser will refuse an AudioContext that
 * nobody asked for, and because sound that starts on its own is a bug.
 */

export type SoundProfile =
  | "chime"
  | "bell"
  | "water"
  | "slide"
  | "paper"
  | "scrape"
  | "hum"
  | "tick"
  | "none";

type Ctx = AudioContext & { boksMaster?: GainNode };

let context: Ctx | null = null;
let muted = false;

export function setInteractionSoundMuted(value: boolean) {
  muted = value;
  if (context?.boksMaster) {
    context.boksMaster.gain.setTargetAtTime(value ? 0 : 1, context.currentTime, 0.02);
  }
}

export function interactionSoundMuted() {
  return muted;
}

/** Called from a real gesture. Safe to call on every press. */
export function unlockInteractionSound(): Ctx | null {
  if (typeof window === "undefined") return null;
  if (!context) {
    const Audio = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Audio) return null;
    try {
      context = new Audio() as Ctx;
    } catch {
      return null;
    }
    const master = context.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(context.destination);
    context.boksMaster = master;
  }
  if (context.state === "suspended") void context.resume().catch(() => {});
  return context;
}

function out(ctx: Ctx) {
  return ctx.boksMaster ?? ctx.destination;
}

/** A short burst of noise, reused by everything that is not a pitch. */
function noiseBuffer(ctx: Ctx, seconds: number) {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function partial(ctx: Ctx, frequency: number, gain: number, decay: number, type: OscillatorType = "sine") {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  const now = ctx.currentTime;
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(gain, now + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, now + decay);
  osc.connect(env);
  env.connect(out(ctx));
  osc.start(now);
  osc.stop(now + decay + 0.05);
}

function burst(ctx: Ctx, seconds: number, filter: BiquadFilterType, frequency: number, q: number, gain: number) {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, seconds);
  const band = ctx.createBiquadFilter();
  band.type = filter;
  band.frequency.value = frequency;
  band.Q.value = q;
  const env = ctx.createGain();
  const now = ctx.currentTime;
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(gain, now + seconds * 0.22);
  env.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
  source.connect(band);
  band.connect(env);
  env.connect(out(ctx));
  source.start(now);
  source.stop(now + seconds + 0.02);
}

/**
 * Play one. Volumes are deliberately low: this plays under a narrator's voice,
 * and an interaction that makes the reading harder to hear has cost more than
 * it gave.
 */
export function playInteractionSound(profile: SoundProfile) {
  if (profile === "none" || muted) return;
  const ctx = unlockInteractionSound();
  if (!ctx) return;

  switch (profile) {
    case "chime":
      // A lamp coming on: two partials, a soft fifth apart.
      partial(ctx, 784, 0.1, 1.1);
      partial(ctx, 1176, 0.045, 0.9);
      break;
    case "bell":
      // Inharmonic partials are what separates a bell from a beep.
      partial(ctx, 440, 0.12, 2.6);
      partial(ctx, 880, 0.07, 2.1);
      partial(ctx, 1324, 0.04, 1.6);
      partial(ctx, 1836, 0.025, 1.1);
      break;
    case "water": {
      // A drop: the pitch falls as the ring spreads.
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const now = ctx.currentTime;
      osc.type = "sine";
      osc.frequency.setValueAtTime(900, now);
      osc.frequency.exponentialRampToValueAtTime(260, now + 0.26);
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(0.11, now + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
      osc.connect(env);
      env.connect(out(ctx));
      osc.start(now);
      osc.stop(now + 0.45);
      break;
    }
    case "slide":
      // Wood and cloth moving: low, broad, no pitch.
      burst(ctx, 0.42, "bandpass", 420, 0.9, 0.075);
      break;
    case "paper":
      burst(ctx, 0.2, "highpass", 2200, 0.7, 0.055);
      break;
    case "scrape":
      // One grain. The caller repeats it while the finger moves.
      burst(ctx, 0.12, "bandpass", 3200, 1.6, 0.035);
      break;
    case "tick":
      burst(ctx, 0.05, "highpass", 4200, 0.8, 0.03);
      break;
    case "hum": {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const now = ctx.currentTime;
      osc.type = "sine";
      osc.frequency.value = 110;
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(0.055, now + 0.35);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
      osc.connect(env);
      env.connect(out(ctx));
      osc.start(now);
      osc.stop(now + 1.85);
      break;
    }
  }
}

/**
 * Should a repeating sound fire yet?
 *
 * Rubbing frost would otherwise schedule a grain per pointer event - over a
 * hundred a second on a good screen - which is both a wall of noise and real
 * work. Pure, so the spacing is tested rather than eyeballed.
 */
export function shouldRepeat(lastAt: number, now: number, everyMs: number) {
  return now - lastAt >= everyMs;
}

/* ───────────────────────────────────────────────────────────────────────────
   Sustained sounds

   The one-shots above answer a tap. These two answer a situation: a crowd is
   in the way until you move it, a heart beats for as long as you hold on. They
   run until stopped, and the caller is given the stopper rather than a handle
   to lose.
   ─────────────────────────────────────────────────────────────────────────── */

export type LoopProfile = "crowd" | "heartbeat";

/**
 * The two sustained sounds, and what they must be played at.
 *
 * Recordings, not oscillators. Three layers of synthesis got a heartbeat that
 * was recognisably a heartbeat and still sounded like a synthesiser, and no
 * amount of partials was going to fix that - a crowd especially is a thing you
 * record or do without.
 *
 * `gain` is measured rather than chosen, and the measurement that matters is
 * not the obvious one. Matching full-band RMS put the heart at the voice's
 * level and it was still inaudible, because a heart is almost entirely below
 * 300 Hz and a phone speaker does not reproduce that: 57% of the narration's
 * energy is above 300 Hz against 2% of the heartbeat's, a gap of 25 dB in the
 * only band a handset can actually move.
 *
 * Generating a brighter heartbeat did not work either - a real heart has no
 * mid-range to record - so `excite` says to make one. The thump is driven into
 * a soft clip, which turns a 60 Hz fundamental into harmonics at 120, 180, 240
 * and up, and a band-pass keeps the ones a small speaker can play. It is the
 * same trick phones use for bass. On headphones the body arrives as well and
 * the two read as one sound.
 *
 * The heart is also the third take by rhythm. The first was a correct
 * fifty-eight a minute and nobody could tell what it was: at rest, from
 * outside, a heart is too slow and too even to read as alive. This one runs at
 * eighty with genuinely uneven intervals.
 */
const loops: Record<LoopProfile, { src: string; gain: number; excite?: boolean }> = {
  crowd: { src: "/cinema/lion/moments/crowd.mp3", gain: 0.76 },
  // Louder than the voice on purpose: nothing else is playing while it does.
  heartbeat: { src: "/cinema/lion/moments/heartbeat.mp3", gain: 1, excite: true },
};

/** tanh, as a lookup table: soft clipping, which is what makes the harmonics. */
function saturationCurve(drive: number) {
  const size = 1024;
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x);
  }
  return curve;
}

/**
 * Start a sustained sound. The returned function stops it, and is safe to call
 * twice - which matters, because the gesture that ends one of these can end in
 * several ways and every one of them must leave silence.
 */
export function startInteractionLoop(profile: LoopProfile): () => void {
  if (typeof window === "undefined" || muted) return () => {};
  const { src, gain } = loops[profile];

  const element = new window.Audio(src);
  element.loop = true;
  element.preload = "auto";

  const ctx = unlockInteractionSound();
  let stop: () => void;

  if (ctx) {
    const source = ctx.createMediaElementSource(element);
    const volume = ctx.createGain();
    volume.gain.value = 0;

    if (loops[profile].excite) {
      // The body, for anyone on headphones.
      const body = ctx.createGain();
      body.gain.value = 0.9;
      source.connect(body);
      body.connect(volume);

      // And the harmonics of it, for everyone else.
      const isolate = ctx.createBiquadFilter();
      isolate.type = "lowpass";
      isolate.frequency.value = 180;
      const drive = ctx.createGain();
      drive.gain.value = 2.5;
      const shaper = ctx.createWaveShaper();
      shaper.curve = saturationCurve(12);
      shaper.oversample = "2x";
      const keep = ctx.createBiquadFilter();
      keep.type = "bandpass";
      keep.frequency.value = 620;
      keep.Q.value = 0.9;
      const excited = ctx.createGain();
      excited.gain.value = 0.9;
      source.connect(isolate);
      isolate.connect(drive);
      drive.connect(shaper);
      shaper.connect(keep);
      keep.connect(excited);
      excited.connect(volume);
    } else {
      source.connect(volume);
    }

    // Catches whatever the sum of the two paths peaks at, so a loud beat
    // cannot clip into a crackle.
    const safety = ctx.createDynamicsCompressor();
    safety.threshold.value = -6;
    safety.ratio.value = 8;
    safety.attack.value = 0.003;
    safety.release.value = 0.12;
    volume.connect(safety);
    safety.connect(out(ctx));
    // Up over a third of a second: a crowd that snaps on at full level is as
    // abrupt as the cut this whole thing exists to avoid.
    volume.gain.setTargetAtTime(gain, ctx.currentTime, 0.12);
    stop = () => {
      volume.gain.cancelScheduledValues(ctx.currentTime);
      volume.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
      window.setTimeout(() => {
        element.pause();
        try {
          source.disconnect();
          volume.disconnect();
          safety.disconnect();
        } catch {
          // Already torn down.
        }
      }, 420);
    };
  } else {
    // No Web Audio at all: play it plainly. The heart cannot be lifted above
    // the file's own level here, so it is quieter than intended rather than
    // missing.
    element.volume = Math.min(1, gain);
    stop = () => element.pause();
  }

  void element.play().catch(() => {
    // Refused - no gesture, or no codec. Silence is the correct failure.
  });

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    stop();
  };
}
