#!/usr/bin/env bash
set -euo pipefail

VERSION="${ARC_FOUNDRY_VERSION:-v0.8.0-2}"
DESTINATION="${1:-$HOME/.local/bin}"
OS="$(uname -s)"
ARCH="$(uname -m)"

case "${OS}-${ARCH}" in
  Linux-x86_64)
    TARGET="x86_64-unknown-linux-gnu"
    SHA256="088bdb96a84418b757f9825d491e702792f1d1d1e29a9145af305a6600a79556"
    ;;
  Linux-aarch64|Linux-arm64)
    TARGET="aarch64-unknown-linux-gnu"
    SHA256="6508a6425bfeab62188698702771478619d4229fda1db038fb01c1050476c805"
    ;;
  Darwin-arm64|Darwin-aarch64)
    TARGET="aarch64-apple-darwin"
    SHA256="90e3eefbf7dd80652fd283a7562e9263301a48797bc2224cc21a3964e2d5db87"
    ;;
  *)
    echo "Unsupported platform for the pinned Arc Foundry binary: ${OS}-${ARCH}" >&2
    echo "Build circlefin/arc-foundry from source and install arc-forge, arc-cast, and arc-anvil manually." >&2
    exit 1
    ;;
esac

ARCHIVE="arc-foundry-${VERSION}-${TARGET}.tar.gz"
URL="https://github.com/circlefin/arc-foundry/releases/download/${VERSION}/${ARCHIVE}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

curl --fail --location --retry 3 --retry-all-errors --output "$TMP_DIR/$ARCHIVE" "$URL"
if command -v sha256sum >/dev/null 2>&1; then
  printf '%s  %s\n' "$SHA256" "$TMP_DIR/$ARCHIVE" | sha256sum --check --status
else
  ACTUAL="$(shasum -a 256 "$TMP_DIR/$ARCHIVE" | awk '{print $1}')"
  [[ "$ACTUAL" == "$SHA256" ]] || { echo "Arc Foundry checksum mismatch." >&2; exit 1; }
fi

tar -xzf "$TMP_DIR/$ARCHIVE" -C "$TMP_DIR"
mkdir -p "$DESTINATION"
for tool in forge cast anvil; do
  [[ -x "$TMP_DIR/$tool" ]] || { echo "Arc Foundry archive is missing $tool." >&2; exit 1; }
  install -m 0755 "$TMP_DIR/$tool" "$DESTINATION/arc-$tool"
done

echo "Installed Arc Foundry ${VERSION} to ${DESTINATION}."
