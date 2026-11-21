#!/usr/bin/env bash
# Prints the app version (MARKETING_VERSION) for an iOS release tag: ios-v0.10.0 -> 0.10.0.
# Exits 1 for anything that isn't ios-v<major>.<minor>[.<patch>].
set -eu
tag="${1:-}"
if [[ "$tag" =~ ^ios-v([0-9]+\.[0-9]+(\.[0-9]+)?)$ ]]; then
  echo "${BASH_REMATCH[1]}"
else
  echo "Not an iOS release tag (expected ios-v1.2.3): '$tag'" >&2
  exit 1
fi
