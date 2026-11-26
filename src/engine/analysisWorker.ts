/// <reference lib="webworker" />
// Runs the math engine off the main thread so long tracks don't freeze the UI.
// Used by the app in every runtime (browser, Tauri desktop, Tauri iOS), so the
// app needs no server to analyze audio.
import { analyzeAudioSamples } from './mathEngine.ts';
import type { MathEngineAnalysis } from './mathEngine.ts';
import { parseWavBuffer } from './wavParser.ts';

export interface AnalysisRequest {
  id: number;
  wav: ArrayBuffer;
  fileName: string;
  hopMs: number;
}

export type AnalysisResponse =
  | { id: number; ok: true; analysis: MathEngineAnalysis }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const { id, wav, fileName, hopMs } = event.data;
  let response: AnalysisResponse;
  try {
    const parsed = parseWavBuffer(wav);
    const analysis = analyzeAudioSamples(parsed.mono, parsed.sampleRate, fileName, hopMs);
    response = { id, ok: true, analysis };
  } catch (err) {
    response = { id, ok: false, error: err instanceof Error ? err.message : 'Audio analysis failed.' };
  }
  ctx.postMessage(response);
};
