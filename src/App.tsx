import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, MouseEvent } from 'react';
import { AudioLines, CircleCheck, CircleX, Download, LoaderCircle, Music, Upload, X } from 'lucide-react';
import { NOTES } from './engine/mathEngine.ts';
import type { MathEngineAnalysis, MathEngineReport } from './engine/mathEngine.ts';
import { buildMixtapeReport, compareTrackNames, summarizeMixtape } from './engine/mixtape.ts';
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

type TrackStatus = 'queued' | 'analyzing' | 'done' | 'error';

interface TapeTrack {
  id: number;
  file: File;
  status: TrackStatus;
  analysis?: MathEngineAnalysis;
  error?: string;
}

const AUDIO_EXTENSIONS = /\.(wav|mp3|flac|m4a|aac|ogg|oga|opus|aif|aiff|webm)$/i;

function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/') || AUDIO_EXTENSIONS.test(file.name);
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}`;
}

function stripSeries(analysis: MathEngineAnalysis): MathEngineReport {
  const { series: _series, ...report } = analysis;
  return report;
}

function downloadJson(data: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function formatRuntime(sec: number): string {
  const h = Math.floor(sec / 3600);
  if (h === 0) return formatTime(sec);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function TrackStatusCell({ track }: { track: TapeTrack }) {
  if (track.status === 'queued') return <span className="text-[#9c8f78]">Queued</span>;
  if (track.status === 'analyzing') {
    return (
      <span className="flex items-center gap-1 text-[#e8a84c]">
        <LoaderCircle className="h-4 w-4 animate-spin" /> Measuring
      </span>
    );
  }
  if (track.status === 'error') {
    return (
      <span className="flex items-center gap-1 text-[#e2725b]" title={track.error}>
        <CircleX className="h-4 w-4" /> Error
      </span>
    );
  }
  const passed = track.analysis?.integrity.passed;
  return (
    <span className={`flex items-center gap-1 ${passed ? 'text-[#8fc27a]' : 'text-[#e2725b]'}`}>
      {passed ? <CircleCheck className="h-4 w-4" /> : <CircleX className="h-4 w-4" />}
      {passed ? 'Passed' : 'Failed'}
    </span>
  );
}

function MixtapePanel({
  tracks,
  selectedId,
  title,
  onTitleChange,
  onSelect,
  onRemove,
  onClear,
}: {
  tracks: TapeTrack[];
  selectedId: number | null;
  title: string;
  onTitleChange: (title: string) => void;
  onSelect: (id: number) => void;
  onRemove: (id: number) => void;
  onClear: () => void;
}) {
  const reports = tracks.flatMap((t) => (t.analysis ? [stripSeries(t.analysis)] : []));
  const pending = tracks.some((t) => t.status === 'queued' || t.status === 'analyzing');
  const summary = summarizeMixtape(reports);
  const name = title.trim() || 'Untitled mixtape';

  const download = () => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'mixtape';
    const entries = tracks.map((t, i) =>
      t.analysis
        ? { index: i + 1, report: stripSeries(t.analysis) }
        : { index: i + 1, file: t.file.name, error: t.error ?? 'Not measured.' },
    );
    downloadJson(buildMixtapeReport(name, entries), `${slug}.mixtape.json`);
  };

  return (
    <section className="mt-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Mixtape title"
          aria-label="Mixtape title"
          className="min-w-0 flex-1 border-b border-transparent bg-transparent text-2xl font-bold outline-none placeholder:text-[#4a4236] focus:border-[#2a261f]"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={download}
            disabled={pending || reports.length === 0}
            title={pending ? 'Available once every track is measured' : undefined}
            className="flex items-center gap-2 rounded-lg border border-[#2a261f] px-3 py-2 text-sm hover:bg-[#1e1a12] disabled:opacity-50"
          >
            <Download className="h-4 w-4" /> Download mixtape report (JSON)
          </button>
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg border border-[#2a261f] px-3 py-2 text-sm hover:bg-[#1e1a12]"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Tracks" value={`${reports.length} / ${tracks.length}`} sub="Measured so far" />
        <Stat label="Runtime" value={formatRuntime(summary.total_duration_sec)} sub="Total length" />
        <Stat
          label="Tempo"
          value={summary.bpm ? `${Math.round(summary.bpm.min)}–${Math.round(summary.bpm.max)}` : '—'}
          sub={summary.bpm ? `BPM range · average ${summary.bpm.mean}` : 'No tempo yet'}
        />
        <Stat
          label="Common pitch"
          value={summary.most_common_pitch ?? '—'}
          sub={
            summary.most_common_pitch
              ? `Dominant in ${summary.dominant_pitch_counts[summary.most_common_pitch]} of ${reports.length} tracks`
              : 'No pitched content yet'
          }
        />
        <Stat
          label="Integrity"
          value={`${summary.integrity_passed} / ${reports.length}`}
          sub="Tracks whose sections add up"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#2a261f]">
        <table className="w-full text-sm">
          <thead className="bg-[#16140f] text-left text-xs uppercase tracking-widest text-[#9c8f78]">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Track</th>
              <th className="px-3 py-2">Length</th>
              <th className="px-3 py-2">Tempo</th>
              <th className="px-3 py-2">Pitch</th>
              <th className="px-3 py-2">Onsets</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {tracks.map((t, i) => {
              const vm = t.analysis?.verified_math;
              const pitched = vm ? Object.values(vm.chroma).some((v) => v > 0) : false;
              return (
                <tr
                  key={t.id}
                  onClick={() => onSelect(t.id)}
                  className={`cursor-pointer border-t border-[#2a261f] hover:bg-[#1e1a12] ${
                    t.id === selectedId ? 'bg-[#1e1a12]' : ''
                  }`}
                >
                  <td className="px-3 py-2 text-[#9c8f78]">{i + 1}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(t.id);
                      }}
                      className={`text-left ${t.id === selectedId ? 'font-semibold text-[#e8a84c]' : ''}`}
                    >
                      {t.file.name}
                    </button>
                  </td>
                  <td className="px-3 py-2">{t.analysis ? formatTime(t.analysis.track.duration_sec) : '—'}</td>
                  <td className="px-3 py-2">{vm?.bpm ? `${vm.bpm} BPM` : '—'}</td>
                  <td className="px-3 py-2">{pitched ? vm?.dominant_pitch : '—'}</td>
                  <td className="px-3 py-2">{vm ? vm.onsets : '—'}</td>
                  <td className="px-3 py-2">
                    <TrackStatusCell track={t} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      aria-label={`Remove ${t.file.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(t.id);
                      }}
                      className="rounded p-1 text-[#9c8f78] hover:bg-[#2a261f] hover:text-[#f0e4cd]"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {summary.most_common_pitch && (
        <div>
          <h2 className="mb-2 font-semibold">Pitch classes across the tape</h2>
          <ChromaChart chroma={summary.chroma} dominant={summary.most_common_pitch} />
          <div className="mt-1 text-xs text-[#9c8f78]">Each track's chroma, weighted by its length.</div>
        </div>
      )}
    </section>
  );
}

export default function App() {
  const [tracks, setTracks] = useState<TapeTrack[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);

  const selected = tracks.find((t) => t.id === selectedId) ?? null;
  const analysis = selected?.analysis ?? null;
  const selectedFile = analysis ? selected?.file : undefined;
  const pending = tracks.filter((t) => t.status === 'queued' || t.status === 'analyzing').length;
  const loading = pending > 0;
  const finished = tracks.length - pending;

  useEffect(() => {
    if (!selectedFile) {
      setAudioUrl(null);
      return;
    }
    const url = URL.createObjectURL(selectedFile);
    setAudioUrl(url);
    setCurrentTime(0);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const updateTrack = useCallback((id: number, patch: Partial<TapeTrack>) => {
    setTracks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  // Measure queued tracks one at a time so a whole mixtape doesn't hit the server at once.
  useEffect(() => {
    if (tracks.some((t) => t.status === 'analyzing')) return;
    const next = tracks.find((t) => t.status === 'queued');
    if (!next) return;
    updateTrack(next.id, { status: 'analyzing' });
    void (async () => {
      try {
        const body = await toWavBody(next.file);
        const result = await requestAnalysis(body, next.file.name);
        updateTrack(next.id, { status: 'done', analysis: result });
      } catch (err) {
        updateTrack(next.id, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Could not analyze this file.',
        });
      }
    })();
  }, [tracks, updateTrack]);

  const addFiles = useCallback(
    (files: File[]) => {
      const existing = new Set(tracks.map((t) => fileKey(t.file)));
      const audio = files.filter(isAudioFile);
      const fresh = audio
        .filter((f) => !existing.has(fileKey(f)))
        .sort((a, b) => compareTrackNames(a.name, b.name))
        .map((file) => ({ id: nextId.current++, file, status: 'queued' as const }));

      const notes: string[] = [];
      const notAudio = files.length - audio.length;
      const duplicates = audio.length - fresh.length;
      if (notAudio) notes.push(`Skipped ${notAudio} file${notAudio === 1 ? '' : 's'} that ${notAudio === 1 ? "isn't" : "aren't"} audio.`);
      if (duplicates) notes.push(`Skipped ${duplicates} track${duplicates === 1 ? '' : 's'} already in the list.`);
      setError(notes.length ? notes.join(' ') : null);

      if (fresh.length === 0) return;
      setTracks((ts) => [...ts, ...fresh]);
      setSelectedId(fresh[0].id);
    },
    [tracks],
  );

  const removeTrack = (id: number) => {
    const remaining = tracks.filter((t) => t.id !== id);
    setTracks(remaining);
    if (id === selectedId) setSelectedId(remaining.find((t) => t.analysis)?.id ?? remaining[0]?.id ?? null);
  };

  const clearTracks = () => {
    setTracks([]);
    setSelectedId(null);
    setError(null);
  };

  const loadSample = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/sample-track');
      const blob = await res.blob();
      addFiles([new File([blob], 'zeal_92bpm_fsharp_minor.wav', { type: 'audio/wav' })]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the sample track.');
    }
  }, [addFiles]);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []));
    e.target.value = '';
  };

  const seek = (t: number) => {
    if (audioRef.current) audioRef.current.currentTime = t;
    setCurrentTime(t);
  };

  const downloadReport = () => {
    if (!analysis) return;
    downloadJson(stripSeries(analysis), `${analysis.track.file.replace(/\.[^.]+$/, '')}.analysis.json`);
  };

  const shownError =
    [error, selected?.status === 'error' ? `${selected.file.name}: ${selected.error}` : null].filter(Boolean).join(' ') ||
    null;
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
          <div className="font-medium">{loading ? `Measuring track ${finished + 1} of ${tracks.length}...` : 'Drop tracks here'}</div>
          <div className="text-sm text-[#9c8f78]">One track or a whole mixtape. WAV works best; MP3, FLAC, and others are decoded in your browser.</div>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-lg bg-[#e8a84c] px-4 py-2 font-medium text-[#0e0d0b] hover:bg-[#f0b965] disabled:opacity-50"
          >
            Choose files
          </button>
          <button
            type="button"
            onClick={() => void loadSample()}
            className="flex items-center gap-2 rounded-lg border border-[#2a261f] px-4 py-2 hover:bg-[#1e1a12] disabled:opacity-50"
          >
            <Music className="h-4 w-4" /> Try the sample track
          </button>
        </div>
        <input ref={inputRef} type="file" accept="audio/*,.wav" multiple className="hidden" onChange={onPick} />
      </div>

      {shownError && (
        <div className="mt-4 rounded-lg border border-[#7a2e22] bg-[#2a1410] px-4 py-3 text-sm text-[#f3b3a6]">{shownError}</div>
      )}

      {tracks.length > 1 && (
        <MixtapePanel
          tracks={tracks}
          selectedId={selectedId}
          title={title}
          onTitleChange={setTitle}
          onSelect={setSelectedId}
          onRemove={removeTrack}
          onClear={clearTracks}
        />
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
