# Seeing Sounds

**See exactly what you hear.**

Seeing Sounds started as a song by [YeahMel](https://yeahmel.com), produced by Stoic Beats. It grew into a brand, and now into software: tools that measure what is happening in a track and turn those measurements into visuals an artist controls.

> Status: early development, built in the open. Expect things to change.

## Principles

- **Math first.** Visuals are driven by measurements of the audio, and the numbers have to add up.
- **No AI-generated audio or images.** Making and editing music belongs to the artist and their DAW. Artwork comes from the artist.
- **The artist decides.** The software measures and suggests. Creative judgment stays human.

The full product definition is in [PROJECT_RECORD.md](PROJECT_RECORD.md).

## What is in this repository

### Audio math engine

[`math_engine.py`](math_engine.py) reads an audio file and prints a JSON report:

- Sample rate and duration
- Estimated tempo (BPM) and onset count
- Dominant pitch class and a 12-note chroma profile
- Four equal sections with start, end, and duration
- An integrity check that the section and phrase durations add up to the track length within 1 ms

It also reports a deeper analysis under `detailed`:

- Estimated key (Krumhansl-Kessler profiles) with a match score and the runner-up key
- A beat grid at the measured tempo: beats, downbeats, bars, and how close the onsets land to it
- Four-bar phrases cut on downbeats, each tagged build, release, arc, or steady
- A tension curve made from energy (50%), brightness (30%), and onset density (20%)
- Per-section energy, brightness, tension, onsets per second, and main note

The TypeScript engine in `src/engine/` gives the same numbers.

```
python math_engine.py path/to/track.wav
```

### Local web app

A browser app for the math engine. Drop in a track, or use the built-in 92 BPM sample, and see:

- Tempo, onset count, dominant pitch, and the integrity check
- Key, beat grid, how tightly the hits land on the beat, and the tension peak
- An energy, brightness, and tension timeline with beat, phrase, and onset markers and the four sections. Click to jump playback there.
- Phrase cards (build, release, arc, steady) and per-section detail
- Song feedback: what the song is about (themes, story, point of view, mood, key lines), how the sound supports it, what works, and ideas to consider. Gemini listens to the track and gets the measured numbers as context. You can paste lyrics for a more accurate read. The feedback is labeled as an interpretation, and it is kept separate from the measurements.
- The 12-note chroma profile
- A downloadable JSON report

WAV files go straight to the server. Other formats (MP3, FLAC, and so on) are decoded in your browser first.

```
npm install
cp .env.example .env   # then set GEMINI_API_KEY to use song feedback
npm run dev
```

Song feedback needs a Gemini API key from https://aistudio.google.com/apikey. Everything else works without one. Set `GEMINI_MODEL` in `.env` to use a different Gemini model. If that model is busy, the app tries `GEMINI_FALLBACK_MODELS` in order (comma-separated, default `gemini-3.6-flash,gemini-3.1-flash-lite`).

Then open http://localhost:3000.

### ZEAL cover visualizer

[`visualizer/`](visualizer/) animates the layered cover art for ZEAL, YeahMel's 14-track mixtape, in time with a track. The crown hops on the kick, the mouth opens with the vocal, the flames flicker with the highs, and the collage borders sway with the overall energy. It exports MP4 in 16:9, 9:16, and square.

Setup, options, and the full list of what drives each movement are in [visualizer/README.md](visualizer/README.md).

Artwork and music are not included in this repository.

## Getting started

You need Node.js 20.12 or newer for the web app, and Python 3 for the Python tools. The visualizer also needs ffmpeg.

```
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -r visualizer/requirements.txt
```

On Windows, activate the environment with `.venv\Scripts\activate`.

## Roadmap

- [x] Product definition and technical plan
- [x] Deterministic audio math engine
- [x] Offline cover visualizer for ZEAL (16:9, 9:16, square)
- [x] Deeper analysis: key, beat grid, phrasing, tension and release
- [x] Local web app: upload a track and see the analysis
- [ ] Editable rules that map sound to color, motion, and type
- [ ] First public demo

## About the creator

Built by **YeahMel** (Melvin Gregory King), an independent hip-hop artist and creative entrepreneur from the Cleveland, Ohio area. The goal is to give independent artists the same quality of tools and knowledge that larger industry players have. The community around the music is called The Zealots.

## Contributing

Ideas and feedback are welcome. Open an issue to share a suggestion or report a problem.

## License

No license has been chosen yet, so all rights are reserved. The ZEAL artwork and music are not part of this repository.
