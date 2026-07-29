#!/bin/bash
#
# SessionStart hook — makes the verification harnesses runnable on the web.
#
# This project has no runtime dependencies and no build step, so there is
# nothing to `npm install`. What a fresh container *does* need is help finding
# the two things the browser tests depend on, both of which are baked into the
# image at paths Node will not discover on its own:
#
#   * playwright  — installed globally, and global node_modules are not on
#                   Node's default resolution path, so `import "playwright"`
#                   fails from inside the repo.
#   * chromium    — the image's build and the playwright package's expected
#                   build drift apart (1194 vs 1228 at the time of writing), so
#                   playwright's own lookup points at a binary that isn't there.
#                   Resolving it here keeps version numbers out of the tests.
#
# Both are exported through $CLAUDE_ENV_FILE rather than hard-coded in the test
# files, so an image update moves one line instead of every harness.

set -euo pipefail

# Local machines have their own toolchains; this is only for the web sandbox.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# When run by hand for validation there is no env file to write to.
ENV_FILE="${CLAUDE_ENV_FILE:-/dev/null}"

emit() {
  echo "$1" >> "$ENV_FILE"
  echo "  $1"
}

echo "session-start: provisioning the browser test toolchain"

# ── Node module resolution ────────────────────────────────────────────────
# `npm root -g` is the portable way to ask; fall back to the known image path
# so a broken npm doesn't take the whole hook down.
GLOBAL_MODULES="$(npm root -g 2>/dev/null || true)"
if [ ! -d "${GLOBAL_MODULES:-}" ]; then
  GLOBAL_MODULES=/opt/node22/lib/node_modules
fi

if [ -d "$GLOBAL_MODULES/playwright" ]; then
  emit "export NODE_PATH=\"$GLOBAL_MODULES\""
else
  echo "  warning: playwright not found under $GLOBAL_MODULES — browser tests will skip" >&2
fi

# ── Chromium ──────────────────────────────────────────────────────────────
# Prefer the unversioned symlink; fall back to whatever versioned build is
# present so a bumped image still resolves.
BROWSERS_ROOT="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
CHROMIUM=""
if [ -x "$BROWSERS_ROOT/chromium" ]; then
  CHROMIUM="$BROWSERS_ROOT/chromium"
else
  for candidate in "$BROWSERS_ROOT"/chromium-*/chrome-linux/chrome; do
    if [ -x "$candidate" ]; then CHROMIUM="$candidate"; break; fi
  done
fi

if [ -n "$CHROMIUM" ]; then
  emit "export CHROMIUM_PATH=\"$CHROMIUM\""
  emit "export PLAYWRIGHT_BROWSERS_PATH=\"$BROWSERS_ROOT\""
  emit "export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1"
else
  echo "  warning: no chromium under $BROWSERS_ROOT — browser tests will skip" >&2
fi

# ── Static server ─────────────────────────────────────────────────────────
# The pages load their siblings by relative URL, so file:// will not do. The
# port is exported rather than fixed in the tests; the test runner owns the
# server's lifetime, which keeps the hook free of background processes.
emit "export SCIENCE_LAB_PORT=8901"

echo "session-start: done"
