import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, MouseEvent } from 'react';
import { AudioLines, CircleCheck, CircleX, Download, LoaderCircle, Music, Upload } from 'lucide-react';
import { NOTES } from './engine/mathEngine.ts';
import type { MathEngineAnalysis } from './engine/mathEngine.ts';
import { encodeMonoWav } from './engine/wavParser.ts';

const SECTION_COLORS = ['#e8a84c', '#c7643a', '#8f9a5b', '#5e8ca8'];

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

async function toWavBody(file: File): Promise<ArrayBuffer> {
  const raw = await file.arrayBuffer();
  if (/\.wav$/i.test(file.name) || file.type === 'audio/wav' || file.type === 'audio/x-wav') {
    return raw;
  }
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(raw);
    const mono = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const data = decoded.getChannelData(c);
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
    }
    return encodeMonoWav(mono, decoded.sampleRate);
  } finally {
    void ctx.close();
  }
}

async function requestAnalysis(body: ArrayBuffer, fileName: string): Promise<MathEngineAnalysis> {
  const res = await fetch(`/api/analyze?include_series=true&filename=${encodeURIComponent(fileName)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body,
  });
  if (res.status === 413) throw new Error('This file is too large to analyze (limit is 80 MB of WAV audio).');
  const text = await res.text();
  let json: { error?: string } | MathEngineAnalysis;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Analysis failed (HTTP ${res.status}).`);
  }
  if (!res.ok) throw new Error(('error' in json && json.error) || 'Analysis failed.');
  return json as MathEngineAnalysis;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[#2a261f] bg-[#16140f] p-4">
      <div className="text-xs uppercase tracking-widest text-[#9c8f78]">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-xs text-[#9c8f78]">{sub}</div>}
    </div>
  );
}

function Timeline({
  analysis,
  currentTime,
  onSeek,
}: {
  analysis: MathEngineAnalysis;
  currentTime: number;
  onSeek: (t: number) => void;
}) {
  const W = 1000;
  const H = 220;
  const dur = analysis.track.duration_sec;
  const { times, rms, centroid, onset_times } = analysis.series;
  const x = (t: number) => (t / dur) * W;
  const curve = (values: number[], top: number, height: number) =>
    values.map((v, i) => `${x(times[i]).toFixed(2)},${(top + height - v * height).toFixed(2)}`).join(' ');

  const handleClick = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(((e.clientX - rect.left) / rect.width) * dur);
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-56 w-full cursor-pointer rounded-xl border border-[#2a261f] bg-[#16140f]"
      onClick={handleClick}
      role="img"
      aria-label="Energy and brightness over time"
    >
      {analysis.verified_math.sections.map((s, i) => (
        <rect
          key={s.section}
          x={x(s.start_sec)}
          y={0}
          width={x(s.duration_sec)}
          height={H}
          fill={SECTION_COLORS[i % SECTION_COLORS.length]}
          opacity={0.07}
        />
      ))}
      {onset_times.map((t) => (
        <line key={t} x1={x(t)} x2={x(t)} y1={H - 14} y2={H} stroke="#f0e4cd" strokeOpacity={0.5} strokeWidth={1} />
      ))}
      <polyline points={curve(centroid, 10, 90)} fill="none" stroke="#5e8ca8" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <polyline points={curve(rms, 110, 90)} fill="none" stroke="#e8a84c" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <line x1={x(currentTime)} x2={x(currentTime)} y1={0} y2={H} stroke="#f0e4cd" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function ChromaChart({ chroma, dominant }: { chroma: Record<string, number>; dominant: string }) {
  return (
    <div className="flex h-44 items-end gap-2 rounded-xl border border-[#2a261f] bg-[#16140f] p-4">
      {NOTES.map((note) => {
        const v = chroma[note] ?? 0;
        return (
          <div key={note} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <div className="text-[10px] text-[#9c8f78]">{v.toFixed(2)}</div>
            <div
              className="w-full rounded-t"
              style={{ height: `${Math.max(2, v * 100)}%`, background: note === dominant ? '#e8a84c' : '#4a4236' }}
            />
            <div className={`text-xs ${note === dominant ? 'font-semibold text-[#e8a84c]' : 'text-[#9c8f78]'}`}>{note}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  const [analysis, setAnalysis] = useState<MathEngineAnalysis | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const analyzeFile = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const body = await toWavBody(file);
      const result = await requestAnalysis(body, file.name);
      setAudioUrl(URL.createObjectURL(file));
      setAnalysis(result);
      setCurrentTime(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not analyze this file.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSample = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/sample-track');
      const blob = await res.blob();
      await analyzeFile(new File([blob], 'zeal_92bpm_fsharp_minor.wav', { type: 'audio/wav' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the sample track.');
      setLoading(false);
    }
  }, [analyzeFile]);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void analyzeFile(file);
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void analyzeFile(file);
    e.target.value = '';
  };

  const seek = (t: number) => {
    if (audioRef.current) audioRef.current.currentTime = t;
    setCurrentTime(t);
  };

  const downloadReport = () => {
    if (!analysis) return;
    const { series: _series, ...report } = analysis;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${analysis.track.file.replace(/\.[^.]+$/, '')}.analysis.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const vm = analysis?.verified_math;
  const hasPitch = vm ? Object.values(vm.chroma).some((v) => v > 0) : false;
  const activeSection = vm?.sections.find((s) => currentTime >= s.start_sec && currentTime < s.end_sec)?.section;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex items-center gap-3">
        <AudioLines className="h-8 w-8 text-[#e8a84c]" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Seeing Sounds</h1>
          <p className="text-sm text-[#9c8f78]">See exactly what you hear.</p>
        </div>
      </header>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-8 text-center transition ${
          dragging ? 'border-[#e8a84c] bg-[#1e1a12]' : 'border-[#2a261f] bg-[#12110d]'
        }`}
      >
        {loading ? (
          <LoaderCircle className="h-8 w-8 animate-spin text-[#e8a84c]" />
        ) : (
          <Upload className="h-8 w-8 text-[#9c8f78]" />
        )}
        <div>
          <div className="font-medium">{loading ? 'Measuring your track...' : 'Drop a track here'}</div>
          <div className="text-sm text-[#9c8f78]">WAV works best. MP3, FLAC, and others are decoded in your browser.</div>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={() => inputRef.current?.click()}
            className="rounded-lg bg-[#e8a84c] px-4 py-2 font-medium text-[#0e0d0b] hover:bg-[#f0b965] disabled:opacity-50"
          >
            Choose file
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadSample()}
            className="flex items-center gap-2 rounded-lg border border-[#2a261f] px-4 py-2 hover:bg-[#1e1a12] disabled:opacity-50"
          >
            <Music className="h-4 w-4" /> Try the sample track
          </button>
        </div>
        <input ref={inputRef} type="file" accept="audio/*,.wav" className="hidden" onChange={onPick} />
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-[#7a2e22] bg-[#2a1410] px-4 py-3 text-sm text-[#f3b3a6]">{error}</div>
      )}

      {analysis && vm && (
        <main className="mt-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold">{analysis.track.file}</div>
              <div className="text-sm text-[#9c8f78]">
                {analysis.track.sr.toLocaleString()} Hz · {formatTime(analysis.track.duration_sec)} ({analysis.track.duration_sec}s)
              </div>
            </div>
            <button
              type="button"
              onClick={downloadReport}
              className="flex items-center gap-2 rounded-lg border border-[#2a261f] px-3 py-2 text-sm hover:bg-[#1e1a12]"
            >
              <Download className="h-4 w-4" /> Download report (JSON)
            </button>
          </div>

          {audioUrl && <audio ref={audioRef} src={audioUrl} controls className="w-full" />}

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Tempo" value={vm.bpm ? `${vm.bpm} BPM` : '—'} sub="Estimated from onset spacing" />
            <Stat label="Onsets" value={String(vm.onsets)} sub="Detected energy hits" />
            <Stat
              label="Dominant pitch"
              value={hasPitch ? vm.dominant_pitch : '—'}
              sub={hasPitch ? 'Strongest note in the chroma' : 'No pitched content detected'}
            />
            <div className="rounded-xl border border-[#2a261f] bg-[#16140f] p-4">
              <div className="text-xs uppercase tracking-widest text-[#9c8f78]">Integrity</div>
              <div
                className={`mt-1 flex items-center gap-2 text-2xl font-semibold ${
                  analysis.integrity.passed ? 'text-[#8fc27a]' : 'text-[#e2725b]'
                }`}
              >
                {analysis.integrity.passed ? <CircleCheck className="h-6 w-6" /> : <CircleX className="h-6 w-6" />}
                {analysis.integrity.passed ? 'Passed' : 'Failed'}
              </div>
              <div className="mt-1 text-xs text-[#9c8f78]">Sections add up within {analysis.integrity.error_ms} ms</div>
            </div>
          </div>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold">Timeline</h2>
              <div className="flex gap-4 text-xs text-[#9c8f78]">
                <span><span className="text-[#5e8ca8]">━</span> Brightness</span>
                <span><span className="text-[#e8a84c]">━</span> Energy</span>
                <span>| Onsets</span>
                <span>{formatTime(currentTime)} / {formatTime(analysis.track.duration_sec)}</span>
              </div>
            </div>
            <Timeline analysis={analysis} currentTime={currentTime} onSeek={seek} />
            <div className="mt-1 text-xs text-[#9c8f78]">Click anywhere on the timeline to jump there.</div>
          </section>

          <section>
            <h2 className="mb-2 font-semibold">Pitch classes (chroma)</h2>
            <ChromaChart chroma={vm.chroma} dominant={hasPitch ? vm.dominant_pitch : ''} />
          </section>

          <section>
            <h2 className="mb-2 font-semibold">Sections</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {vm.sections.map((s, i) => (
                <button
                  type="button"
                  key={s.section}
                  onClick={() => seek(s.start_sec)}
                  className={`rounded-xl border p-3 text-left transition hover:bg-[#1e1a12] ${
                    activeSection === s.section ? 'border-[#e8a84c]' : 'border-[#2a261f]'
                  }`}
                  style={{ borderLeft: `4px solid ${SECTION_COLORS[i % SECTION_COLORS.length]}` }}
                >
                  <div className="font-medium">Section {s.section}</div>
                  <div className="text-xs text-[#9c8f78]">
                    {formatTime(s.start_sec)} – {formatTime(s.end_sec)} · {s.duration_sec.toFixed(3)}s
                  </div>
                </button>
              ))}
            </div>
          </section>
        </main>
      )}
    </div>
  );
}
