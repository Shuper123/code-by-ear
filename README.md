# Code by Ear

Hands-free SQL and Python practice by ear: the app speaks a drill, listens to your spoken answer, grades it and
schedules the next review. Installable web app (PWA) for Chrome on Android, hosted on GitHub Pages.

- Live app: https://shuper123.github.io/code-by-ear/
- Build status, known issues and next steps: [STATUS.md](STATUS.md)

## Develop

```bash
npm ci
npm run dev        # local dev server
npm test           # unit tests (Vitest)
npm run validate   # run every drill and write reports/validation.md (from milestone 1)
npm run build      # production build into dist/
npm run deploy     # checks, build, push, publish dist/ to the gh-pages branch
```

Speech recognition only works in Chrome over HTTPS (or localhost) and needs a microphone.

## Privacy

No accounts, analytics or ads. Progress, notes, settings and the optional Anthropic API key live in IndexedDB on the
phone. Chrome's speech recognition sends audio to Google for transcription. AI grading sends only the drill and the
answer text to Anthropic. Never commit an API key to this repository.
