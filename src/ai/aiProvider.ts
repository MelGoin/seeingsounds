import { ApiError, createPartFromBase64, createPartFromUri, GoogleGenAI } from '@google/genai';
import type { MathEngineReport } from '../engine/mathEngine.ts';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const DEFAULT_GEMINI_FALLBACK_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash'];
const INLINE_AUDIO_LIMIT_BYTES = 14 * 1024 * 1024;

export interface SongFeedback {
  summary: string;
  lyrics_source: 'provided' | 'heard' | 'instrumental';
  themes: { theme: string; evidence: string }[];
  story: string;
  perspective: string;
  mood: { words: string[]; description: string };
  lyric_highlights: { line: string; timestamp: string; why: string }[];
  sound_and_meaning: string;
  strengths: string[];
  suggestions: string[];
}

export interface SongFeedbackResult {
  model: string;
  feedback: SongFeedback;
}

export class AiNotConfiguredError extends Error {}
export class AiBusyError extends Error {}

const isBusy = (err: unknown) => err instanceof ApiError && (err.status === 429 || err.status === 503);

const str = { type: 'string' };
const strList = { type: 'array', items: str };

const FEEDBACK_SCHEMA = {
  type: 'object',
  properties: {
    summary: { ...str, description: 'Two to four sentences on what the song is about.' },
    lyrics_source: {
      type: 'string',
      enum: ['provided', 'heard', 'instrumental'],
      description: 'provided = artist supplied lyrics; heard = understood from the vocal; instrumental = no words.',
    },
    themes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { theme: str, evidence: { ...str, description: 'Lyric or sound that shows this theme.' } },
        required: ['theme', 'evidence'],
      },
    },
    story: { ...str, description: 'The narrative or emotional arc from start to end.' },
    perspective: { ...str, description: 'Who is speaking, to whom, and from what position.' },
    mood: {
      type: 'object',
      properties: { words: strList, description: str },
      required: ['words', 'description'],
    },
    lyric_highlights: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          line: { ...str, description: 'Exact lyric quoted from the song.' },
          timestamp: { ...str, description: 'Approximate m:ss where it is heard, or empty if unknown.' },
          why: str,
        },
        required: ['line', 'timestamp', 'why'],
      },
    },
    sound_and_meaning: {
      ...str,
      description: 'How the beat, key, tempo and tension arc support or work against the message. Use the measured numbers.',
    },
    strengths: strList,
    suggestions: { ...strList, description: 'Optional ideas for the artist to consider. Never rewrite the song.' },
  },
  required: [
    'summary',
    'lyrics_source',
    'themes',
    'story',
    'perspective',
    'mood',
    'lyric_highlights',
    'sound_and_meaning',
    'strengths',
    'suggestions',
  ],
};

function measuredContext(report: MathEngineReport): string {
  const { verified_math: vm, detailed: d } = report;
  return JSON.stringify(
    {
      duration_sec: report.track.duration_sec,
      bpm: vm.bpm,
      key: d.key?.label ?? null,
      bars: d.beat_grid?.bars ?? null,
      tension_peak_sec: d.tension.peak_sec,
      tension_low_sec: d.tension.low_sec,
      phrases: d.phrases.map((p) => ({ start_sec: p.start_sec, end_sec: p.end_sec, shape: p.shape, tension: p.mean_tension })),
      sections: d.sections.map((s) => ({ section: s.section, energy: s.energy, tension: s.tension, onsets_per_sec: s.onsets_per_sec })),
    },
    null,
    1
  );
}

function buildPrompt(fileName: string, report: MathEngineReport, lyrics: string): string {
  return [
    'You are a thoughtful music critic and songwriting mentor giving an independent hip-hop artist feedback on their own track.',
    'Listen to the attached audio and explain what the song is about: its themes, story, point of view, and mood.',
    'Ground every claim in what is actually said or heard. Quote lyrics exactly. If a line is unclear, say so instead of guessing.',
    'The artist owns the creative decisions: offer observations and optional suggestions, never rewritten verses or replacement lyrics.',
    'If there are no vocals, treat it as an instrumental and describe what the music conveys.',
    `Track file name: ${fileName}`,
    'Measured analysis from a deterministic audio engine (trust these numbers over your own estimates):',
    measuredContext(report),
    lyrics.trim()
      ? `The artist provided these lyrics. Treat them as the source of truth for the words:\n"""\n${lyrics.trim()}\n"""`
      : 'No lyrics were provided. Work from what you can hear in the vocal.',
  ].join('\n\n');
}

async function audioPart(ai: GoogleGenAI, wav: Uint8Array) {
  const data = Buffer.from(wav);
  if (data.byteLength <= INLINE_AUDIO_LIMIT_BYTES) {
    return createPartFromBase64(data.toString('base64'), 'audio/wav');
  }
  let file = await ai.files.upload({ file: new Blob([data], { type: 'audio/wav' }), config: { mimeType: 'audio/wav' } });
  for (let i = 0; i < 60 && file.state === 'PROCESSING' && file.name; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    file = await ai.files.get({ name: file.name });
  }
  if (!file.uri || file.state === 'FAILED') throw new Error('Gemini could not process the uploaded audio.');
  return createPartFromUri(file.uri, file.mimeType || 'audio/wav');
}

export async function generateSongFeedback(params: {
  wav: Uint8Array;
  fileName: string;
  report: MathEngineReport;
  lyrics?: string;
}): Promise<SongFeedbackResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AiNotConfiguredError('Song feedback needs a Gemini API key. Add GEMINI_API_KEY to your .env file and restart.');
  }
  const fallbacks = process.env.GEMINI_FALLBACK_MODELS
    ? process.env.GEMINI_FALLBACK_MODELS.split(',').map((m) => m.trim()).filter(Boolean)
    : DEFAULT_GEMINI_FALLBACK_MODELS;
  const models = [...new Set([process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL, ...fallbacks])];
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 180_000, retryOptions: { attempts: 2 } } });
  const parts = [await audioPart(ai, params.wav), { text: buildPrompt(params.fileName, params.report, params.lyrics ?? '') }];

  let model = models[0];
  let response;
  for (const candidate of models) {
    model = candidate;
    try {
      response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: FEEDBACK_SCHEMA,
          temperature: 0.4,
        },
      });
      break;
    } catch (err) {
      if (!isBusy(err)) throw err;
    }
  }
  if (!response) throw new AiBusyError('Gemini is busy right now. Try again in a minute.');

  const text = response.text;
  if (!text) throw new Error('Gemini returned an empty response.');
  return { model, feedback: JSON.parse(text) as SongFeedback };
}
