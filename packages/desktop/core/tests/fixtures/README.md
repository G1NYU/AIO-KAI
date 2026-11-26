# Original progressive-audio fixtures

`progressive-tone.webm` and `progressive-tone.m4a` contain only an original,
generated 440 Hz sine wave. They contain no third-party recording or account data.

Reproduce with FFmpeg:

```sh
ffmpeg -f lavfi -i sine=frequency=440:sample_rate=48000:duration=20 -vn -c:a libopus -b:a 64k progressive-tone.webm
ffmpeg -f lavfi -i sine=frequency=440:sample_rate=48000:duration=20 -vn -c:a aac -b:a 96k -movflags +faststart progressive-tone.m4a
```

The real mpv test starts with only the first 64 KiB available, asserts decoded
playback while the remaining bytes and EOF are withheld, then seeks forward while
the producer supplies a partial continuation and still withholds EOF. WebM begins
with unknown length. M4A uses the exact transport length, allowing MP4 atom scans
to inspect virtual EOF without waiting for the full audio. Both finish only after
the remaining bytes are supplied. Windows CI uses the existing pinned libmpv DLL. The opt-in
Unix development counterpart takes `TSUGI_MPV_TEST_LIBRARY` and uses null audio
output so it does not depend on the machine's speakers.
