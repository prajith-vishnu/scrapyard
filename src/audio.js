// All sounds are generated with the Web Audio API, no audio files.

let ctx = null;
let master = null;
let muted = localStorage.getItem('sy-muted') === '1';

// motor hum nodes, kept around while a fight is running
let motor = null;

function ensureCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
  }
  // browsers suspend audio until a user gesture
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noiseBuffer(seconds) {
  const c = ensureCtx();
  const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export const audio = {
  get muted() { return muted; },

  setMuted(m) {
    muted = m;
    localStorage.setItem('sy-muted', m ? '1' : '0');
    if (master) master.gain.value = m ? 0 : 1;
  },

  toggleMute() {
    this.setMuted(!muted);
    return muted;
  },

  // short filtered blip for buttons
  click() {
    const c = ensureCtx();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'square';
    o.frequency.value = 660;
    g.gain.setValueAtTime(0.06, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.06);
    o.connect(g).connect(master);
    o.start();
    o.stop(c.currentTime + 0.07);
  },

  hover() {
    const c = ensureCtx();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.02, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.04);
    o.connect(g).connect(master);
    o.start();
    o.stop(c.currentTime + 0.05);
  },

  // two looping noise layers, tuned high so it whirs instead of roars
  startMotor() {
    const c = ensureCtx();
    if (motor) this.stopMotor();

    const makeLayer = (freq, gain) => {
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(2);
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = freq;
      const g = c.createGain();
      g.gain.value = gain;
      src.connect(f).connect(g);
      src.start();
      return { src, f, g };
    };

    const low = makeLayer(260, 0.3);
    const mid = makeLayer(1200, 0.08);
    const out = c.createGain();
    out.gain.value = 0;
    low.g.connect(out);
    mid.g.connect(out);

    // fast wobble on the low layer so it sounds like straining gears
    const lfo = c.createOscillator();
    lfo.frequency.value = 11;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 60;
    lfo.connect(lfoGain).connect(low.f.frequency);
    lfo.start();

    out.connect(master);
    motor = { low, mid, out, lfo };
  },

  // called every frame with 0..1
  setMotorLevel(frac) {
    if (!motor || !ctx) return;
    const target = Math.max(0, Math.min(1, frac)) * 0.5;
    motor.out.gain.setTargetAtTime(target, ctx.currentTime, 0.1);
  },

  stopMotor() {
    if (!motor || !ctx) return;
    const m = motor;
    motor = null;
    m.out.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    setTimeout(() => {
      m.low.src.stop(); m.mid.src.stop(); m.lfo.stop();
    }, 600);
  },

  // metal-on-metal clank, louder and lower for bigger hits
  clank(dmg = 10) {
    const c = ensureCtx();
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(0.3);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 500 + Math.random() * 700;
    f.Q.value = 1.6;
    const g = c.createGain();
    g.gain.setValueAtTime(0.15 + Math.min(dmg / 120, 0.3), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    src.connect(f).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.3);

    if (dmg >= 30) {
      // heavy hits get a thump underneath
      const o = c.createOscillator();
      const og = c.createGain();
      o.frequency.setValueAtTime(95, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
      og.gain.setValueAtTime(0.3, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(og).connect(master);
      o.start(t);
      o.stop(t + 0.25);
    }
  },

  // bright little ping for callouts
  ping() {
    const c = ensureCtx();
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1150, t);
    o.frequency.exponentialRampToValueAtTime(1500, t + 0.07);
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.18);
  },

  // electric snap for the zapper: falling sawtooth plus a hiss
  zap() {
    const c = ensureCtx();
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(1700, t);
    o.frequency.exponentialRampToValueAtTime(280, t + 0.12);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.16);

    const src = c.createBufferSource();
    src.buffer = noiseBuffer(0.15);
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 3200;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.07, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(f).connect(ng).connect(master);
    src.start(t);
    src.stop(t + 0.15);
  },

  crash() {
    const c = ensureCtx();
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(1.4);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2500, t);
    f.frequency.exponentialRampToValueAtTime(80, t + 1.2);
    const g = c.createGain();
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    src.connect(f).connect(g).connect(master);
    src.start(t);
    src.stop(t + 1.4);
  },
};
