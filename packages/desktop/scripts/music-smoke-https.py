"""Run a deterministic TLS range server and the real Rust decoder test.

Only binds loopback. Generates a temporary CA and leaf; the test process trusts
only that CA. Never installs certificates or disables verification.
"""
import http.server
import os
from pathlib import Path
import re
import shutil
import ssl
import subprocess
import tempfile
import threading

MEDIA = Path(os.environ["TSUGI_TEST_MEDIA_DIR"])
DATA = {
    "tone.m4a": (MEDIA / "tone.m4a").read_bytes(),
    "tone.webm": (MEDIA / "tone.webm").read_bytes(),
    "range.bin": b"\x00\x00\x00\x18ftyp" + b"\x2a" * 700000,
    "html": b"<html>not audio</html>",
}


class RangeHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Log fixture requests only; this server has no production URLs.
        print(fmt % args, flush=True)

    def do_GET(self):
        name = self.path.lstrip("/")
        if name == "refused":
            self.send_error(403)
            return
        if name == "whole":
            self.send_response(200)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if name == "bad-header":
            self.send_response(206)
            self.send_header("Content-Range", "invalid")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        data = DATA.get(name)
        match = re.fullmatch(r"bytes=(\d+)-(\d+)", self.headers.get("Range", ""))
        if data is None or match is None:
            self.send_error(400)
            return
        start, end = map(int, match.groups())
        end = min(end, len(data) - 1)
        if start > end:
            self.send_error(416)
            return
        part = data[start:end + 1]
        self.send_response(206)
        self.send_header("Content-Range", f"bytes {start}-{end}/{len(data)}")
        self.send_header("Content-Length", str(len(part)))
        self.send_header("Content-Type", "application/octet-stream")
        self.end_headers()
        self.wfile.write(part)


def main():
    openssl = shutil.which("openssl")
    if not openssl:
        git = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Git"
        openssl = next((str(x) for x in [
            git / "usr/bin/openssl.exe", git / "mingw64/bin/openssl.exe"
        ] if x.is_file()), None)
    if not openssl:
        raise RuntimeError("OpenSSL executable not available")
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)

        def run(*args):
            subprocess.run([openssl, *args], cwd=root, check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

        (root / "openssl.cnf").write_text(
            "[req]\ndistinguished_name=dn\n[dn]\n", encoding="ascii")
        run("req", "-config", "openssl.cnf", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
            "-subj", "/CN=Tsugi test CA", "-keyout", "ca.key", "-out", "ca.pem",
            "-addext", "basicConstraints=critical,CA:TRUE",
            "-addext", "keyUsage=critical,keyCertSign,cRLSign")
        run("req", "-config", "openssl.cnf", "-new", "-newkey", "rsa:2048", "-nodes",
            "-subj", "/CN=127.0.0.1", "-keyout", "leaf.key", "-out", "leaf.csr")
        (root / "leaf.ext").write_text(
            "basicConstraints=critical,CA:FALSE\n"
            "subjectAltName=IP:127.0.0.1\n"
            "extendedKeyUsage=serverAuth\n", encoding="ascii")
        run("x509", "-req", "-in", "leaf.csr", "-CA", "ca.pem", "-CAkey", "ca.key",
            "-CAcreateserial", "-days", "1", "-extfile", "leaf.ext", "-out", "leaf.pem")
        run("x509", "-in", "ca.pem", "-outform", "DER", "-out", "ca.der")
        with http.server.ThreadingHTTPServer(("127.0.0.1", 0), RangeHandler) as server:
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ctx.load_cert_chain(root / "leaf.pem", root / "leaf.key")
            server.socket = ctx.wrap_socket(server.socket, server_side=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            env = dict(os.environ, TSUGI_TEST_CA_DER=str(root / "ca.der"),
                       TSUGI_TEST_HTTPS_BASE=f"https://127.0.0.1:{server.server_port}")
            env["NO_PROXY"] = "127.0.0.1,localhost"
            try:
                subprocess.run([
                    "cargo", "test", "--locked", "-p", "aiostreams-desktop-core",
                    "--lib", "music_stream::tests::headless_https_playback",
                    "--", "--ignored", "--nocapture",
                ], cwd=Path(__file__).resolve().parents[1], env=env, check=True)
            finally:
                server.shutdown()
                thread.join()


if __name__ == "__main__":
    main()
