#!/usr/bin/env bash
# Full pinned offline XSD + semantic checks; no reduced xmldsig stand-in.
set -euo pipefail
cd "$(dirname "$0")/.."
exec python3 tools/validate_x3d.py "$@"
