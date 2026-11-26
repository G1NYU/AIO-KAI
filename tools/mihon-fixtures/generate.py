#!/usr/bin/env python3
"""Reproduce sanitized fixtures with Mihon's pinned BackupWriter and serializer.

Requires Python 3 and Java 21. Downloads pinned build-only dependencies to a
temporary cache; nothing is added to TSUGI's runtime. Source blobs are verified
against the upstream git object IDs. Domain conversion methods, which do not
participate in serialization, are omitted from the standalone model compilation.
The writer and every serialized constructor declaration are kept unchanged.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import urllib.request

REVISION = "feadad5e1e2bf638be6e2ca317d11657b09d4596"
MODEL_ROOT = "app/src/main/java/eu/kanade/tachiyomi/data/backup/"
SOURCES = {
    MODEL_ROOT + "models/Backup.kt": "0c021d34a8426dc0bd5844b4e00f9c13767610bf",
    MODEL_ROOT + "models/BackupManga.kt": "74a27fa017dfc84e2826470c37e8102fe92a782d",
    MODEL_ROOT + "models/BackupChapter.kt": "9b026ca30faae1ad334ab7fcccebaa667515ed77",
    MODEL_ROOT + "models/BackupHistory.kt": "aed3f24a29abd781e6913af9b02b5a44e3203436",
    MODEL_ROOT + "models/BackupCategory.kt": "2600e22a45ca8c693f99860d378672c57347a1fb",
    MODEL_ROOT + "models/BackupSource.kt": "92ee2dca94bb8005ba8b2aec1d90464f28fbf806",
    MODEL_ROOT + "models/BackupTracking.kt": "7b66f1457970619e3934a944c0e59fb9e28c733a",
    MODEL_ROOT + "models/BackupPreference.kt": "3884f37e3f99b032597e734b0517bd2fea970125",
    MODEL_ROOT + "models/BackupExtensionStore.kt": "93ec1a6a7dc64d762c35d1729ce8443ca87ca4ac",
    MODEL_ROOT + "BackupStream.kt": "bb1b8c3d7449fc2c11429b26e8e8d5cacb40f322",
    "source-api/src/main/kotlin/eu/kanade/tachiyomi/source/model/UpdateStrategy.kt": "d76a7dd008b0f03f3e110a13e75cdb8566c03a31",
    "core/common/src/main/kotlin/mihon/core/common/extensions/JsonObject.kt": "1fc7998f3c7cc92ede43d922a15cda3a5f8f264d",
}
# Kotlin, serialization and Okio versions match Mihon v0.21.3's version catalog.
# Compiler support versions come from the pinned compiler's Maven POM.
ARTIFACTS = [
    ("org.jetbrains.kotlin", "kotlin-compiler-embeddable", "2.4.21"),
    ("org.jetbrains.kotlin", "kotlin-serialization-compiler-plugin-embeddable", "2.4.21"),
    ("org.jetbrains.kotlin", "kotlin-build-tools-api", "2.4.21"),
    ("org.jetbrains.kotlin", "kotlin-stdlib", "2.4.21"),
    ("org.jetbrains.kotlin", "kotlin-script-runtime", "2.4.21"),
    ("org.jetbrains.kotlin", "kotlin-reflect", "1.6.10"),
    ("org.jetbrains.kotlin", "kotlin-daemon-embeddable", "2.4.21"),
    ("org.jetbrains.kotlinx", "kotlinx-coroutines-core-jvm", "1.8.0"),
    ("org.jetbrains", "annotations", "13.0"),
    ("org.jetbrains.kotlinx", "kotlinx-serialization-core-jvm", "1.12.0"),
    ("org.jetbrains.kotlinx", "kotlinx-serialization-protobuf-jvm", "1.12.0"),
    ("com.squareup.okio", "okio-jvm", "3.18.2"),
]


def download(url, maximum=100 * 1024 * 1024):
    with urllib.request.urlopen(url, timeout=45) as response:
        data = response.read(maximum + 1)
    if len(data) > maximum:
        raise RuntimeError("Build input exceeds its size bound")
    return data


def source(path, expected):
    data = download(f"https://raw.githubusercontent.com/mihonapp/mihon/{REVISION}/{path}", 65536)
    blob = hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
    if blob != expected:
        raise RuntimeError(f"Upstream source changed: {path}")
    return Path(path).name, data.decode("utf-8")


def artifact(coordinate, cache, pins):
    group, name, version = coordinate
    filename = f"{name}-{version}.jar"
    url = f"https://repo.maven.apache.org/maven2/{group.replace('.', '/')}/{name}/{version}/{filename}"
    # Maven Central publishes SHA-1 sidecars for these artifacts. Record stronger
    # local SHA-256 identities in the checked-in provenance after verification.
    expected = download(url + ".sha1", 512).decode().strip().split()[0]
    if len(expected) != 40 or any(c not in "0123456789abcdefABCDEF" for c in expected):
        raise RuntimeError("Invalid Maven checksum")
    path = cache / filename
    data = path.read_bytes() if path.exists() else download(url)
    if hashlib.sha1(data).hexdigest() != expected.lower():
        raise RuntimeError(f"Build dependency integrity mismatch: {filename}")
    if filename in pins and hashlib.sha256(data).hexdigest() != pins[filename]:
        raise RuntimeError(f"Build dependency differs from checked-in provenance: {filename}")
    path.write_bytes(data)
    return path


def schema(name, text):
    if name in ("Backup.kt", "BackupSource.kt", "BackupPreference.kt", "BackupStream.kt", "UpdateStrategy.kt"):
        return text
    if name == "JsonObject.kt":
        constant = "val JsonObjectEmptyBytes = byteArrayOf(0x7B, 0x7D)"
        if constant not in text:
            raise RuntimeError("Unexpected upstream JSON default")
        return "package mihon.core.common.extensions\n" + constant + "\n"
    # The serialized constructor ends on its own line in each pinned source.
    # Keep every annotation, field, type and default exactly as upstream wrote it.
    result = []
    for line in text.splitlines():
        if line.startswith("import ") and not (
            line.startswith("import kotlinx.serialization.")
            or line.endswith(".UpdateStrategy") or line.endswith(".JsonObjectEmptyBytes")
        ):
            continue
        if line in (") {", ")"):
            result.append(")")
            return "\n".join(result) + "\n"
        result.append(line)
    raise RuntimeError(f"Could not isolate the upstream constructor: {name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--java", default=shutil.which("java"))
    parser.add_argument("--cache", type=Path, default=Path(tempfile.gettempdir()) / "tsugi-mihon-writer-cache")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[2] / "packages/web/tests/fixtures/mihon-writer")
    args = parser.parse_args()
    if not args.java:
        parser.error("Java 21 is required; supply --java")
    args.cache.mkdir(parents=True, exist_ok=True)
    # Verify against the reviewed source tree even when generating elsewhere.
    manifest = Path(__file__).resolve().parents[2] / "packages/web/tests/fixtures/mihon-writer/provenance.json"
    pins = json.loads(manifest.read_text())["buildDependencies"] if manifest.is_file() else {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        sources = dict(pool.map(lambda pair: source(*pair), SOURCES.items()))
        jars = list(pool.map(lambda coordinate: artifact(coordinate, args.cache, pins), ARTIFACTS))
    with tempfile.TemporaryDirectory(prefix="tsugi-mihon-writer-") as temporary:
        root = Path(temporary)
        for name, text in sources.items():
            (root / name).write_text(schema(name, text), encoding="utf-8")
        (root / "WriterMain.kt").write_text((Path(__file__).with_name("WriterMain.kt")).read_text(), encoding="utf-8")
        classpath = os.pathsep.join(map(str, jars))
        plugin = next(path for path in jars if "serialization-compiler-plugin" in path.name)
        subprocess.run([args.java, "-cp", classpath, "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler",
            "-no-stdlib", "-no-reflect", "-classpath", classpath, f"-Xplugin={plugin}",
            "-opt-in=kotlinx.serialization.ExperimentalSerializationApi", "-jvm-target", "17",
            "-d", str(root / "writer.jar"), *map(str, sorted(root.glob("*.kt")))], check=True)
        subprocess.run([args.java, "-cp", str(root / "writer.jar") + os.pathsep + classpath,
            "WriterMainKt", str(root / "fixture.pb")], check=True)
        raw = (root / "fixture.pb").read_bytes()
    # Fix gzip's OS byte so regeneration is identical on Windows and Linux.
    compressed = bytearray(gzip.compress(raw, mtime=0))
    compressed[9] = 255
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "mihon-v0.21.3.tachibk").write_bytes(compressed)
    provenance = {
        "upstream": "https://github.com/mihonapp/mihon", "revision": REVISION,
        "writer": "BackupStream.kt", "writerBlob": SOURCES[MODEL_ROOT + "BackupStream.kt"],
        "description": "Authored sanitized data encoded by upstream BackupWriter and original serializer declarations. Domain conversion helpers omitted. Not a physical Android export.",
        "rawSha256": hashlib.sha256(raw).hexdigest(), "gzipSha256": hashlib.sha256(compressed).hexdigest(),
        "rawBytes": len(raw), "gzipBytes": len(compressed),
        "sourceBlobs": SOURCES,
        "buildDependencies": {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in jars},
    }
    (args.output / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    print(f"Verified upstream writer fixture: {len(raw)} raw bytes, {len(compressed)} gzip bytes")


if __name__ == "__main__":
    main()
