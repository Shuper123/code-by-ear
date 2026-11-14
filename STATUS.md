# Code by Ear: build status

- Live app: https://shuper123.github.io/code-by-ear/
- Spec: "Code by Ear: Build Plan" doc, https://claude.ai/artifact/CzQVMPkJ4s1w8pv6QvThSM (sections are numbered in
  order: 3 Decisions, 8 Content, 9 Verbal Syntax, 12 Safety and privacy, 13 Milestones, 14 Testing)
- Last updated: 2026-11-14, milestone 0 deployed

## Milestones

| Milestone | State | Notes |
| --- | --- | --- |
| M0 Skeleton, deploy, voice spikes | Deployed, waiting for phone test | Spike screen on Home |
| M1 Level 1 for both languages | Not started | |
| M2 AI grading and Sketch | Not started | |
| M3 Verbal Syntax and Dictate | Not started | |
| M4 Polish | Not started | |

## What works (M0)

- Installable PWA (manifest, icons, service worker precaching the app). Updates wait for a tap on "Reload" on Home,
  so an update never interrupts a session.
- First-launch notice (driving safety + what goes to Google and Anthropic).
- Settings: API key (IndexedDB only, never exported), optional workspace ID, grading and Sketch models, voice, speech
  rates, silence windows, thinking time, recognizer options, session options.
- Voice spike screen: voice loop (speak drill, beep, listen across pauses, read back, result tone), 20-second long
  answer test with restart-gap stats, all six tones, Wake Lock toggle, one test AI call, copyable diagnostics report.
- Unit tests (24): speech restart loop with a fake Android-style recognizer, Anthropic client contract (headers,
  retry, timeout, JSON retry then fallback).

## What to test on the phone (M0 done-criteria)

1. Open the live link in Chrome on the Fold, install it (menu, Add to Home screen or Install app), open it from the
   home screen. It should open full screen with the first-launch notice.
2. Voice spike, "Run voice loop": hear the drill, answer "one" after the beep, hear "I heard: one" and the correct tone.
3. "Long answer test": talk about 20 seconds with pauses, say "done". Check the pieces joined correctly. Note whether
   the phone chimes on each recognizer restart.
4. Tones, Wake Lock (screen stays on), and, after adding a key in Settings, "Make test AI call".
5. Repeat 2 and 3 in the car over Bluetooth.
6. Tap "Copy report" and paste it into the build chat.

## Known issues and open questions

- Not yet verified on a real phone: Android restart chimes, gap length between recognizer runs, Bluetooth hands-free
  mic switching (spec section 16 risks). The spike screen exists to measure these.
- Headless test browser has no voices or microphone, so speech was only tested with fakes.

## Decisions and deviations from the spec

- **No temperature in AI calls.** The spec's headers (`Authorization: Bearer`, `anthropic-version: 2026-10-21`) match
  the current Claude API docs, but API version 2026-10-21 removed `temperature`, `top_p` and `top_k`; sending any of
  them is a 400 error on every model. Requests therefore omit them; the temperature column in spec section 11 is not
  applied. Literal Sketch conversion relies on the prompt and the adversarial tests instead.
- **Workspace ID setting.** Current API keys can be scoped to all workspaces; such keys need an
  `anthropic-workspace-id` header or the API returns 400. Settings has an optional field; a key scoped to one
  workspace needs nothing.
- Toolchain pinned to well-known majors: Vite 7.3, Preact 10.29, TypeScript 5.9, Vitest 3.2, vite-plugin-pwa 1.3, idb 8.
- Recognizer defaults: `continuous = false` (one phrase per run, restarted by the app), restart delay 120 ms. Both
  are adjustable in Settings, Listening, Recognizer options, so the phone test can compare.

## How to work on this repo

- `npm ci`, then `npm run dev`, `npm test`, `npm run validate` (from M1), `npm run build`.
- Deploy: commit everything (including this file), then `npm run deploy`. The script validates drills, runs unit
  tests, builds, pushes the branch, and commits `dist/` plus `.nojekyll` to `gh-pages` (normal commit, no force).
- Layout follows spec section 10: `src/app` screens, `src/engine` session/scheduler, `src/speech` stt/tts/cues,
  `src/grading`, `src/runtimes`, `src/verbal`, `src/ai`, `src/data`, `src/storage`, `scripts/`, `tests/`.
- Never commit an API key. Never ask the user to paste a key into chat.

## Next steps

- M1: generate datasets, drill validation script, at least 40 Level 1 drills per language, session engine (Drive and
  Parked), SM-2 scheduler, unlock rules, storage, self-rating and recap.
