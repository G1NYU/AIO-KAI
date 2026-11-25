"""Isolated Windows evaluation of the pinned Aria2 Next engine.
All transfers use original deterministic loopback fixtures. No app data,
provider credentials, external media, installation or release packaging.
"""
import hashlib
import http.server
import json
import pathlib
import re
import secrets
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

PAYLOAD = hashlib.shake_256(b"tsugi-original-aria2-next-fixture").digest(16 * 1024 * 1024)
ETAG = '"tsugi-fixture-v1"'
DIGEST = hashlib.sha256(PAYLOAD).hexdigest()
REQUESTS = []
LOCK = threading.Lock()

class Fixture(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *_):
        pass
    def respond(self, body):
        if not re.fullmatch(r"/(?:one|two|three|crash)\.bin", self.path):
            self.send_error(404)
            return
        start, end = 0, len(PAYLOAD) - 1
        value = self.headers.get("Range")
        if value:
            match = re.fullmatch(r"bytes=(\d+)-(\d*)", value)
            if not match:
                self.send_error(400)
                return
            start = int(match[1])
            end = min(end, int(match[2])) if match[2] else end
            if start > end or start >= len(PAYLOAD):
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{len(PAYLOAD)}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
        with LOCK:
            REQUESTS.append((self.command, self.path, start, end, value is not None))
        self.send_response(206 if value else 200)
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("ETag", ETAG)
        if value:
            self.send_header("Content-Range", f"bytes {start}-{end}/{len(PAYLOAD)}")
        self.end_headers()
        if body:
            try:
                for pos in range(start, end + 1, 65536):
                    self.wfile.write(PAYLOAD[pos:min(pos + 65536, end + 1)])
                    time.sleep(.012)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass
    def do_GET(self):
        self.respond(True)
    def do_HEAD(self):
        self.respond(False)

def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]

def until(predicate, timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(.1)
    raise AssertionError("Condition not reached before deadline")

class Engine:
    def __init__(self, executable, root):
        self.executable = executable
        self.root = root
        self.output = root / "output"
        self.output.mkdir()
        self.state = root / "state"
        self.state.mkdir()
        self.session = root / "session.txt"
        self.log = root / "engine.log"
        self.port = free_port()
        self.secret = secrets.token_hex(32)
        self.process = None
        self.stream = None
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def rpc(self, method, *args, authenticated=True):
        params = (["token:" + self.secret] if authenticated else []) + list(args)
        body = json.dumps({"jsonrpc": "2.0", "id": "fixture", "method": "aria2." + method, "params": params}).encode()
        request = urllib.request.Request(f"http://127.0.0.1:{self.port}/jsonrpc", data=body, headers={"Content-Type": "application/json"})
        with self.opener.open(request, timeout=5) as response:
            document = json.load(response)
        if "error" in document:
            raise RuntimeError(f"RPC {method} rejected")
        return document["result"]
    def start(self, restore=False):
        args = [str(self.executable), "--no-conf=true", "--enable-rpc=true",
                "--rpc-listen-all=false", f"--rpc-listen-port={self.port}", f"--rpc-secret={self.secret}",
                f"--state-dir={self.state}", f"--dir={self.output}", f"--save-session={self.session}",
                "--save-session-interval=1", "--state-save-interval=1", "--max-concurrent-downloads=2",
                "--enable-dht=false", "--enable-peer-exchange=false", "--bt-enable-lpd=false",
                "--bt-port-mapping=false", "--ed2k-port-mapping=false", "--disable-ipv6=true",
                "--file-allocation=none", "--summary-interval=0", "--show-console-readout=false",
                "--stream-max-connections=2", "--split=2", "--min-split-size=1M",
                f"--listen-port={free_port()}", f"--ed2k-listen-port={free_port()}", f"--ed2k-udp-listen-port={free_port()}"]
        if restore:
            args.append(f"--input-file={self.session}")
        self.stream = self.log.open("ab")
        self.process = subprocess.Popen(args, stdout=self.stream, stderr=subprocess.STDOUT)
        def ready():
            if self.process.poll() is not None:
                raise RuntimeError("Engine exited before RPC readiness")
            try:
                return self.rpc("getVersion")
            except (OSError, RuntimeError):
                return None
        until(ready, 20)
    def stop(self, crash=False):
        if self.process and self.process.poll() is None:
            if not crash:
                try:
                    self.rpc("shutdown")
                    self.process.wait(timeout=10)
                except (OSError, RuntimeError, subprocess.TimeoutExpired):
                    pass
            if self.process.poll() is None:
                self.process.kill()
                self.process.wait(timeout=10)
        if self.stream:
            self.stream.close()
        self.process = self.stream = None
    def add(self, url, name, **options):
        return self.rpc("addUri", [url], {"out": name, **options})
    def status(self, gid):
        value = self.rpc("tellStatus", gid)
        if value["status"] == "error":
            raise RuntimeError("Fixture transfer failed: " + value.get("errorMessage", "unknown"))
        return value
    def complete(self, gid, name):
        until(lambda: self.status(gid)["status"] == "complete", 90)
        assert hashlib.sha256((self.output / name).read_bytes()).hexdigest() == DIGEST

def main():
    executable = pathlib.Path(sys.argv[1]).resolve(strict=True)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    with tempfile.TemporaryDirectory(prefix="tsugi-aria2-eval-") as temporary:
        engine = Engine(executable, pathlib.Path(temporary))
        try:
            engine.start()
            try:
                engine.rpc("tellActive", authenticated=False)
            except (RuntimeError, urllib.error.HTTPError):
                print("PASS: unauthenticated queue access rejected")
            else:
                raise AssertionError("RPC accepted an unauthenticated queue request")
            ids = [engine.add(origin + "/" + name + ".bin", name + ".bin", **{"max-download-limit": "2M"}) for name in ("one", "two", "three")]
            until(lambda: len(engine.rpc("tellActive")) == 2 and engine.status(ids[2])["status"] == "waiting", 15)
            engine.rpc("pause", ids[1])
            until(lambda: engine.status(ids[1])["status"] == "paused", 15)
            engine.rpc("unpause", ids[1])
            for gid, name in zip(ids, ("one", "two", "three")):
                engine.complete(gid, name + ".bin")
            print("PASS: parallel queue, pause/unpause, all three SHA-256 hashes")
            gid = engine.add(origin + "/crash.bin", "crash.bin", **{"max-download-limit": "1M", "stream-max-connections": "1", "split": "1"})
            before = until(lambda: int(engine.status(gid)["completedLength"]) if int(engine.status(gid)["completedLength"]) >= 3 * 1024 * 1024 else 0, 30)
            time.sleep(2)
            engine.stop(crash=True)
            assert engine.session.is_file() and engine.session.stat().st_size > 0
            with LOCK:
                mark = len(REQUESTS)
            engine.start(restore=True)
            engine.complete(gid, "crash.bin")
            with LOCK:
                resumed = [row[2] for row in REQUESTS[mark:] if row[0] == "GET" and row[1] == "/crash.bin" and row[4]]
            assert any(offset > 0 for offset in resumed), "No nonzero Range request after crash"
            print(f"PASS: abrupt engine restart recovered verified file, checkpoint before crash {before} bytes, observed resumed ranges {resumed}")
            engine.stop()
            if len(sys.argv) == 3:
                native_root = pathlib.Path(temporary) / "rust"
                subprocess.run([sys.argv[2], str(executable), origin, str(native_root)], check=True, timeout=150)
                assert hashlib.sha256((native_root / "output" / "one.bin").read_bytes()).hexdigest() == DIGEST
                print("PASS: Rust adapter output SHA-256")
        finally:
            engine.stop()
            server.shutdown()
            server.server_close()
            thread.join()

if __name__ == "__main__":
    main()
