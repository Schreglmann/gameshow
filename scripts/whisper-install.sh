#!/usr/bin/env bash
# Install whisper.cpp into local-assets/.whisper-build/ for use by the admin Whisper
# transcription feature (server/whisper-jobs.ts).
#
# Cross-platform: macOS + Linux.
#  - macOS: prefers `brew install whisper-cpp` if Homebrew is present.
#  - Linux: clones whisper.cpp source and builds with cmake. apt install build-essential
#    cmake is the typical prerequisite.
#  - Both: also runs `npm run whisper:download-model` afterwards.
#
# After this script the binary is found via either:
#   - `which whisper-cli` (PATH, e.g. brew install drops it here)
#   - local-assets/.whisper-build/whisper-cli (built from source)
#
# Override binary location with WHISPER_CPP_BIN env var.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${REPO_ROOT}/local-assets/.whisper-build"
SRC_DIR="${BUILD_DIR}/whisper.cpp"

echo "[whisper-install] Repo root: ${REPO_ROOT}"
echo "[whisper-install] Platform:  $(uname -s) $(uname -m)"

mkdir -p "${BUILD_DIR}"

# Already installed somewhere on PATH? Skip building.
if command -v whisper-cli >/dev/null 2>&1; then
  echo "[whisper-install] Found whisper-cli on PATH: $(which whisper-cli)"
  echo "[whisper-install] Skipping build. (Set WHISPER_CPP_BIN to override.)"
  exec npm run whisper:download-model
fi
if command -v whisper-cpp >/dev/null 2>&1; then
  echo "[whisper-install] Found whisper-cpp on PATH: $(which whisper-cpp)"
  exec npm run whisper:download-model
fi

case "$(uname -s)" in
  Darwin)
    if command -v brew >/dev/null 2>&1; then
      echo "[whisper-install] Installing whisper-cpp via Homebrew…"
      brew install whisper-cpp
      exec npm run whisper:download-model
    fi
    echo "[whisper-install] Homebrew not found — falling back to source build."
    ;;
  Linux)
    echo "[whisper-install] Building whisper.cpp from source. (Requires cmake + a C++ compiler.)"
    if ! command -v cmake >/dev/null 2>&1; then
      echo "[whisper-install] ERROR: cmake not found. Install it first:" >&2
      echo "  Debian/Ubuntu: sudo apt install -y build-essential cmake" >&2
      echo "  Fedora/RHEL:   sudo dnf install -y gcc-c++ cmake" >&2
      echo "  Arch:          sudo pacman -S base-devel cmake" >&2
      exit 1
    fi
    ;;
  *)
    echo "[whisper-install] Unsupported platform: $(uname -s). Install whisper.cpp manually" >&2
    echo "[whisper-install] and set WHISPER_CPP_BIN to point at the binary." >&2
    exit 1
    ;;
esac

# Source build (Linux, or macOS without Homebrew)
if [[ ! -d "${SRC_DIR}/.git" ]]; then
  echo "[whisper-install] Cloning whisper.cpp into ${SRC_DIR}…"
  git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git "${SRC_DIR}"
else
  echo "[whisper-install] whisper.cpp source already cloned in ${SRC_DIR}; pulling latest…"
  git -C "${SRC_DIR}" pull --ff-only || true
fi

echo "[whisper-install] Building (this may take a few minutes)…"
cmake -B "${SRC_DIR}/build" -S "${SRC_DIR}" -DCMAKE_BUILD_TYPE=Release
cmake --build "${SRC_DIR}/build" -j --config Release --target whisper-cli

# Copy the binary up so the resolver finds it without diving into build/bin
cp "${SRC_DIR}/build/bin/whisper-cli" "${BUILD_DIR}/whisper-cli"
chmod +x "${BUILD_DIR}/whisper-cli"

echo "[whisper-install] Installed: ${BUILD_DIR}/whisper-cli"
"${BUILD_DIR}/whisper-cli" --help | head -5 || true

echo "[whisper-install] Now downloading the ggml model…"
exec npm run whisper:download-model
