# Code by Ear: build status

- Live app: https://shuper123.github.io/code-by-ear/
- Spec: "Code by Ear: Build Plan" doc, https://claude.ai/artifact/CzQVMPkJ4s1w8pv6QvThSM (sections are numbered in
  order: 3 Decisions, 5 Sessions, 6 Grading, 7 Learning engine, 8 Content, 9 Verbal Syntax, 12 Safety and privacy,
  13 Milestones, 14 Testing)
- Last updated: 2026-11-14, milestone 1 deployed

## Milestones

| Milestone | State | Notes |
| --- | --- | --- |
| M0 Skeleton, deploy, voice spikes | Deployed, waiting for phone test | "Voice check" on Home |
| M1 Level 1 for both languages | Deployed, waiting for phone test | 144 Level 1 drills, Drive and Parked sessions |
| M2 AI grading and Sketch | Not started | |
| M3 Verbal Syntax and Dictate | Not started | |
| M4 Polish | Not started | Basic Progress screen already exists |

## What works

M0
- Installable PWA (manifest, icons, service worker). Updates wait for a tap on "Reload" on Home, so an update never
  interrupts a session. Build version and commit are shown at the bottom of Home and Settings.
- First-launch notice (driving safety + what goes to Google and Anthropic).
- Settings: API key (IndexedDB only, never exported), optional workspace ID, models, voice, speech rates, silence
  windows, thinking time, tone volume, recognizer options, session length, new drills per session, language mix.
- Voice check screen (the M0 spike): voice loop, 20-second answer test with restart-gap stats, six tones, Wake
  Lock, one test AI call, copyable diagnostics report.

M1
- Datasets: `factory` and `shop`, generated from a fixed seed by `scripts/generate_datasets.py` into
  `src/data/datasets/*.sql` with every edge case from spec section 8.
- Drills: 144 Level 1 drills (71 SQL, 73 Python; Predict, Explain, Spot the bug, Plan, Concept) across all 12 units.
  Authored in `content/*.py`, built to `src/data/drills/<unit>.json` by `scripts/build_drills.py`.
- Validation: `scripts/validate_drills.py` runs every drill with real Python and real SQLite, checks Spot-the-bug
  pairs (buggy fails, fixed passes), lints spoken text and Drive limits, and writes `reports/validation.md`.
  Current result: PASS, 0 errors.
- Session engine (`src/engine/session.ts`): spoken prompt, beep, listen across pauses, voice commands, grading,
  spoken feedback, SM-2 scheduling, recap. Drive is voice only on a black full-screen Pause target; Parked shows
  code, transcript and buttons.
- Voice commands: repeat, slower, faster, hint, skip, "I don't know", answer, read it back, wait, done, pause,
  continue, stop session. Commands count only as whole utterances.
- Grading without a key: Predict answers are normalized (number words, lists, True/None, error names) and
  auto-scored when they match; everything else plays the model answer, then you say yes, partly, no or easy.
- Learning engine: SM-2 variant, reviews first, about 5 new drills, languages in blocks of three, unit unlock at
  80% seen, level 2 unlock rule (used from M2), score-0 drills requeue once, top-up when the plan runs out.
- Safety behavior: two unanswered prompts in a row pause the session; a break is offered every 10 minutes; the
  session pauses when the app is hidden and asks for "continue" on return; Wake Lock held during sessions.
- Progress screen: mastery per unit and level (average of the last 10 scores), due counts, recent sessions.
- Tests: 184 unit tests (normalizer 59 cases, commands, scheduler, unlock rules, queue, every drill's answer key,
  speech restart loop, API client, simulated 20-minute Drive session, auto-pause, commands, two-day persistence).
  `scripts/browser_smoke.py` runs the built app in headless Chrome with fake speech (11 checks, all passing).

## What to test on the phone

1. M0 list: install from Chrome, run the voice loop and the long-answer test in Voice check, at home and in the car.
2. Settings, Languages: SQL only. Start Drive at home or parked first; let it run about 20 minutes without touching
   the screen (M1 done-criterion). Try "repeat", "hint", "skip", "I don't know", "pause" then "continue".
3. Stay silent for two prompts: the session should pause itself and wait for "continue".
4. Start Parked: code and your transcript appear on screen; say "stop session" to end and hear the recap.
5. Close the app and reopen: Progress should still show your answers and due counts.
6. Paste the Voice check report (Copy report) into the build chat, plus anything that misbehaved.

## Known issues and open questions

- Not yet verified on a real phone: Android restart chimes, gap length between recognizer runs, Bluetooth hands-free
  mic switching (spec section 16 risks). If restart chimes are bad while paused, turn off Settings, Listening,
  "While paused, keep listening for continue" and tap to resume instead.
- Without AI grading (M2), Predict answers that don't match the expected output exactly fall back to self-rating,
  and Explain, Plan, Concept and Spot-the-bug answers are always self-rated.
- The headless test browser has no real voices or microphone; speech was tested with fakes only.

## Decisions and deviations from the spec

- **No temperature in AI calls.** The spec's headers (`Authorization: Bearer`, `anthropic-version: 2026-10-21`) match
  the current Claude API docs, but API version 2026-10-21 removed `temperature`, `top_p` and `top_k`; sending any of
  them is a 400 error on every model. Requests omit them, so the temperature column in spec section 11 is not
  applied. Literal Sketch conversion relies on the prompt and the adversarial tests instead.
- **Workspace ID setting.** Keys scoped to all workspaces need an `anthropic-workspace-id` header or the API returns
  400. Settings has an optional field; a key scoped to one workspace needs nothing.
- **Hints cap the score at 2** (a 3 means correct and complete without help). Not in the spec; easy to remove in
  `src/engine/session.ts`.
- **A bare "stop" pauses**; "stop session" or "end session" ends the session. "continue", "break" and "pass" are
  not commands while answering, because they are also Python answers.
- **Thinking time.** A prompt counts as unanswered after 15 seconds with no words (Settings, Listening). The spec's
  4 s and 2.5 s silence windows apply once you've started talking.
- **SQL Predict drills** state the facts they need ("Lots 1 to 5 have quantities ...") and run against the real
  factory data, or use plain expressions. Some ask for a row count (`answer_kind: "row_count"`).
- **Level 2 opens** after at least 10 Level 1 attempts in the unit averaging 2.0 or more.
- Toolchain pinned to well-known majors: Vite 7.3, Preact 10.29, TypeScript 5.9, Vitest 3.2, vite-plugin-pwa 1.3, idb 8.
- Recognizer defaults: `continuous = false` (one phrase per run, restarted by the app), restart delay 120 ms. Both
  are adjustable in Settings, Listening, Recognizer options.

## How to work on this repo

- `npm ci`; `npm run dev`; `npm test`; `npm run validate` (builds drills from `content/`, then runs them all);
  `npm run build`; `npm run smoke` (needs Python playwright and Chrome); `npm run datasets` (regenerate data).
- Adding drills: edit `content/<lang>_<unit>.py`, run `npm run validate`, fix every error, commit the generated JSON
  and `reports/validation.md` together with the source.
- Deploy: commit everything (including this file), then `npm run deploy`. The script validates drills, runs unit
  tests, builds, pushes the branch, and commits `dist/` plus `.nojekyll` to `gh-pages` (normal commit, no force).
- Layout follows spec section 10: `src/app` screens, `src/engine` session/scheduler/queue/unlock/progress,
  `src/speech` stt/tts/cues/commands, `src/grading`, `src/runtimes`, `src/verbal`, `src/ai`, `src/data`,
  `src/storage`, `scripts/`, `tests/`.
- The engine gets speech, time and storage injected (`EngineDeps`), so `tests/session.test.ts` can simulate whole
  sessions. Milestone 2 plugs AI grading and Sketch in through `sessionExtensions` in `src/app/SessionScreen.tsx`.
- Never commit an API key. Never ask the user to paste a key into chat.

## Next steps

- M2: Anthropic client prompts (grader, Sketch converter, error explainer, hint), AI grading for Level 1, Sketch
  with sql.js row comparison and a Pyodide worker with tests and a 3-second kill, assumption read-back, at least
  12 ladders per language, "Run AI self-test" in Settings, AI contract tests.
