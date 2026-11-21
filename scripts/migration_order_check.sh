#!/usr/bin/env bash
# Pull-request check for migration files. Run in CI after `git fetch origin main`.
#   1. A migration added in this branch must be NEWER than every migration on main.
#      (TypeORM silently runs an older-timestamped migration out of order.)
#   2. After the freeze, migrations already on main must never be edited or deleted.
# Usage: scripts/migration_order_check.sh [base-ref]   (default origin/main)
# Set MIGRATIONS_FROZEN=true in CI from the first shared deployment onwards.
set -euo pipefail
BASE="${1:-origin/main}"
DIR="src/database/migrations"
status=0

newest_on_base=$(git ls-tree --name-only "$BASE" "$DIR/" | grep -oE '[0-9]{13}' | sort -n | tail -1 || true)
added=$(git diff --name-only --diff-filter=A "$BASE"...HEAD -- "$DIR" || true)

for f in $added; do
  ts=$(basename "$f" | grep -oE '^[0-9]{13}' || true)
  if [[ -z "$ts" ]]; then
    echo "ERROR: $f does not start with a 13-digit timestamp (use pnpm migration:create)"; status=1; continue
  fi
  if [[ -n "$newest_on_base" && "$ts" -le "$newest_on_base" ]]; then
    echo "ERROR: $f ($ts) is older than the newest migration on $BASE ($newest_on_base)."
    echo "       Someone merged a migration after you created yours. Rename the file and the class"
    echo "       to a new timestamp (date +%s%3N), rerun pnpm schema:check, and push again."
    status=1
  fi
done

if [[ "${MIGRATIONS_FROZEN:-false}" == "true" ]]; then
  changed=$(git diff --name-only --diff-filter=MDR "$BASE"...HEAD -- "$DIR" || true)
  for f in $changed; do
    echo "ERROR: $f is already on $BASE and must not be changed. Write a new migration instead."; status=1
  done
fi

[[ $status -eq 0 ]] && echo "migration order check passed"
exit $status
