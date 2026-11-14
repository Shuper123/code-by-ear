#!/usr/bin/env python3
"""End-to-end smoke test of the built app in headless Chrome with fake speech.

Serves dist/ with `vite preview`, injects a fake SpeechRecognition and fake speechSynthesis (so the real
engine, UI, IndexedDB and service worker run), clicks through Home, a Parked session, the recap,
Progress (after a reload, to prove persistence) and a Drive session with pause. Saves screenshots.

Needs: Python playwright and a Chrome binary.  Usage: python3 scripts/browser_smoke.py [outdir]
Exit code 1 on console errors or failed checks.
"""
import asyncio
import os
import subprocess
import sys
import time

from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/cbe-smoke"
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
URL = "http://localhost:4173/code-by-ear/"

FAKE_SPEECH = r"""
(() => {
  window.__said = [];
  window.__heard = [];
  const voice = { name: 'Fake voice', lang: 'en-US', localService: true, voiceURI: 'fake', default: true };
  let speaking = false;
  const synth = {
    get speaking() { return speaking; }, paused: false, pending: false,
    getVoices: () => [voice],
    addEventListener() {}, removeEventListener() {},
    cancel() { speaking = false; }, resume() {}, pause() {},
    speak(u) {
      if (u.text.trim()) window.__said.push(u.text);
      speaking = true;
      setTimeout(() => { u.onstart && u.onstart({}); }, 5);
      setTimeout(() => { speaking = false; u.onend && u.onend({}); }, 40);
    },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (text) { this.text = text; this.rate = 1; this.volume = 1; };

  // The fake user answers once after each thing the app says, like a person would.
  window.__answeredAt = -1;
  function answerFor() {
    if (window.__answeredAt === window.__said.length) return null;
    window.__answeredAt = window.__said.length;
    const last = window.__said[window.__said.length - 1] || '';
    if (window.__script) return window.__script(last);
    if (/Say yes, partly/.test(last)) return 'yes';
    if (/Say continue/.test(last)) return 'continue';
    return 'one';
  }
  class FakeRecognition {
    constructor() { this.continuous = false; this.interimResults = false; this.lang = 'en-US'; this.maxAlternatives = 1; this._live = false; }
    start() {
      this._live = true;
      setTimeout(() => { if (!this._live) return; this.onstart && this.onstart({}); this.onaudiostart && this.onaudiostart({}); }, 30);
      setTimeout(() => {
        if (!this._live) return;
        const text = answerFor();
        if (!text) { this.onerror && this.onerror({ error: 'no-speech' }); this._end(); return; }
        window.__heard.push(text);
        this.onspeechstart && this.onspeechstart({});
        const res = [{ 0: { transcript: text }, length: 1, isFinal: true }];
        this.onresult && this.onresult({ resultIndex: 0, results: res });
        setTimeout(() => this._end(), 150);
      }, 350);
    }
    _end() { if (!this._live) return; this._live = false; this.onaudioend && this.onaudioend({}); this.onend && this.onend({}); }
    stop() { this._end(); }
    abort() { this._end(); }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
})();
"""


async def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen(["npx", "vite", "preview", "--port", "4173", "--strictPort"], cwd=ROOT,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(3)
    errors, failures = [], []

    def check(cond, msg):
        print(("ok   " if cond else "FAIL ") + msg)
        if not cond:
            failures.append(msg)

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=CHROME)
            ctx = await browser.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2,
                                            is_mobile=True, has_touch=True)
            await ctx.add_init_script(FAKE_SPEECH)
            page = await ctx.new_page()
            page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
            await page.goto(URL, wait_until="networkidle")
            await page.get_by_text("I understand").click()
            await page.wait_for_timeout(400)
            await page.screenshot(path=f"{OUT}/10-home.png", full_page=True)
            check(await page.get_by_text("Start Drive").count() == 1, "Home shows Start Drive")

            # Parked session: lower the silence windows so the fake answers go fast
            await page.evaluate("""async () => {
              const req = indexedDB.open('code-by-ear', 1);
              await new Promise(r => req.onsuccess = r);
              const db = req.result;
              const tx = db.transaction('kv', 'readwrite');
              const st = tx.objectStore('kv');
              const g = st.get('settings');
              await new Promise(r => g.onsuccess = r);
              st.put({ ...(g.result || {}), silenceParkedMs: 1500, silenceDriveMs: 1500 }, 'settings');
              await new Promise(r => tx.oncomplete = r);
            }""")
            await page.reload(wait_until="networkidle")
            await page.get_by_text("Start Parked").click()
            await page.wait_for_timeout(15000)
            await page.screenshot(path=f"{OUT}/11-parked.png", full_page=True)
            said = await page.evaluate("window.__said")
            check(any(s.startswith("Parked session") for s in said), "Parked session intro was spoken")
            check(any("Say yes, partly" in s for s in said), "self-rating prompt was spoken")
            done_text = await page.locator(".pill", has_text="done").first.inner_text()
            check(int(done_text.split()[0]) >= 2, f"at least two drills finished ({done_text})")
            await page.get_by_text("End", exact=True).click()
            await page.wait_for_timeout(1500)
            await page.screenshot(path=f"{OUT}/12-recap.png", full_page=True)
            check(await page.get_by_text("Session over").count() >= 1, "recap screen shows the spoken recap")

            # Persistence: reload, open Progress
            await page.reload(wait_until="networkidle")
            await page.get_by_text("Progress", exact=True).first.click()
            await page.wait_for_timeout(800)
            await page.screenshot(path=f"{OUT}/13-progress.png", full_page=True)
            body = await page.inner_text("body")
            check("answers in" in body and " 0 answers" not in body, "progress persisted across a reload")
            await page.go_back()
            await page.wait_for_timeout(400)

            # Drive session: dark screen, tap to pause, then end
            await page.get_by_text("Start Drive").click()
            await page.wait_for_timeout(5000)
            await page.screenshot(path=f"{OUT}/14-drive.png")
            check(await page.locator("button.drive").count() == 1, "Drive shows one full-screen target")
            check(await page.locator(".code").count() == 0, "Drive shows no code")
            # while paused the fake user stays quiet, so the session stays paused
            await page.evaluate("window.__script = (last) => /continue|paused/i.test(last) ? null : 'one'")
            await page.locator("button.drive").click()
            await page.wait_for_timeout(1500)
            await page.screenshot(path=f"{OUT}/15-drive-paused.png")
            check(await page.get_by_text("Paused").count() >= 1, "tapping the screen pauses")
            await page.get_by_text("End session").click()
            await page.wait_for_timeout(1500)
            check(await page.get_by_text("Session over").count() >= 1 or await page.get_by_text("No drills").count() >= 1,
                  "ending a Drive session shows the recap")
            await browser.close()
    finally:
        srv.terminate()
    real_errors = [e for e in errors if "favicon" not in e]
    check(not real_errors, f"no console errors ({len(real_errors)})")
    for e in real_errors[:10]:
        print("   ", e[:300])
    print(f"screenshots in {OUT}")
    sys.exit(1 if failures else 0)


asyncio.run(main())
