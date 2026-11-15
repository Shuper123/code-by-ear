# Code by Ear: build status

- Live app: https://shuper123.github.io/code-by-ear/
- Spec: "Code by Ear: Build Plan" doc, https://claude.ai/artifact/CzQVMPkJ4s1w8pv6QvThSM (sections are numbered in
  order: 3 Decisions, 5 Sessions, 6 Grading, 7 Learning engine, 8 Content, 9 Verbal Syntax, 12 Safety and privacy,
  13 Milestones, 14 Testing)
- Last updated: 2026-11-14, after M4: neural voice, pacing, and the voice editor (Keys mode, edits) deployed

## Milestones

| Milestone | State | Notes |
| --- | --- | --- |
| M0 Skeleton, deploy, voice spikes | Deployed, waiting for phone test | "Voice check" on Home |
| M1 Level 1 for both languages | Deployed, waiting for phone test | 144 Level 1 drills, Drive and Parked sessions |
| M2 AI grading and Sketch | Deployed, waiting for phone test | AI grading, Sketch for SQL and Python, 24 ladders |
| M3 Verbal Syntax and Dictate | Deployed, waiting for phone test | Parser, edit commands, read-back, Dictate in Parked; 26 ladders |
| M4 Polish | Deployed, waiting for phone test | Progress, Drills browser, export and import, media buttons spike |
| After M4 (Joshua's requests) | Deployed, waiting for phone test | Neural voice (Kokoro), pacing, voice editor with Keys mode and plain-English edits |

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

M2
- AI client and the four prompts (`src/ai/prompts.ts`): grader, Sketch converter, error explainer, explain more.
  Strict JSON, one retry on invalid JSON, then fallback. System prompts are marked for prompt caching.
- AI grading for Level 1: Predict answers that don't match exactly, Explain, Spot the bug, Plan and Concept get a
  0 to 3 score and short spoken feedback. After a partial score, a short follow-up window takes "answer",
  "explain more" or "read it back".
- Sketch (Level 2), SQL and Python (`src/engine/sketch.ts`): speak a solution, the AI converts it literally, the
  app reads back what it heard plus any assumptions, then "go" runs it or "redo" re-listens. SQL runs in a sql.js
  worker and compares rows with the reference; Python runs hidden tests in a Pyodide worker with a 3-second kill.
  Failures get a plain-words explanation. Without a key, Sketch is offered as a Plan with self-rating.
- 24 ladders (12 SQL, 12 Python), each Plan, Sketch and Dictate (Dictate plays from M3). 216 drills in total,
  all validated (`reports/validation.md`).
- Settings: "Run AI self-test" (6 canned answers including an off-topic answer and a prompt injection),
  "Run converter check" (20 spoken Sketch answers; 16 buggy ones must stay buggy, 4 correct ones must pass),
  "Load Python now". Pyodide (about 12 MB) also downloads in the background from Home once a key is set.
- Drills browser (Home, Drills): practice any drill in a Parked session, which is the quickest way to try Sketch.
- Tests: 244 unit tests, including AI contract tests with mocked replies, simulated Sketch sessions using real
  sql.js and Pyodide in Node, and cross-engine checks (sql.js returns the same rows hash as Python's SQLite for all
  24 SQL references; Pyodide passes all 12 Python references). The browser smoke test now also runs SQL and
  Python Sketch end to end in headless Chrome with a fake Anthropic API (19 checks, all passing).

M3
- Verbal Syntax v0.1 parser (`src/verbal/syntax.ts`), rules only, no AI: normalize (lowercase, number words,
  recognizer punctuation and operator symbols), longest phrase first, the drill's vocabulary (multi-word, fuzzy with
  edit distance up to 2, sounds-alike, aliases), emit tokens with indent tracking, format with standard spacing.
  Code is kept as lines of tokens, so read-back, "scratch that" and "go to line" are exact.
- Edit commands (whole utterances only): scratch that, delete line, go to line N, read it back, read line, run it
  (also "done"), start over. Read-back speaks the code in Verbal Syntax words with indentation ("Line 2, indented
  once. count equals 0.").
- Dictate (Level 3, Parked only, `src/engine/dictate.ts`): the prompt gives the task and the spoken signature;
  you dictate in as many utterances as you like; the code builds on screen; "run it" checks syntax and runs the
  hidden tests (Python, Pyodide) or compares rows (SQL, sql.js). Syntax errors, unknown columns or tables and
  undefined names are not graded: the app says what's wrong and you fix it and run again. Scoring matches Sketch.
  Parked has Run it, Read it back and Scratch that buttons and a folded Verbal Syntax cheat sheet.
- Both worked examples from spec section 9 are now drills: `py-p3-dictate-013` (sum evens) and
  `sql-s3-dictate-013` (top 3 parts by total quantity), each a full ladder (Plan, Sketch, Dictate). 222 drills, all
  validated.
- Tests: 376 unit tests. 121 Verbal Syntax tests (both worked examples, every cheat sheet row, edit commands,
  read-back, dictated code passing ladder tests in Pyodide and sql.js) and 9 simulated Parked Dictate sessions
  (multi-utterance, fix-and-rerun, edit commands, silence, both worked examples). The browser smoke test dictates
  both worked examples in headless Chrome and checks the code on screen (all checks passing).

M4
- Export and import (`src/storage/backup.ts`, Progress, Backup): one JSON file with progress, notes, sessions and
  settings. The API key is never written to a backup, a key inside a hand-edited file is dropped, and importing keeps
  the key already on the phone. The file is checked before anything changes, the confirm step says what it holds,
  and the import replaces everything in one transaction (all or nothing), then restarts the app. "Share backup"
  uses the Android share sheet (for example, to save it to Drive).
- Progress: due today and tomorrow, streak, last 7 days, all-time answers and time, the two weakest units, mastery
  by unit and level, a ladder table (best Plan, Sketch and Dictate score for all 26 problems), recent sessions.
- Drills browser: filter by language, unit, type and status (new, due, last score 0 or 1, seen), search by words,
  topic or ID; tap a drill to see its code; filters stay put when you come back from a practice session.
- Media Session spike (`src/platform/mediaButtons.ts`): Settings, Listening, "Headset and steering-wheel buttons
  (experimental)", off by default. When on, a silent track loops during sessions so Android sends media buttons to
  the app: play/pause pauses or resumes, next skips, previous repeats. Voice check has a button test (card 6) that
  says and logs which buttons arrive; the copied report includes the log.
- Tests: 390 unit tests (backup round trip and key handling, damaged files, progress stats, media buttons with a
  fake MediaSession). The browser smoke test exports a backup, wipes progress, imports it, checks the key stayed,
  checks the Drills search and filters, and presses fake media buttons in a session (36 checks, all passing).

After M4 (requested by Joshua on 2026-11-14)
- **Pacing** (`src/engine/session.ts`, `src/speech/chunks.ts`): code is read one line at a time at its own slower
  speed (Settings, Pacing: code speed 0.85 of normal, 0.9 s pause after each line), announced with its line count
  ("Three lines.") when the spoken pieces match the code's lines. Drive reads the code twice ("Again.") before the
  question. "repeat line 2" (or "say the last line") replays one line. In Drive, new drills with 3 lines of code or
  fewer come first.
- **Neural voice** (`src/speech/voice.ts`, `neural.ts`, `kokoro.worker.ts`): Kokoro-82M (Apache-2.0), voice Heart.
  Every fixed sentence (drill prompts, code lines, model answers, hints, the app's own phrases) is pre-rendered at
  build time by `scripts/render_voice.py` into `public/voice/af_heart/<key>.ogg` (Opus, about 36 kbps) with
  `src/data/voice_manifest.json` listing them; the key is a hash of style plus sentence (`speechKey`). Clips get
  150 ms of lead-in silence, and after 4 s of quiet a short silence plays first, so a waking Bluetooth link doesn't
  clip words. New sentences (AI feedback, your code read back, the editor's answers) are generated on the phone by
  kokoro-js in a worker (WebGPU with the fp32 model when the GPU is available, else the q8 model on the CPU), then
  cached. An utterance never switches voices: if any sentence of it can't be neural yet, the whole utterance uses
  the phone voice. Settings, Voice quality: choose neural or phone, download all drill audio, turn on the on-phone
  model (best about 330 MB, or smaller about 90 MB, downloaded once from Hugging Face), test voice and pacing.
- **Voice editor for Dictate** (`src/verbal/editor.ts`, `keys.ts`, `edits.ts`, `src/app/EditorView.tsx`): the code
  is text with a cursor, shown with line numbers, the cursor, any selection, and a character ruler under the
  cursor's line. Code mode is Verbal Syntax inserted at the cursor (formatted); Keys mode types one keystroke per
  word (letters plain, NATO or Talon's alphabet, "capital X", numbers, symbols by name, space, tab, new line,
  backspace and delete with counts, arrow moves). Both modes: "edit at line 2 character 7", "go to line 3",
  "after equals", "before paren", "next match", "start/end of line", "left 3", "word right", "select word/line",
  "highlight total" ("select X" too, in Python), "delete line", "clear line", "delete word", "indent", "dedent",
  "undo"/"scratch that", "redo", "where am I", "read line", "spell line", "read it back", "check", "run it",
  "keys mode", "code mode". Each phrase applies as soon as the recognizer finishes it (no silence wait).
- **Live errors**: after every change the code goes through Python's own compiler (Pyodide) or SQLite (sql.js); the
  screen shows only the interpreter's message on its line (`SyntaxError: expected ':'`). Unfinished code (an open
  block or bracket, or a problem right at the end where you're still typing) isn't flagged; unknown SQL names wait
  for "check". Hints only when asked.
- **Plain-English edits**: "change count to total", "replace 3 with 5 on line 2", "rename x to total", "add a colon
  at the end of line 1", "insert plus one after count", "remove the colon on line 2", "swap lines 2 and 3",
  "move line 4 up" are rules (instant, offline). Anything else starting with an edit word ("make the loop count
  down") goes to Claude, which may make only that change (refused if it changes more than 4 lines).
- Tests: 440 unit tests (pacing, voice layer with fakes, editor, keys grammar, edits, live checks with real Pyodide
  and sql.js, simulated Dictate sessions in both modes, AI edits with a fake). The browser smoke test now also
  checks a live Python error and its Keys-mode fix, a plain-English edit, a drill spoken entirely from
  pre-recorded clips, and the on-phone voice generating a new sentence (with a local stand-in for Hugging Face).

## What to test on the phone

Current round (neural voice, pacing, voice editor): follow the phone test plan doc,
https://claude.ai/artifact/DsFEAS5iWzduvBqN3wT7E5 (setup, Parked voice and pacing, the car, the voice editor, what
to send back, pass criteria). Earlier milestone checks:

1. M0 list: install from Chrome, run the voice loop and the long-answer test in Voice check, at home and in the car.
2. Settings, Languages: SQL only. Start Drive at home or parked first; let it run about 20 minutes without touching
   the screen (M1 done-criterion). Try "repeat", "hint", "skip", "I don't know", "pause" then "continue".
3. Stay silent for two prompts: the session should pause itself and wait for "continue".
4. Start Parked: code and your transcript appear on screen; say "stop session" to end and hear the recap.
5. Close the app and reopen: Progress should still show your answers and due counts.
6. Paste the Voice check report (Copy report) into the build chat, plus anything that misbehaved.
7. M2: create an Anthropic key scoped to one workspace with a low monthly spend limit, paste it in Settings on the
   phone, then tap "Run AI self-test" (expect 6 of 6, each in a few seconds) and "Run converter check" (expect 20
   of 20; any failure names the bug the converter fixed or kept).
8. Drills, SQL, S3 Aggregates, Sketch "find the total quantity produced for each part": Practice, say the query in
   words, then "go". Then Python, P3, Sketch "count above" (the first Python run downloads about 12 MB).
9. A Parked Explain drill with the key: feedback should arrive in about 4 seconds. Remove the key: the same drill
   falls back to self-rating.
10. M3 done-criterion: Drills, Python, P3, type Dictate, "sum evens", Practice. Say worked example 1 from spec
    section 9 (in one breath or in pieces), watch the code build, say "read it back", then "run it". Then Drills,
    SQL, S3, Dictate, "three parts with the largest total quantity", and say worked example 2, then "run it".
11. Try the edit commands: "scratch that" after a wrong piece, "go to line 2", "delete line", "start over". Leave
    off a colon on purpose: "run it" should tell you it doesn't parse yet and let you fix it, not grade it.
12. Note any word the recognizer keeps mishearing (for example "colon" or "paren"); the YOU box shows exactly what
    it heard. Those become aliases in the parser.
13. M4: Progress, Backup, Export progress (a file lands in Downloads). Then Import progress, pick that file, check
    the summary, Replace my progress. Progress should look the same, and Settings should still show your key.
14. Voice check, card 6, Start button test: press play/pause, next and previous on a Bluetooth headset and on the
    steering wheel, with the app in front and then with the voice loop running. Copy the report into the chat.
15. If the buttons arrive, turn on Settings, Listening, "Headset and steering-wheel buttons" and try a Drive
    session: one press should pause, another should resume. Note whether speech or recognition got worse.
16. The full on-phone checklist in spec section 14 is the M4 done-criterion.

## Known issues and open questions

- Not yet verified on a real phone: Android restart chimes, gap length between recognizer runs, Bluetooth hands-free
  mic switching (spec section 16 risks). If restart chimes are bad while paused, turn off Settings, Listening,
  "While paused, keep listening for continue" and tap to resume instead.
- Live AI quality (scores, and whether the converter stays literal) can only be checked with a real key: that is
  what the two Settings checks are for. Automated tests use mocked replies.
- Sketch read-back repeats the transcript and assumptions, not the converted code (Parked shows the code).
- In sessions, a ladder's Sketch opens only after its unit's Level 1 average reaches 2.0 over 10 attempts and the
  ladder's Plan scored 2 or more, and Dictate after Sketch passes; use Drills to try either sooner.
- Verbal Syntax has only been tested with typed transcripts and fake speech. Real recognizer output for words like
  "colon", "paren" and "def" is the main unknown; keywords are not fuzzy-matched yet (names are).
- Dictate grades only when you say "run it", so a long silence pauses the session (after one reminder) rather
  than scoring a 0.
- Media buttons are a spike: whether Android routes car buttons to a web app, and whether the silent track fights
  speech recognition or text-to-speech for audio focus, is only knowable on the phone. With it on, the car display
  may show "Code by Ear" as now playing. It stays off by default until the button test says it works.
- Spec gap: Dictate opens after Sketch passes, but without a key Sketch is a self-rated Plan. A self-rated 2 or
  more on that Plan counts as a pass so Dictate doesn't stay locked forever without a key.
- The headless test browser has no real voices or microphone; speech was tested with fakes only.
- The on-phone Kokoro model can't be fetched from this build machine (Hugging Face is blocked here), so it was
  tested against a local stand-in built from the kokoro-onnx release (`scripts/make_fake_hf.py`): the plumbing is
  verified, the real model's speed and sound on the Fold 7 are not. WebGPU was not testable headless.
- Pronunciation of code words by Kokoro (for example "qty", "len", "def") hasn't been heard by a person yet. Odd
  ones can be fixed by rewording that drill's spoken text and re-rendering.
- Keys mode letters depend on how Android's recognizer writes single letters; plain letter names are the least
  reliable (Talon's or NATO words are safer). Grammar biasing isn't possible in Chrome on Android.

## Decisions and deviations from the spec

- **Locked decision changed, with Joshua's OK (2026-11-14):** the Speech row was "Chrome's built-in speech
  recognition and the phone's text-to-speech voices". Joshua chose the on-device neural voice ("voice option 3")
  for quality and consistency, accepting larger downloads. Now: Chrome's recognition (unchanged) plus the Kokoro
  neural voice (pre-rendered drill audio plus on-phone generation), with the phone's voice as the fallback and a
  Settings switch back to it. Still free and keyless. Recognition is unchanged; an on-device grammar recognizer
  (Vosk) for Keys mode would need his OK.
- **Pacing:** code speed and pauses are separate settings from speech rate; reading code twice is Drive only
  (Parked shows the code). A number right after a move or backspace in Keys mode is its count ("backspace three");
  say "number three" to type a digit there.
- **Keys mode spacing:** nothing is added that you didn't say (no automatic spaces); words that aren't keystroke
  names are typed as said. New line keeps the indent and adds one after a colon.
- **SQL:** "select ..." and a bare "end" stay code in SQL; "highlight X" selects there.
- **"check it"** now only checks syntax (it used to run the code); "run it", "done", "I'm done" run it.

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
- **Sketch scoring.** Pass is 3 (2 with hints). SQL with wrong rows is 1; a query error is 0. Python with at least
  half the tests passing is 1, otherwise 0, and a 0 plays the model answer. At the read-back, silence after one
  reminder runs the code.
- **Row comparison** also accepts the right columns in a different order (spec says ignore column names).
- **SQL Predict drills** state the facts they need ("Lots 1 to 5 have quantities ...") and run against the real
  factory data, or use plain expressions. Some ask for a row count (`answer_kind: "row_count"`).
- **Level 2 opens** after at least 10 Level 1 attempts in the unit averaging 2.0 or more.
- **Verbal Syntax workshop questions (spec section 9), as built:** 1. "next" and "new line" both work. 2. Yes,
  "sum of qty" writes `SUM(qty)` (SQL: sum, count, avg, min, max, upper, lower, length; Python: len, sum, sorted,
  max, min, int, str and similar); the paren closes after the next name or value. 3. Other parentheses never close
  by themselves; say "close paren". 4. Plain letters and NATO words both work for "spell". 5. No automatic
  read-back per line: Parked shows the code, and "read it back" or "read line" speaks it on request.
- **Dictate edits:** "done" also means run it. Fixable errors (syntax, unknown column or table, undefined name)
  don't count as an attempt; you fix and re-run. Test failures and wrong rows are graded like Sketch.
- **Worked examples as drills:** added ladder 13 in P3 and S3 so the M3 done-criterion can be run from Drills.
- **Import replaces, it doesn't merge.** A backup restores the phone to that moment. The API key is excluded from
  exports and untouched by imports (spec section 12 lists the key with the stored data; leaving it out of the file
  keeps it from spreading with a backup).
- **Media buttons:** play, pause and stop all toggle pause by the session's own state (speech can pause the silent
  track behind the app's back); next track and seek forward skip; previous track and seek back repeat.
- Toolchain pinned to well-known majors: Vite 7.3, Preact 10.29, TypeScript 5.9, Vitest 3.2, vite-plugin-pwa 1.3, idb 8.
- Recognizer defaults: `continuous = false` (one phrase per run, restarted by the app), restart delay 120 ms. Both
  are adjustable in Settings, Listening, Recognizer options.

## How to work on this repo

- `npm ci`; `npm run dev`; `npm test`; `npm run validate` (builds drills from `content/`, then runs them all);
  `npm run build`; `npm run smoke` (needs Python playwright and Chrome; run after `npm run build`);
  `npm run datasets` (regenerate data).
- Ladders: `content/_ladder.py` builds Plan, Sketch and Dictate from one problem; each unit file appends its two.
- Runtimes: `scripts/copy_runtimes.mjs` copies sql.js wasm and the Pyodide core into `public/runtimes/` at build
  time (served from the app's own origin; Pyodide is runtime-cached by the service worker, not precached).
- Adding drills: edit `content/<lang>_<unit>.py`, run `npm run validate`, fix every error, commit the generated JSON
  and `reports/validation.md` together with the source.
- Deploy: commit everything (including this file), then `npm run deploy`. The script validates drills, runs unit
  tests, builds, pushes the branch, and commits `dist/` plus `.nojekyll` to `gh-pages` (normal commit, no force).
- Layout follows spec section 10: `src/app` screens, `src/engine` session/scheduler/queue/unlock/progress,
  `src/speech` stt/tts/cues/commands, `src/grading`, `src/runtimes`, `src/verbal`, `src/ai`, `src/data`,
  `src/storage`, `scripts/`, `tests/`.
- The engine gets speech, time and storage injected (`EngineDeps`), so `tests/session.test.ts` can simulate whole
  sessions. AI grading, Sketch and Dictate plug in through `typeHooks` (see `makeSketchHook`, `makeDictateHook`)
  wired up in `src/app/SessionScreen.tsx`.
- Never commit an API key. Never ask the user to paste a key into chat.
- Neural voice: after changing any spoken text (drills or the app's fixed sentences), run `npm run voice`
  (`vite-node scripts/voice_texts.ts`, then `scripts/render_voice.py --prune`): it renders only new sentences.
  Needs `pip install kokoro-onnx soundfile` and the model files from the kokoro-onnx GitHub release
  (model-files-v1.0: kokoro-v1.0.onnx, voices-v1.0.bin; plus kokoro-v1.0.int8.onnx for the test stand-in) in
  `$KOKORO_MODEL_DIR` or `../tools/kokoro-model`. Commit the new `public/voice/` files and the manifest.
- On-phone voice test stand-in: `python3 scripts/make_fake_hf.py` (needs `pip install onnx`), then `npm run smoke`.

## Next steps

- Joshua's phone test of the neural voice, pacing and the voice editor (test plan doc), then: aliases for misheard
  words, pacing defaults, which alphabet to teach, and whether Keys mode needs an on-device grammar recognizer
  (Vosk would change the locked Speech decision, so only with Joshua's OK).
- Run the on-phone checklist (spec section 14) and paste the Voice check report, including the button test, into
  the build chat.
- From those results: add aliases for words the recognizer mishears (consider fuzzy matching for keywords), tune
  silence windows and restart delay, and decide whether media buttons stay experimental, become the default, or go.
- Still open in spec section 3: whether to release publicly after the two-week test (Joshua's call).
