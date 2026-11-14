#!/usr/bin/env python3
"""End-to-end smoke test of the built app in headless Chrome with fake speech.

Serves dist/ with `vite preview`, injects a fake SpeechRecognition and fake speechSynthesis (so the real
engine, UI, IndexedDB and service worker run), clicks through Home, a Parked session, the recap,
Progress (after a reload, to prove persistence) and a Drive session with pause. Saves screenshots.

Needs: Python playwright and a Chrome binary.  Usage: python3 scripts/browser_smoke.py [outdir]
Exit code 1 on console errors or failed checks.
"""
import asyncio
import json
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

  // The fake user answers once per listen (the app counts listens in window.__cbeListenSeq).
  window.__answeredSeq = -1;
  function answerFor() {
    if (window.__answeredSeq === window.__cbeListenSeq) return null;
    const last = window.__said[window.__said.length - 1] || '';
    let text = 'one';
    if (window.__script) text = window.__script(last);
    else if (/Say yes, partly/.test(last)) text = 'yes';
    else if (/Say continue/.test(last)) text = 'continue';
    if (text) window.__answeredSeq = window.__cbeListenSeq;  // staying quiet doesn't use up the turn
    return text;
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

  // Media Session: keep a handle on the handlers the app registers, so the test can "press" buttons.
  window.__media = {};
  if (navigator.mediaSession) {
    const orig = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
    navigator.mediaSession.setActionHandler = (a, h) => { window.__media[a] = h; try { orig(a, h); } catch (e) {} };
  }
})();
"""


FAKE_KEY = "sk-ant-test-not-a-real-key"
api_calls = []


async def fake_anthropic(route):
    """Stand-in for api.anthropic.com: checks the request shape and answers like the real API."""
    req = route.request
    cors = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS"}
    if req.method == "OPTIONS":
        await route.fulfill(status=204, headers=cors)
        return
    body = json.loads(req.post_data or "{}")
    h = req.headers
    ok_headers = (h.get("authorization") == f"Bearer {FAKE_KEY}" and h.get("anthropic-version") == "2026-10-21"
                  and h.get("anthropic-dangerous-direct-browser-access") == "true" and "temperature" not in body)
    system = body.get("system", [{}])[0].get("text", "")
    user = body["messages"][0]["content"]
    api_calls.append({"ok_headers": ok_headers, "system": system[:40]})
    if not ok_headers:
        await route.fulfill(status=400, headers=cors, json={"error": {"message": "bad request shape"}})
        return
    if system.startswith("Convert the learner"):
        if "count_above" in user:
            code = "def count_above(nums, limit):\n    count = 0\n    for n in nums:\n        if n > limit:\n            count += 1\n    return count\n"
        else:
            code = "SELECT part_id, SUM(qty) FROM lots GROUP BY part_id;"
        text = json.dumps({"code": code, "assumptions": ["I took quantity to mean qty."], "unclear": []})
    elif system.startswith("You grade"):
        t = user.split("<transcript>")[1].lower()
        bad = any(w in t for w in ["favorite color", "ignore all previous", "adds two numbers"])
        text = json.dumps({"score": 0 if bad else 3, "verdict": "incorrect" if bad else "correct",
                           "feedback_spoken": "Not quite." if bad else "Right, it builds and prints the full name.", "missed": []})
    else:
        text = json.dumps({"feedback_spoken": "Look at the grouping step."})
    await route.fulfill(status=200, headers={**cors, "content-type": "application/json"},
                        json={"content": [{"type": "text", "text": text}], "model": body["model"], "stop_reason": "end_turn"})


async def set_kv(page, key, value):
    await page.evaluate("""async ([k, v]) => {
      const req = indexedDB.open('code-by-ear', 1);
      await new Promise(r => req.onsuccess = r);
      const tx = req.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(v, k);
      await new Promise(r => tx.oncomplete = r);
    }""", [key, value])


async def practice(page, drill_id, script, wait_for, timeout_ms=60000):
    await page.goto(URL, wait_until="networkidle")
    await page.evaluate("(src) => { window.__script = (0, eval)(src) }", script)
    await page.get_by_text("Drills", exact=True).first.click()
    lang = "python" if drill_id.startswith("py-") else "sql"
    await page.locator("select").first.select_option(lang)
    await page.wait_for_timeout(200)
    item = page.locator(".drill-item", has_text=drill_id)
    await item.get_by_text("Practice").click()
    await page.wait_for_function(f"window.__said.some(s => s.includes({json.dumps(wait_for)}))", timeout=timeout_ms)


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

            # ---------- M2: AI grading and Sketch, with a fake Anthropic API and real sql.js / Pyodide ----------
            await page.route("https://api.anthropic.com/**", fake_anthropic)
            await page.goto(URL, wait_until="networkidle")
            await set_kv(page, "apiKey", FAKE_KEY)
            # the fake user waits at the read-back, so the converted code can be checked on screen
            await practice(page, "sql-s3-sketch-004",
                           "(last) => /Say go to run it/.test(last) ? (window.__hold ? null : 'go') : /Sketch\\./.test(last) ? "
                           "'select part id and the sum of quantity from lots grouped by part id' : null",
                           "Say go to run it")
            await page.wait_for_timeout(300)
            await page.screenshot(path=f"{OUT}/20-sql-sketch-readback.png", full_page=True)
            check(await page.get_by_text("SELECT part_id, SUM(qty)").count() >= 1, "SQL Sketch: converted code shown in Parked")
            await page.wait_for_function("window.__said.some(s => s.includes('Correct. Your rows match the answer.'))", timeout=60000)
            check(True, "SQL Sketch ran end to end in sql.js and scored correct")
            await practice(page, "py-p3-sketch-005",
                           "(last) => /Say go to run it/.test(last) ? 'go' : /Sketch\\./.test(last) ? "
                           "'count starts at zero, for each n in nums if n is greater than limit add one, return count' : null",
                           "Correct. All the tests pass.", timeout_ms=120000)
            await page.screenshot(path=f"{OUT}/21-py-sketch.png", full_page=True)
            check(True, "Python Sketch ran end to end in Pyodide and scored correct")
            await practice(page, "py-p1-explain-001",
                           "(last) => /What does this code do/.test(last) ? 'it builds the full name and prints it' : null",
                           "Right, it builds and prints the full name.")
            check(True, "Explain drill got AI feedback")
            check(all(c["ok_headers"] for c in api_calls), f"every API call used Bearer auth, version 2026-10-21, no temperature ({len(api_calls)} calls)")
            # Settings self-test
            await page.goto(URL, wait_until="networkidle")
            await page.get_by_text("Settings", exact=True).first.click()
            await page.get_by_text("Run AI self-test").click()
            await page.wait_for_function("document.body.innerText.includes('6 of 6')", timeout=30000)
            await page.screenshot(path=f"{OUT}/22-selftest.png", full_page=True)
            check("6 of 6" in await page.inner_text("body"), "AI self-test reports 6 of 6 with the fake API")
            # ---------- M3: Dictate in Verbal Syntax (Parked): both worked examples from spec section 9 ----------
            utterances = [
                "def snake sum evens open paren nums close paren colon", "next total equals zero",
                "next for n in nums colon next if n mod two is equal to zero colon", "next total plus equals n",
                "next back back return total", "run it",
            ]
            # the fake user holds "run it" until the dictated code has been checked on screen
            await practice(page, "py-p3-dictate-013",
                           f"(() => {{ window.__hold = true; const q = {json.dumps(utterances)}; return (last) => "
                           "!q.length || (q[0] === 'run it' && window.__hold) ? null : q.shift() })()",
                           "Dictate. Write a function")
            await page.wait_for_function("[...document.querySelectorAll('.code')].some(e => e.innerText.includes('return total'))",
                                         timeout=30000)
            body = await page.inner_text("body")
            check("def sum_evens(nums):\n    total = 0\n    for n in nums:\n        if n % 2 == 0:\n"
                  "            total += n\n    return total" in body, "Dictate shows worked example 1, indented, while you dictate")
            await page.get_by_text("Verbal Syntax cheat sheet").click()
            await page.wait_for_timeout(200)
            check(await page.get_by_text("undo your last utterance").is_visible(), "Dictate cheat sheet opens")
            await page.screenshot(path=f"{OUT}/23-dictate-code.png", full_page=True)
            await page.evaluate("window.__hold = false")
            await page.wait_for_function("window.__said.some(s => s.includes('Correct. All the tests pass.'))", timeout=120000)
            await page.screenshot(path=f"{OUT}/24-dictate-passed.png", full_page=True)
            check(True, "Dictate worked example 1 (Python) ran in Pyodide and scored correct")

            sql_said = ("select part id comma sum open paren qty close paren as total from lots group by part id "
                        "order by total descending limit three")
            await practice(page, "sql-s3-dictate-013",
                           f"(() => {{ const q = {json.dumps([sql_said, 'run it'])}; return (last) => q.length ? q.shift() : null }})()",
                           "Correct. Your rows match the answer.")
            check(await page.get_by_text("SELECT part_id, SUM(qty) AS total FROM lots GROUP BY part_id ORDER BY total DESC LIMIT 3").count() >= 1,
                  "Dictate worked example 2 (SQL) shows the exact query")
            await page.screenshot(path=f"{OUT}/25-dictate-sql.png", full_page=True)
            check(True, "Dictate worked example 2 (SQL) ran in sql.js and scored correct")

            # ---------- M4: Progress, Drills browser, export and import, media buttons ----------
            await page.goto(URL, wait_until="networkidle")
            await page.get_by_text("Progress", exact=True).first.click()
            await page.wait_for_timeout(800)
            body = await page.inner_text("body")
            check("Streak:" in body and "Ladders" in body and "sum_evens" in body, "Progress shows streak and ladders")
            await page.screenshot(path=f"{OUT}/30-progress.png", full_page=True)
            async with page.expect_download() as dl_info:
                await page.get_by_text("Export progress").click()
            dl = await dl_info.value
            backup_path = f"{OUT}/backup.json"
            await dl.save_as(backup_path)
            raw = open(backup_path).read()
            backup = json.loads(raw)
            n_attempts = len(backup["attempts"])
            check(backup["format"] == "code-by-ear-backup" and n_attempts >= 5 and dl.suggested_filename.startswith("code-by-ear-backup-"),
                  f"export downloads a backup ({n_attempts} answers, {dl.suggested_filename})")
            check(FAKE_KEY not in raw, "the backup does not contain the API key")
            count_attempts = """async () => {
              const req = indexedDB.open('code-by-ear', 1);
              await new Promise(r => req.onsuccess = r);
              const tx = req.result.transaction(['attempts', 'kv'], 'readonly');
              const c = tx.objectStore('attempts').count(), k = tx.objectStore('kv').get('apiKey');
              await new Promise(r => tx.oncomplete = r);
              req.result.close();
              return [c.result, k.result];
            }"""
            await page.evaluate("""async () => {
              const req = indexedDB.open('code-by-ear', 1);
              await new Promise(r => req.onsuccess = r);
              const tx = req.result.transaction(['attempts', 'drillState'], 'readwrite');
              tx.objectStore('attempts').clear(); tx.objectStore('drillState').clear();
              await new Promise(r => tx.oncomplete = r);
              req.result.close();
            }""")
            check((await page.evaluate(count_attempts))[0] == 0, "progress wiped before the import")
            await page.set_input_files("input[type=file]", backup_path)
            await page.wait_for_timeout(300)
            check(await page.get_by_text("Replace my progress").count() == 1, "import shows what the backup holds and asks first")
            await page.screenshot(path=f"{OUT}/31-import-confirm.png", full_page=True)
            await page.get_by_text("Replace my progress").click()
            await page.wait_for_timeout(2500)
            restored, key = await page.evaluate(count_attempts)
            check(restored == n_attempts, f"import restored every answer ({restored} of {n_attempts})")
            check(key == FAKE_KEY, "import kept the API key already on the phone")

            # Drills browser: filters and search survive a practice session
            await page.goto(URL, wait_until="networkidle")
            await page.get_by_text("Drills", exact=True).first.click()
            await page.locator("select").first.select_option("python")
            await page.locator("input[type=search]").fill("sum evens")
            await page.wait_for_timeout(200)
            items = page.locator(".drill-item")
            check(await items.count() == 3, f"search finds the sum evens ladder ({await items.count()} drills)")
            await page.locator(".drill-item .t", has_text="py-p3-sketch-013").click()
            check(await page.get_by_text("def sum_evens(nums):").count() == 1, "tapping a drill shows its code")
            await page.screenshot(path=f"{OUT}/32-drills.png", full_page=True)
            await page.evaluate("window.__script = (last) => null")
            await page.locator(".drill-item", has_text="py-p3-plan-l013").get_by_text("Practice").click()
            await page.wait_for_function("window.__said.some(s => s.includes('Plan this out loud'))", timeout=20000)
            await page.get_by_text("End", exact=True).click()
            await page.wait_for_timeout(800)
            await page.get_by_text("Home", exact=True).click()
            await page.wait_for_timeout(500)
            check(await page.locator("input[type=search]").input_value() == "sum evens", "Drills keeps its filters after a session")

            # Media Session spike: with the setting on, play/pause pauses and resumes the session
            await page.evaluate("""async () => {
              const req = indexedDB.open('code-by-ear', 1);
              await new Promise(r => req.onsuccess = r);
              const tx = req.result.transaction('kv', 'readwrite');
              const st = tx.objectStore('kv'); const g = st.get('settings');
              await new Promise(r => g.onsuccess = r);
              st.put({ ...(g.result || {}), mediaButtons: true }, 'settings');
              await new Promise(r => tx.oncomplete = r);
              req.result.close();
            }""")
            await practice(page, "py-p1-explain-001", "(last) => null", "What does")
            await page.wait_for_timeout(300)
            check(await page.evaluate("typeof window.__media.pause === 'function' && typeof window.__media.nexttrack === 'function'"),
                  "a session registers media button handlers when the setting is on")
            await page.evaluate("window.__media.pause()")
            await page.wait_for_timeout(600)
            check(await page.get_by_role("button", name="Resume").count() == 1, "headset pause button pauses the session")
            await page.evaluate("window.__media.play()")
            await page.wait_for_timeout(600)
            check(await page.get_by_role("button", name="Pause").count() == 1, "headset play button resumes the session")
            await page.get_by_text("End", exact=True).click()
            await page.wait_for_timeout(500)

            # without a key: falls back cleanly
            await set_kv(page, "apiKey", "")
            await practice(page, "py-p1-explain-001",
                           "(last) => /What does this code do/.test(last) ? 'it prints a name' : /Say yes, partly/.test(last) ? 'yes' : null",
                           "Say yes, partly, no, or easy.")
            check(True, "without a key, Explain falls back to self-rating")
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
