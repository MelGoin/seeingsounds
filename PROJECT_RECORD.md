# Seeing Sounds — Project Record
**Founder:** Melvin Gregory King (YeahMel) | **Last Updated:** Nov 17, 2026

## Product Vision
An interactive, ethical music-to-visual analysis and design studio ("CapCut-style control tuned for musicians, driven by verified music math"). Helps independent artists inspect the mathematical and cognitive structure of their tracks and map sound to customizable visual elements (color, motion, typography) while keeping 100% of audio creation, editing, and visual judgment in human hands.

## Confirmed Requirements
- Zero AI audio generation, voice alteration, or audio editing (belongs strictly to DAWs).
- Zero AI image generation; visuals are driven by deterministic audio math + human-editable rules.
- Mathematical accuracy first: all beat grids, durations, and energy/pitch numbers must add up.
- Cognitive & music-theoretic grounding (GTTM phrasing, Implication-Realization tension/release, semiotic segmentation, modular pitch math).
- Gemini API (`gemini-3.8-flash` via `google-genai` SDK) acts as core reasoning/structuring engine, isolated behind `ai_provider.py`.
- Target V1 environment: Local web app running on 2017 Intel MacBook Pro; $300 Google Cloud Credits; beginner-friendly, step-by-step workflow.

## Architecture Decisions
- **Frontend:** HTML / CSS / Vanilla JS + Web Audio API + HTML5 Canvas (lightweight for 2017 MacBook, sub-20ms audio-visual sync, zero build-tool bloat).
- **Backend:** Python + FastAPI + `soundfile` / `librosa` / `numpy` (fast CPU math, deterministic, no Cloud TPU cost).
- **AI Layer:** `google-genai` SDK calling `gemini-3.8-flash` with JSON Schema Structured Outputs.
- **Storage:** Local JSON files (`./projects/`) + `.env` for `GEMINI_API_KEY`.

## Completed Milestones
- [x] Discovery & product definition locked (Option B: Interactive Music-Math & Cognitive Visualizer Studio).
- [x] V1 technical stack, cost guardrails, and privacy architecture established.

## Current Blockers
- Need to verify Python 3, pip, and Git availability on the 2017 MacBook Pro.

## Next Concrete Task
- **Milestone 1:** Create the `seeing-sounds` folder, verify Python/Git in macOS Terminal, initialize the repository, and save `PROJECT_RECORD.md`.