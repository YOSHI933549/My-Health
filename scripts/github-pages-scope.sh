#!/usr/bin/env bash
# Decide whether a push is only the encrypted inbox (and its public keys).
# Those commits are pushed straight to main and must still publish.
# Prints "true" or "false" on stdout. Never prints file contents or full paths.
set -euo pipefail

if [ "${EVENT_NAME:-}" != "push" ]; then
  echo false
  exit 0
fi

before="${BEFORE_SHA:-}"
head="${HEAD_SHA:-}"
if [ -z "$before" ] || [ -z "$head" ] || [ "$before" = "0000000000000000000000000000000000000000" ]; then
  # A brand-new branch has no reliable "before" commit. Do not skip check.
  echo false
  exit 0
fi

if ! git cat-file -e "${before}^{commit}" 2>/dev/null; then
  GIT_TERMINAL_PROMPT=0 git fetch --no-tags origin "$before"
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
git --no-pager diff --name-status -z "$before" "$head" > "$tmp"

inbox_path() {
  case "$1" in
    codex-inbox | codex-inbox/* | codex-devices | codex-devices/*) return 0 ;;
    *) return 1 ;;
  esac
}

any=false
inbox_only=true
prefix_file="$(mktemp)"
trap 'rm -f "$tmp" "$prefix_file"' EXIT

while IFS= read -r -d '' status; do
  any=true
  case "$status" in
    R* | C*)
      IFS= read -r -d '' path1
      IFS= read -r -d '' path2
      changed=("$path1" "$path2")
      ;;
    *)
      IFS= read -r -d '' path1
      changed=("$path1")
      ;;
  esac
  for path in "${changed[@]}"; do
    [ -n "$path" ] || continue
    printf '%s\n' "${path%%/*}" >> "$prefix_file"
    if ! inbox_path "$path"; then
      inbox_only=false
    fi
  done
done < "$tmp"

if [ "$any" != true ]; then
  echo false
  exit 0
fi

if [ -s "$prefix_file" ]; then
  echo "changed top-level names: $(sort -u "$prefix_file" | paste -sd ' ' -)" >&2
fi

if [ "$inbox_only" = true ]; then
  echo true
else
  echo false
fi
