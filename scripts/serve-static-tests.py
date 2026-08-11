"""Servidor HTTP silencioso e resiliente para a suíte Playwright local."""

from __future__ import annotations

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "painel-cidadao"
HOST = "127.0.0.1"
PORT = 4173


class QuietStaticHandler(SimpleHTTPRequestHandler):
    """Evita que navegacoes canceladas inundem o log com BrokenPipe."""

    def log_message(self, _format: str, *args: object) -> None:
        return

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
