import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeAudioSamples } from './src/engine/mathEngine.ts';
import { encodeMonoWav, parseWavBuffer } from './src/engine/wavParser.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';

function generateDeterministicTestTrack(sr = 22050, durSec = 10.434783) {
  // 92 BPM = 0.652174 s per beat -> 16 beats = 10.434783 s
  const totalSamples = Math.floor(sr * durSec);
  const mono = new Float32Array(totalSamples);
  const beatSec = 60.0 / 92.0;

  // F# minor triad frequencies (F#2, F#3, A3, C#4, F#4)
  const fRoot = 92.5; // F#2
  const fThird = 220.0; // A3
  const fFifth = 277.18; // C#4
  const fOct = 369.99; // F#4

  // Deterministic LCG PRNG for snare/hat noise
  let seed = 7;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sr;
    const beatPos = t / beatSec;
    const beatIdx = Math.floor(beatPos);
    const beatFrac = beatPos - beatIdx;
    const localT = beatFrac * beatSec;

    // Kick on beats 0, 2 (and syncopated 2.75)
    let kickEnv = 0;
    let kickFreq = 52;
    const stepInBar = beatIdx % 4;
    if (stepInBar === 0 || stepInBar === 2) {
      kickEnv = Math.exp(-localT * 18.0);
      kickFreq = 46 + 95 * Math.exp(-localT * 36.0);
    }
    const kick = kickEnv * Math.sin(2 * Math.PI * kickFreq * localT) * 0.72;

    // Snare on beats 1, 3
    let snare = 0;
    if (stepInBar === 1 || stepInBar === 3) {
      const sEnv = Math.exp(-localT * 24.0);
      const tone = Math.sin(2 * Math.PI * 185 * localT) * 0.35;
      const noise = nextRand() * 0.65;
      snare = sEnv * (tone + noise) * 0.55;
    }

    // 8th-note hi-hat
    const eighthFrac = (beatPos * 2) % 1;
    const hatT = (eighthFrac * beatSec) / 2;
    const hatEnv = Math.exp(-hatT * 75.0);
    const hat = hatEnv * nextRand() * 0.16;

    // Warm bass + chord pad in F# minor
    const barFrac = (beatPos % 4) / 4;
    const chordEnv = 0.5 + 0.5 * Math.sin(Math.PI * barFrac);
    const bass = Math.sin(2 * Math.PI * fRoot * t) * 0.28;
    const pad =
      (Math.sin(2 * Math.PI * fThird * t) * 0.12 +
        Math.sin(2 * Math.PI * fFifth * t) * 0.11 +
        Math.sin(2 * Math.PI * fOct * t) * 0.09) *
      (0.55 + 0.45 * chordEnv);

    // Subtle vocal-band melodic motif (300-3000 Hz)
    const melodyGate = beatIdx % 2 === 0 ? Math.exp(-localT * 4.5) : 0.25;
    const melodyFreq = stepInBar === 0 ? 739.99 : stepInBar === 1 ? 659.25 : stepInBar === 2 ? 554.37 : 440.0;
    const melody = Math.sin(2 * Math.PI * melodyFreq * t) * 0.14 * melodyGate;

    mono[i] = Math.max(-0.95, Math.min(0.95, kick + snare + hat + bass + pad + melody));
  }

  return { mono, sr };
}

async function startServer() {
  const app = express();

  app.use('/api/analyze', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '80mb' }));
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'seeing-sounds', runtime: 'node' });
  });

  app.get('/api/sample-track', (_req, res) => {
    const { mono, sr } = generateDeterministicTestTrack();
    const wav = encodeMonoWav(mono, sr);
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', 'inline; filename="zeal_92bpm_fsharp_minor.wav"');
    res.send(Buffer.from(wav));
  });

  app.post('/api/analyze', (req, res) => {
    try {
      const hopMs = Number(req.query.hop_ms || 50);
      const includeSeries = req.query.include_series === 'true';

      if (Buffer.isBuffer(req.body)) {
        const fileName = String(req.query.filename || 'uploaded.wav');
        const arrayBuf = req.body.buffer.slice(
          req.body.byteOffset,
          req.body.byteOffset + req.body.byteLength
        );
        const parsed = parseWavBuffer(arrayBuf);
        const analysis = analyzeAudioSamples(parsed.mono, parsed.sampleRate, fileName, hopMs);
        if (includeSeries) {
          res.json(analysis);
        } else {
          const { series: _series, ...report } = analysis;
          res.json(report);
        }
        return;
      }

      if (req.body && Array.isArray(req.body.samples) && typeof req.body.sampleRate === 'number') {
        const mono = Float32Array.from(req.body.samples);
        const fileName = String(req.body.fileName || 'track.wav');
        const analysis = analyzeAudioSamples(mono, req.body.sampleRate, fileName, hopMs);
        if (includeSeries) {
          res.json(analysis);
        } else {
          const { series: _series, ...report } = analysis;
          res.json(report);
        }
        return;
      }

      res.status(400).json({
        error: 'Send raw WAV binary (Content-Type: audio/wav) or JSON { samples, sampleRate, fileName }.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Audio analysis failed.';
      res.status(400).json({ error: message });
    }
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Seeing Sounds listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
