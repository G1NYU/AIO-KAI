"""Exercise pinned local FFmpeg/FFprobe with original synthetic audio."""
import hashlib
import json
import math
import os
import pathlib
import struct
import subprocess
import sys
import tempfile
import wave

def main():
    tools = pathlib.Path(sys.argv[1]).resolve(strict=True)
    ffmpeg = tools / "ffmpeg.exe"
    ffprobe = tools / "ffprobe.exe"
    for line in (tools / "SHA256SUMS").read_text().splitlines():
        expected, name = line.split(maxsplit=1)
        assert hashlib.sha256((tools / name).read_bytes()).hexdigest() == expected, name
    def run(tool, *args):
        return subprocess.run([str(tool), *map(str, args)], capture_output=True,
                              check=True, timeout=30).stdout
    for tool in (ffmpeg, ffprobe):
        version = run(tool, "-version").decode()
        assert any(marker in version.splitlines()[0] for marker in ("8.1.2", "38b8833")), version.splitlines()[0]
        assert "--enable-gpl" not in version and "--enable-nonfree" not in version
    def convert(*args):
        run(ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-n", *args)
    def inspect(path, codec):
        data = json.loads(run(ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", path))
        streams = data["streams"]
        assert len(streams) == 1 and streams[0]["codec_type"] == "audio"
        assert streams[0]["codec_name"] == codec
        assert 0.9 < float(data["format"]["duration"]) < 1.1
        return data
    with tempfile.TemporaryDirectory(prefix="tsugi-media-fixture-") as directory:
        root = pathlib.Path(directory)
        pcm = b"".join(struct.pack("<h", round(10000 * math.sin(2 * math.pi * 440 * i / 44100))) for i in range(44100))
        source = root / "source.wav"
        with wave.open(str(source), "wb") as output:
            output.setparams((1, 2, 44100, 0, "NONE", "not compressed"))
            output.writeframes(pcm)
        m4a, flac, remux, recovered = (root / name for name in ("audio.m4a", "audio.flac", "remux.m4a", "recovered.wav"))
        convert("-i", source, "-c:a", "aac", "-b:a", "192k", "-metadata", "title=Tsugi fixture", m4a)
        assert inspect(m4a, "aac")["format"]["tags"]["title"] == "Tsugi fixture"
        convert("-i", m4a, "-map", "0:a:0", "-c:a", "copy", remux)
        inspect(remux, "aac")
        if len(sys.argv) > 2:
            test_exe = pathlib.Path(sys.argv[2]).resolve(strict=True)
            env = {**os.environ, "TSUGI_MEDIA_TOOLS": str(tools), "TSUGI_MEDIA_FIXTURE": str(m4a)}
            subprocess.run([str(test_exe), "bundled_media_validates_audio", "--ignored", "--nocapture"], env=env, check=True, timeout=90)
        convert("-i", source, "-c:a", "flac", flac)
        inspect(flac, "flac")
        convert("-i", flac, "-c:a", "pcm_s16le", recovered)
        with wave.open(str(recovered), "rb") as result:
            assert result.readframes(result.getnframes()) == pcm, "FLAC lossless verification failed"
        broken = root / "broken.m4a"
        broken.write_bytes(b"not media")
        assert subprocess.run([str(ffprobe), "-v", "error", str(broken)], capture_output=True, timeout=10).returncode != 0
    print("PASS: verified FFmpeg/FFprobe, AAC M4A encoding, metadata, stream-copy remux, lossless FLAC, invalid-media rejection")

if __name__ == "__main__":
    main()
