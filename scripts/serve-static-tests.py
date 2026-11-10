"""Servidor HTTP silencioso e resiliente para a suíte Playwright local."""

from __future__ import annotations

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os
import re


ROOT = Path(os.environ.get("FISCALIZA_TEST_ROOT", Path(__file__).resolve().parents[1] / "painel-cidadao")).resolve()
HOST = "127.0.0.1"
PORT = int(os.environ.get("FISCALIZA_TEST_PORT", "4173"))


class QuietStaticHandler(SimpleHTTPRequestHandler):
    """Evita que navegacoes canceladas inundem o log com BrokenPipe."""

    def log_message(self, _format: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("X-Fiscaliza-Test-Process", str(os.getpid()))
        if os.environ.get("FISCALIZA_TEST_SECURITY_HEADERS") == "1":
            htaccess = (ROOT / ".htaccess").read_text(encoding="utf-8-sig")
            policy = re.search(r'Header always set Content-Security-Policy "([^"]+)"', htaccess)
            if policy:
                self.send_header("Content-Security-Policy", policy.group(1))
        super().end_headers()

    def copyfile(self, source, outputfile) -> None:  # type: ignore[no-untyped-def]
        try:
            super().copyfile(source, outputfile)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # Playwright cancela downloads pendentes ao trocar de pagina. Isso e
            # normal e nao deve virar traceback nem atrasar o processo pai.
            return


class TestHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    handler = partial(QuietStaticHandler, directory=str(ROOT))
    with TestHTTPServer((HOST, PORT), handler) as server:
        server.serve_forever(poll_interval=0.2)


if __name__ == "__main__":
    main()
