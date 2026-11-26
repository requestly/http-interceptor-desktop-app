#!/bin/bash
# Installs the desktop app's dependencies (local setup and the release workflow).
#
# .npmrc sets ignore-scripts=true (supply-chain hardening, RQ-3200), so npm runs no
# package's install scripts, including this repo's own. Run the ones we need by name:
#   1. the root postinstall: installs release/app (also with ignore-scripts), rebuilds
#      its native modules for Electron and builds the development DLL;
#   2. release/app's postinstall: electron-rebuild and link-modules (src/node_modules).
set -euo pipefail
cd "$(dirname "$0")"
npm i
npm run postinstall
(cd release/app && npm run postinstall)
