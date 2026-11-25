#!/usr/bin/env bash
# Build independent local-only FFmpeg CLI tools from the exact upstream revision.
set -euo pipefail
src="$(realpath "$1")"
out="$(realpath -m "$2")"
expected=38b88335f99e76ed89ff3c93f877fdefce736c13
test "$(git -C "$src" rev-parse HEAD)" = "$expected"
test -z "$(git -C "$src" status --porcelain)"
mkdir -p "$out/source" "$out/build"
script="$(realpath "$0")"
cp "$script" "$out/source/build-media-tools.sh"
git -C "$src" archive --format=tar --prefix=ffmpeg-8.1.2/ "$expected" | gzip -n > "$out/source/ffmpeg-8.1.2-source.tar.gz"
cp "$src/COPYING.LGPLv2.1" "$src/LICENSE.md" "$out/source/"
cd "$out/build"
"$src/configure" \
    --target-os=mingw32 --arch=x86_64 --cross-prefix=x86_64-w64-mingw32- \
    --disable-autodetect --disable-network --disable-doc --disable-debug \
    --disable-ffplay --disable-shared --enable-static --disable-x86asm \
    --disable-everything --enable-ffmpeg --enable-ffprobe \
    --enable-protocol=file,pipe \
    --enable-demuxer=mov,matroska,mp3,wav,flac,ogg,aac \
    --enable-muxer=mp4,ipod,matroska,webm,wav,flac,mp3,null,hash \
    --enable-decoder=aac,alac,mp3,opus,vorbis,flac,pcm_s16le,h264,hevc,av1,vp8,vp9 \
    --enable-encoder=aac,flac,pcm_s16le \
    --enable-parser=aac,ac3,flac,mpegaudio,h264,hevc,av1,opus,vp8,vp9 \
    --enable-filter=aresample,aformat,anull,format,null,atrim,trim,setpts,asetpts \
    --enable-bsf=aac_adtstoasc,extract_extradata
make -j"$(nproc)" ffmpeg.exe ffprobe.exe
cp ffmpeg.exe ffprobe.exe "$out/"
cp config.h config_components.h ffbuild/config.mak "$out/source/"
cd "$out"
sha256sum ffmpeg.exe ffprobe.exe source/ffmpeg-8.1.2-source.tar.gz > SHA256SUMS
cat > SOURCE.txt <<'EOF'
FFmpeg / FFprobe 8.1.2, LGPL 2.1 or later configuration (no GPL/nonfree options).
Upstream: https://github.com/FFmpeg/FFmpeg/tree/38b88335f99e76ed89ff3c93f877fdefce736c13
Corresponding source archive, build script, config and licensing notices: source/
Independent executables for local files only; no network protocols enabled.
No external codec libraries; MP3 encoding is not included.
EOF
