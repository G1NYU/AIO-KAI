"""Isolated resolver assessment of pinned ytdown CLI on an authorized fixture.
Only metadata is requested. No browser cookies, proxies, alternate accounts,
media URL logging, retries after provider verification, or media export.
"""
import json
import pathlib
import subprocess
import sys
import time

# Big Buck Bunny (c) 2008 Blender Foundation, CC BY 3.0.
URL = "https://www.youtube.com/watch?v=YE7VzlLtp-4"

def main():
    binary = pathlib.Path(sys.argv[1]).resolve(strict=True)
    started = time.monotonic()
    try:
        result = subprocess.run([str(binary), "formats", URL, "--json"],
                                capture_output=True, timeout=45, check=False)
    except subprocess.TimeoutExpired:
        print("LIVE_RESOLUTION: timeout (not accepted)")
        return
    elapsed = time.monotonic() - started
    if result.returncode:
        # Never print resolver stderr: it can contain signed media URLs or headers.
        error = result.stderr.lower()
        if any(word in error for word in (b"sign in", b"sign-in", b"bot-check", b"bot check", b"not a bot", b"login", b"verification")):
            reason = "provider authentication or verification required"
        elif b"429" in error:
            reason = "provider rate limit"
        elif b"403" in error:
            reason = "provider refused access"
        else:
            reason = "resolver or network error"
        print(f"LIVE_RESOLUTION: {reason} ({elapsed:.2f}s; not accepted)")
        return
    if len(result.stdout) > 4 * 1024 * 1024:
        raise AssertionError("Unexpectedly large metadata result")
    try:
        formats = json.loads(result.stdout)
    except (ValueError, UnicodeError):
        raise AssertionError("Invalid resolver output") from None
    if not isinstance(formats, list) or not all(isinstance(row, dict) for row in formats):
        raise AssertionError("Expected a structured format list")
    audio = [f for f in formats if f.get("audio") and not f.get("video")
             and str(f.get("mime_type", "")).lower().split(";")[0] == "audio/mp4"
             and isinstance(f.get("url"), str) and f["url"].startswith("https://")]
    print(f"LIVE_RESOLUTION: {len(formats)} formats; {len(audio)} HTTPS M4A audio-only candidates; {elapsed:.2f}s")
    if not audio:
        print("LIVE_RESOLUTION: no compatible M4A candidate (not accepted)")
    else:
        print("LIVE_RESOLUTION: metadata candidate available; actual export and size bounds remain unverified")

if __name__ == "__main__":
    main()
