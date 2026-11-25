import { NOTES } from './mathEngine.ts';
import type { MathEngineReport } from './mathEngine.ts';

export interface MixtapeSummary {
  track_count: number;
  total_duration_sec: number;
  bpm: { min: number; max: number; mean: number } | null;
  dominant_pitch_counts: Record<string, number>;
  most_common_pitch: string | null;
  chroma: Record<string, number>;
  integrity_passed: number;
}

export interface MixtapeReport {
  mixtape: string;
  summary: MixtapeSummary;
  tracks: (MathEngineReport & { index: number })[];
  failed: { index: number; file: string; error: string }[];
}

export type MixtapeEntry =
  | { index: number; report: MathEngineReport }
  | { index: number; file: string; error: string };

function round(v: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round((v + Number.EPSILON) * factor) / factor;
}

function hasPitch(report: MathEngineReport): boolean {
  return Object.values(report.verified_math.chroma).some((v) => v > 0);
}

export function compareTrackNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function summarizeMixtape(reports: MathEngineReport[]): MixtapeSummary {
  const totalDuration = reports.reduce((sum, r) => sum + r.track.duration_sec, 0);

  const bpms = reports.map((r) => r.verified_math.bpm).filter((b) => b > 0);
  const bpm = bpms.length
    ? {
        min: Math.min(...bpms),
        max: Math.max(...bpms),
        mean: round(bpms.reduce((s, b) => s + b, 0) / bpms.length, 2),
      }
    : null;

  const pitched = reports.filter(hasPitch);
  const counts: Record<string, number> = {};
  for (const r of pitched) {
    const p = r.verified_math.dominant_pitch;
    counts[p] = (counts[p] ?? 0) + 1;
  }
  let mostCommon: string | null = null;
  for (const note of NOTES) {
    if ((counts[note] ?? 0) > (mostCommon ? counts[mostCommon] : 0)) mostCommon = note;
  }

  // Duration-weighted average of each track's chroma, rescaled so the strongest note is 1.
  const weighted = NOTES.map((note) =>
    pitched.reduce((sum, r) => sum + (r.verified_math.chroma[note] ?? 0) * r.track.duration_sec, 0),
  );
  const peak = Math.max(...weighted);
  const chroma = Object.fromEntries(NOTES.map((note, i) => [note, peak > 0 ? round(weighted[i] / peak, 4) : 0]));

  return {
    track_count: reports.length,
    total_duration_sec: round(totalDuration, 3),
    bpm,
    dominant_pitch_counts: counts,
    most_common_pitch: mostCommon,
    chroma,
    integrity_passed: reports.filter((r) => r.integrity.passed).length,
  };
}

export function buildMixtapeReport(title: string, entries: MixtapeEntry[]): MixtapeReport {
  const tracks: MixtapeReport['tracks'] = [];
  const failed: MixtapeReport['failed'] = [];
  for (const e of entries) {
    if ('report' in e) tracks.push({ index: e.index, ...e.report });
    else failed.push(e);
  }
  return { mixtape: title, summary: summarizeMixtape(tracks), tracks, failed };
}
