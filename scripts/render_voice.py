#!/usr/bin/env python3
"""Pre-render the app's fixed speech with the Kokoro neural voice (Kokoro-82M v1.0, Apache-2.0).

Reads build/voice_texts.json (from `npx vite-node scripts/voice_texts.ts`), renders each sentence that
has no audio yet to public/voice/<voice>/<key>.ogg (Opus), and writes src/data/voice_manifest.json,
which the app uses to know which sentences it can play from a file.

Incremental: only new sentences are rendered. --prune deletes audio for sentences no longer used.

Model files (not in the repo): kokoro-v1.0.onnx and voices-v1.0.bin from
https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0, in $KOKORO_MODEL_DIR
(default: ../tools/kokoro-model next to the repo, or ~/tools/kokoro-model). Needs: pip install kokoro-onnx soundfile.
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
CODE_SPEED = 0.85  # lines of code are rendered slower; the app plays them at rate / CODE_SPEED
LEAD_S, TAIL_S = 0.15, 0.10  # silence around each clip, so a waking Bluetooth link clips silence, not words
MODEL = "kokoro-v1.0 fp32"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="af_heart")
    ap.add_argument("--texts", default=str(ROOT / "build/voice_texts.json"))
    candidates = [os.environ.get("KOKORO_MODEL_DIR", ""), str(ROOT.parent / "tools/kokoro-model"), str(Path.home() / "tools/kokoro-model")]
    default_dir = next((c for c in candidates if c and Path(c, "kokoro-v1.0.onnx").exists()), candidates[-1])
    ap.add_argument("--model-dir", default=default_dir)
    ap.add_argument("--prune", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="render at most this many (for a quick try)")
    args = ap.parse_args()

    from kokoro_onnx import Kokoro

    texts = json.loads(Path(args.texts).read_text())
    out_dir = ROOT / "public/voice" / args.voice
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = ROOT / "src/data/voice_manifest.json"
    manifest = {"voice": args.voice, "model": MODEL, "codeSpeed": CODE_SPEED, "clips": {}}
    if manifest_path.exists():
        old = json.loads(manifest_path.read_text())
        if old.get("voice") == args.voice and old.get("model") == MODEL and old.get("codeSpeed") == CODE_SPEED:
            manifest["clips"] = old.get("clips", {})

    wanted = {t["key"] for t in texts}
    todo = [t for t in texts if not (t["key"] in manifest["clips"] and (out_dir / f"{t['key']}.ogg").exists())]
    if args.limit:
        todo = todo[: args.limit]
    print(f"render_voice: {len(texts)} sentences, {len(todo)} to render", flush=True)

    kokoro = Kokoro(f"{args.model_dir}/kokoro-v1.0.onnx", f"{args.model_dir}/voices-v1.0.bin") if todo else None
    t0 = time.time()
    done_audio = 0.0

    def save_manifest() -> None:
        clips = {k: v for k, v in sorted(manifest["clips"].items()) if k in wanted}
        manifest_path.write_text(json.dumps({**manifest, "clips": clips}, indent=0) + "\n")

    for i, t in enumerate(todo, 1):
        speed = CODE_SPEED if t["style"] == "code" else 1.0
        samples, sr = kokoro.create(t["text"], voice=args.voice, speed=speed, lang="en-us")
        samples = np.concatenate([np.zeros(int(LEAD_S * sr), np.float32), samples.astype(np.float32),
                                  np.zeros(int(TAIL_S * sr), np.float32)])
        sf.write(out_dir / f"{t['key']}.ogg", samples, sr, format="OGG", subtype="OPUS")
        ms = round(len(samples) / sr * 1000)
        manifest["clips"][t["key"]] = ms
        done_audio += ms / 1000
        if i % 25 == 0 or i == len(todo):
            save_manifest()
            el = time.time() - t0
            print(f"  {i}/{len(todo)}: {done_audio/60:.1f} min of audio in {el/60:.1f} min", flush=True)
    save_manifest()

    if args.prune:
        removed = 0
        for f in out_dir.glob("*.ogg"):
            if f.stem not in wanted:
                f.unlink()
                removed += 1
        print(f"render_voice: pruned {removed} unused clips")
    size = sum(f.stat().st_size for f in out_dir.glob("*.ogg"))
    print(f"render_voice: {len(manifest['clips'])} clips, {size/1e6:.1f} MB in {out_dir.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
