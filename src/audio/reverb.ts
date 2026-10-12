/**
 * Procedural stereo impulse response: decorrelated noise under an exponential
 * decay, progressively darkened (one-pole lowpass whose cutoff falls over the
 * tail) so the reverb sounds like air, not hiss. Seeded, so offline renders
 * are deterministic.
 */
export function makeImpulseResponse(
  ctx: BaseAudioContext,
  seconds: number,
  damping: number,
  seed = 7,
): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * Math.min(Math.max(seconds, 0.2), 10)));
  const buffer = ctx.createBuffer(2, len, rate);
  const predelay = Math.floor(rate * 0.018);
  const tau = seconds / 6.9; // −60 dB at `seconds`
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let s = (seed * 9301 + ch * 49297 + 1) >>> 0;
    let lp = 0;
    for (let i = predelay; i < len; i++) {
      // xorshift32 white noise
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      const white = (s / 4294967296) * 2 - 1;
      const t = (i - predelay) / rate;
      // the tail darkens: high damping → faster loss of highs
      const a = Math.min(0.97, 0.15 + damping * 0.8 * (t / seconds));
      lp = lp * a + white * (1 - a);
      const env = Math.exp(-t / tau);
      // short fade-in avoids a hard onset at the predelay
      const fade = Math.min(1, (i - predelay) / (rate * 0.004));
      data[i] = lp * env * fade;
    }
  }
  // normalise energy so different lengths sit at similar loudness
  let sum = 0;
  for (let ch = 0; ch < 2; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) sum += d[i] * d[i];
  }
  const norm = sum > 0 ? 1 / Math.sqrt(sum / 2) * 0.5 : 1;
  for (let ch = 0; ch < 2; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] *= norm;
  }
  return buffer;
}

/** One second of seeded white noise, reused for every pluck transient. */
export function makeNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 0.5);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buffer.getChannelData(0);
  let s = 22222;
  for (let i = 0; i < len; i++) {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    d[i] = (s / 4294967296) * 2 - 1;
  }
  return buffer;
}
