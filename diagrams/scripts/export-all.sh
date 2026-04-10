#!/usr/bin/env bash
set -euo pipefail

# Export all Excalidraw source files to SVG (light + dark themes)
# Uses the bundled Node.js converter (no external dependencies)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/excalidraw-to-svg.mjs"
