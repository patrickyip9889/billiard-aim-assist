import functools
import http.server

ROOT = "/workspace"
PORT = 8080


class NoStoreHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def main():
    handler = functools.partial(NoStoreHandler, directory=ROOT)
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    server = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
