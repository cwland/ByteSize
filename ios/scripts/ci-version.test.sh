#!/usr/bin/env bash
# Tests for ci-version.sh. Run: bash ios/scripts/ci-version.test.sh
set -u
here="$(cd "$(dirname "$0")" && pwd)"
fails=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected '$2', got '$3'"; fails=$((fails+1)); fi
}
check "tag ios-v0.10.0 gives 0.10.0" "0.10.0" "$(bash "$here/ci-version.sh" ios-v0.10.0 2>/dev/null)"
check "tag ios-v1.2 gives 1.2" "1.2" "$(bash "$here/ci-version.sh" ios-v1.2 2>/dev/null)"
bash "$here/ci-version.sh" v0.10.0 >/dev/null 2>&1; check "server tag v0.10.0 is refused" "1" "$?"
bash "$here/ci-version.sh" ios-v1.2.3.4 >/dev/null 2>&1; check "four-part version is refused" "1" "$?"
bash "$here/ci-version.sh" ios-vbeta >/dev/null 2>&1; check "non-numeric version is refused" "1" "$?"
bash "$here/ci-version.sh" >/dev/null 2>&1; check "missing tag is refused" "1" "$?"
[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
