import { createRfftPlan, hanning, rfftFreqs, rfftMagnitude } from './fft.ts';

export interface VisualizerSignals {
  fps: number;
  nf: number;
  bass: Float32Array;
  vox: Float32Array;
  high: Float32Array;
  hit: Float32Array;
  energy: Float32Array;
  kick: Float32Array;
  snare: Float32Array;
}

export class Spring {
  k: number;
  c: number;
  x = 0.0;
  v = 0.0;

  constructor(k = 380.0, c = 11.0) {
    this.k = k;
    this.c = c;
  }

  step(imp: number, dt: number): number {
    const sub = dt / 3;
    for (let s = 0; s < 3; s++) {
      this.v += (-this.k * this.x - this.c * this.v) * sub;
      this.x += this.v * sub;
    }
    this.v += imp;
    return this.x;
  }
}

function percentile(arr: Float64Array, p: number): number {
  if (arr.length === 0) return 0;
  const sorted = Float64Array.from(arr).sort();
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function norm(x: Float64Array): Float64Array {
  const lo = percentile(x, 10);
  const hi = percentile(x, 97);
  const denom = hi - lo + 1e-9;
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = (x[i] - lo) / denom;
    out[i] = v < 0 ? 0 : v > 1.3 ? 1.3 : v;
  }
  return out;
}

function smooth(x: Float64Array, a = 0.6, r = 0.88): Float32Array {
  const out = new Float32Array(x.length);
  let v = 0;
  for (let i = 0; i < x.length; i++) {
    const t = x[i];
    v = t > v ? t * a + v * (1 - a) : v * r + t * (1 - r);
    out[i] = v;
  }
  return out;
}

export function resampleTo22050(mono: Float32Array, srcSr: number): Float32Array {
  const targetSr = 22050;
  if (srcSr === targetSr) return mono;
  const outLen = Math.max(1, Math.floor((mono.length * targetSr) / srcSr));
  const out = new Float32Array(outLen);
  const ratio = srcSr / targetSr;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = mono[idx] ?? 0;
    const s1 = mono[Math.min(idx + 1, mono.length - 1)] ?? s0;
    out[i] = s0 + (s1 - s0) * frac;
  }
  return out;
}

export function computeVisualizerSignals(
  mono22050: Float32Array,
  startSec: number,
  durSec: number,
  fps = 30
): VisualizerSignals {
  const SR = 22050;
  const startIdx = Math.max(0, Math.floor(startSec * SR));
  const endIdx = Math.min(mono22050.length, Math.floor((startSec + durSec) * SR));
  const y = mono22050.subarray(startIdx, endIdx);

  const nf = Math.max(1, Math.floor(durSec * fps));
  const win = 2048;
  const freqs = rfftFreqs(win, 1.0 / SR);
  const hann = hanning(win);
  const plan = createRfftPlan(win);

  const bassMask: number[] = [];
  const voxMask: number[] = [];
  const highMask: number[] = [];
  const fluxMask: number[] = [];

  for (let k = 0; k < freqs.length; k++) {
    const f = freqs[k];
    if (f >= 30 && f < 150) bassMask.push(k);
    if (f >= 300 && f < 3000) voxMask.push(k);
    if (f >= 5000 && f < 12000) highMask.push(k);
    if (f >= 100 && f < 8000) fluxMask.push(k);
  }

  const eb = new Float64Array(nf);
  const ev = new Float64Array(nf);
  const eh = new Float64Array(nf);
  const flux = new Float64Array(nf);
  const totalE = new Float64Array(nf);
  const seg = new Float64Array(win);
  let prev: Float64Array | null = null;

  const bandRms = (mag: Float64Array, mask: number[]) => {
    if (mask.length === 0) return 0;
    let sum = 0;
    for (let j = 0; j < mask.length; j++) {
      const m = mag[mask[j]];
      sum += m * m;
    }
    return Math.sqrt(sum / mask.length);
  };

  for (let i = 0; i < nf; i++) {
    const c = Math.floor((i / fps) * SR);
    const lo = Math.max(0, c - win / 2);
    seg.fill(0);
    for (let j = 0; j < win; j++) {
      const idx = lo + j;
      if (idx < y.length) {
        seg[j] = y[idx] * hann[j];
      }
    }
    const mag = rfftMagnitude(seg, plan);
    eb[i] = bandRms(mag, bassMask);
    ev[i] = bandRms(mag, voxMask);
    eh[i] = bandRms(mag, highMask);
    totalE[i] = eb[i] + ev[i] + eh[i];

    if (prev !== null) {
      let fSum = 0;
      for (let j = 0; j < fluxMask.length; j++) {
        const idx = fluxMask[j];
        const d = mag[idx] - prev[idx];
        if (d > 0) fSum += d;
      }
      flux[i] = fSum;
    }
    prev = mag;
  }

  const nb = norm(eb);
  const nflux = norm(flux);

  const bass = smooth(nb, 0.8, 0.82);
  const vox = smooth(norm(ev), 0.5, 0.8);
  const high = smooth(norm(eh), 0.7, 0.75);
  const hit = smooth(nflux, 0.9, 0.7);
  const energy = smooth(norm(totalE), 0.4, 0.92);

  const kick = new Float32Array(nf);
  const snare = new Float32Array(nf);
  for (let i = 0; i < nf; i++) {
    kick[i] = i === 0 ? 0 : Math.max(0, nb[i] - nb[i - 1]);
    snare[i] = i === 0 ? Math.max(0, nflux[0]) : Math.max(0, nflux[i] - nflux[i - 1]);
  }

  return { fps, nf, bass, vox, high, hit, energy, kick, snare };
}
