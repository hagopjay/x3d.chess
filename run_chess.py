#!/usr/bin/env python3
"""Serve the locally vendored viewer. No package installation is required."""
from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import webbrowser

ROOT = Path(__file__).resolve().parent
VIEWER = ROOT / 'viewer'


class ViewerHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript',
                      '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.x3d': 'model/x3d+xml'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8862)
    parser.add_argument('--host', default='127.0.0.1', help='Loopback by default.')
    parser.add_argument('--study', action='store_true', help='Print/open the four-experiment study room.')
    parser.add_argument('--open', action='store_true', help='Open your default browser.')
    args = parser.parse_args(argv)
    if not 0 <= args.port <= 65535:
        parser.error('--port must be between 0 and 65535')
    handler = partial(ViewerHandler, directory=str(VIEWER))
    with ThreadingHTTPServer((args.host, args.port), handler) as server:
        host = '127.0.0.1' if args.host == '0.0.0.0' else args.host
        if ':' in host:
            host = '[' + host + ']'
        url = f'http://{host}:{server.server_port}/' + ('?engine=study' if args.study else '')
        print(f'X3D Chess Observatory: {url}', flush=True)
        print('All viewer assets are local. Ctrl+C stops the server.', flush=True)
        if args.open:
            webbrowser.open(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
