#!/usr/bin/env python3
"""Test fixture: a local stand-in for the Hugging Face repo onnx-community/Kokoro-82M-v1.0-ONNX, built from
the kokoro-onnx release files, so the browser smoke test can run the on-phone voice (kokoro-js) without
internet access to huggingface.co. The phone itself downloads the real repo.

It only has to be good enough to exercise the plumbing (worker, ONNX Runtime wasm, voice files, caching,
playback): the model inputs and outputs are renamed to what kokoro-js expects, and the tokenizer maps
phonemes to the same IDs Kokoro uses.

Output: build/fake-hf/onnx-community/Kokoro-82M-v1.0-ONNX/{config.json, tokenizer.json,
tokenizer_config.json, onnx/model_quantized.onnx, voices/af_heart.bin}
Needs: pip install onnx kokoro-onnx; model files in $KOKORO_MODEL_DIR (see render_voice.py).
"""
import json
import os
import sys
from pathlib import Path

import numpy as np
import onnx

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT / "build/fake-hf/onnx-community/Kokoro-82M-v1.0-ONNX"


def main() -> int:
    candidates = [os.environ.get("KOKORO_MODEL_DIR", ""), str(ROOT.parent / "tools/kokoro-model"), str(Path.home() / "tools/kokoro-model")]
    mdir = next((Path(c) for c in candidates if c and Path(c, "kokoro-v1.0.int8.onnx").exists()), None)
    if not mdir:
        print("make_fake_hf: kokoro-v1.0.int8.onnx not found; skipping")
        return 0
    import kokoro_onnx

    cfg = json.loads((Path(kokoro_onnx.__file__).parent / "config.json").read_text())
    vocab = {"$": 0, **cfg["vocab"]}
    (REPO / "onnx").mkdir(parents=True, exist_ok=True)
    (REPO / "voices").mkdir(parents=True, exist_ok=True)

    (REPO / "config.json").write_text(json.dumps({**cfg, "model_type": "style_text_to_speech_2",
                                                  "architectures": ["StyleTextToSpeech2Model"]}))
    tokenizer = {
        "version": "1.0",
        "truncation": None,
        "padding": None,
        "added_tokens": [{"id": 0, "content": "$", "single_word": False, "lstrip": False, "rstrip": False,
                          "normalized": False, "special": True}],
        "normalizer": None,
        "pre_tokenizer": {"type": "Split", "pattern": {"Regex": ""}, "behavior": "Isolated", "invert": False},
        "post_processor": {
            "type": "TemplateProcessing",
            "single": [{"SpecialToken": {"id": "$", "type_id": 0}}, {"Sequence": {"id": "A", "type_id": 0}},
                       {"SpecialToken": {"id": "$", "type_id": 0}}],
            "pair": [{"Sequence": {"id": "A", "type_id": 0}}, {"Sequence": {"id": "B", "type_id": 1}}],
            "special_tokens": {"$": {"id": "$", "ids": [0], "tokens": ["$"]}},
        },
        "decoder": None,
        "model": {"type": "WordLevel", "vocab": vocab, "unk_token": "$"},
    }
    (REPO / "tokenizer.json").write_text(json.dumps(tokenizer, ensure_ascii=False))
    (REPO / "tokenizer_config.json").write_text(json.dumps({"model_max_length": 512, "pad_token": "$", "unk_token": "$"}))

    model = onnx.load(str(mdir / "kokoro-v1.0.int8.onnx"))
    renames = {"tokens": "input_ids", "audio": "waveform"}
    for node in model.graph.node:
        node.input[:] = [renames.get(n, n) for n in node.input]
        node.output[:] = [renames.get(n, n) for n in node.output]
    for v in list(model.graph.input) + list(model.graph.output):
        v.name = renames.get(v.name, v.name)
    onnx.save(model, str(REPO / "onnx/model_quantized.onnx"))

    voices = np.load(mdir / "voices-v1.0.bin")
    (REPO / "voices/af_heart.bin").write_bytes(voices["af_heart"].astype(np.float32).tobytes())
    print(f"make_fake_hf: wrote {REPO.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
