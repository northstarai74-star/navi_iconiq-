"""Vercel entrypoint for the booking API and the admin panel.

Vercel serves public/ straight from its CDN; vercel.json rewrites only
/api/slots, /api/book and /admin* to this function, which reuses the exact
routing that server.py uses locally. The rewrites carry the visitor's original
path in ?p=... because the function itself is mounted at /api/index.
"""
import os
import sys
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server  # noqa: E402  (needs the path above to import store/admin)


def original(raw):
    """Undo the rewrite: put ?p=/admin/... back as the request path."""
    url = urlparse(raw)
    params = parse_qs(url.query, keep_blank_values=True)
    path = params.pop("p", [""])[0] or url.path
    query = urlencode([(k, v) for k, values in params.items() for v in values])
    return urlunparse(("", "", path, "", query, ""))


class handler(server.Handler):
    def do_GET(self):
        self.path = original(self.path)
        return super().do_GET()

    def do_POST(self):
        self.path = original(self.path)
        return super().do_POST()

    def do_HEAD(self):
        self.path = original(self.path)
        return super().do_HEAD()
