#!/usr/bin/env python3
"""
Hugging Face Spaces image-to-video bridge (EXPERIMENTAL).

Calls a public Gradio Space (e.g. an LTX-Video / CogVideoX image-to-video
demo) via `gradio_client` and prints a single JSON line to stdout:

    {"ok": true, "video": "/path/to/output.mp4"}
    {"ok": false, "error": "reason"}

Requires: pip install gradio-client
Optional: HF_TOKEN env for Spaces that need authentication / higher queue priority.

IMPORTANT: every Space has its own predict() signature (arg order, api_name).
Tune --api-name and --extra-args-json per Space. This bridge is a best-effort
convention: positional args = [image_path, prompt, *extra_args].
"""
import argparse
import json
import os
import shutil
import sys
import tempfile


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--space", required=True, help="Space id, e.g. user/Space-Name")
    p.add_argument("--image", required=True, help="Input image path")
    p.add_argument("--prompt", default="", help="Motion/text prompt")
    p.add_argument("--api-name", default="/predict")
    p.add_argument(
        "--extra-args-json",
        default="[]",
        help='JSON list of extra positional args appended after [image, prompt]',
    )
    args = p.parse_args()

    try:
        from gradio_client import Client, handle_file  # type: ignore
    except ImportError:
        print(json.dumps({"ok": False, "error": "gradio_client not installed (pip install gradio-client)"}))
        return

    if not os.path.exists(args.image):
        print(json.dumps({"ok": False, "error": f"input image not found: {args.image}"}))
        return

    try:
        extra = json.loads(args.extra_args_json)
        if not isinstance(extra, list):
            raise ValueError("extra-args-json must be a JSON list")
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"bad --extra-args-json: {e}"}))
        return

    try:
        try:
            client = Client(args.space, token=os.environ.get("HF_TOKEN") or None)
        except TypeError:
            # gradio_client < 1.x used hf_token; 2.x renamed it to token.
            client = Client(args.space, hf_token=os.environ.get("HF_TOKEN") or None)
        # Gradio 5.x validates image inputs as uploaded files (ImageData);
        # a raw path string is rejected before predict runs.
        result = client.predict(handle_file(args.image), args.prompt, *extra, api_name=args.api_name)

        # gradio_client returns a filepath (str) or sometimes a dict/tuple.
        video_path = result[0] if isinstance(result, (list, tuple)) else result
        if isinstance(video_path, dict):
            video_path = video_path.get("path") or video_path.get("url") or ""
        if not isinstance(video_path, str) or not video_path:
            print(json.dumps({"ok": False, "error": f"unexpected Space result shape: {str(result)[:200]}"}))
            return

        # If the Space returned a URL, download it; else copy the local file.
        out_dir = tempfile.mkdtemp(prefix="hf-space-video-")
        out_path = os.path.join(out_dir, "space-output.mp4")
        if video_path.startswith("http"):
            import urllib.request

            urllib.request.urlretrieve(video_path, out_path)
        else:
            if not os.path.exists(video_path):
                print(json.dumps({"ok": False, "error": f"Space returned non-existent path: {video_path[:200]}"}))
                return
            shutil.copy(video_path, out_path)

        print(json.dumps({"ok": True, "video": out_path}))
    except Exception as e:  # queue timeouts, Space errors, network issues
        print(json.dumps({"ok": False, "error": str(e)[:500]}))


if __name__ == "__main__":
    main()
