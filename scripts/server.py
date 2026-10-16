import functools
import http.server
import os

ROOT = "/workspace"
PORT = 8080


class NoStoreHandler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        path = self.translate_path(self.path)
        accept = self.headers.get("Accept-Encoding", "")
        if "gzip" in accept.lower() and os.path.isfile(path):
            gz = path + ".gz"
            if os.path.isfile(gz):
                try:
                    f = open(gz, "rb")
                except OSError:
                    pass
                else:
                    try:
                        stat = os.fstat(f.fileno())
                        orig = os.stat(path).st_size
                        self.send_response(200)
                        self.send_header("Content-Type", self.guess_type(path))
                        self.send_header("Content-Encoding", "gzip")
                        self.send_header("Vary", "Accept-Encoding")
                        self.send_header("Content-Length", str(stat.st_size))
                        self.send_header("X-Original-Length", str(orig))
                        self.end_headers()
                        return f
                    except Exception:
                        f.close()
                        raise
        return super().send_head()

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
