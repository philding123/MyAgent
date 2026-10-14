#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MEMORY_DIR="$ROOT_DIR/docs/project-memory"
OMX_DIR="$ROOT_DIR/.omx"
PROJECT_MEMORY_LOCK_FILE="$OMX_DIR/project-memory.lock"

acquire_project_memory_lock() {
  if [ "${PROJECT_MEMORY_LOCKED:-0}" = "1" ]; then
    return 0
  fi

  mkdir -p "$OMX_DIR"

  # flock is absent on Git Bash/MSYS; fall back to an atomic mkdir lock.
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$PROJECT_MEMORY_LOCK_FILE"
    flock 9
    export PROJECT_MEMORY_LOCKED=1
    return 0
  fi

  local lockdir="$PROJECT_MEMORY_LOCK_FILE.d"
  local waited=0
  while ! mkdir "$lockdir" 2>/dev/null; do
    local owner age now mtime
    owner="$(cat "$lockdir/pid" 2>/dev/null || true)"
    if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
      rm -rf "$lockdir"
      continue
    fi
    now=$(date +%s)
    mtime=$(stat -c %Y "$lockdir" 2>/dev/null || echo "$now")
    age=$(( now - mtime ))
    if [ "$age" -gt 30 ]; then
      rm -rf "$lockdir"
      continue
    fi
    if [ "$waited" -ge 15 ]; then
      echo "project-memory: lock busy ($lockdir); continuing without lock" >&2
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo $$ > "$lockdir/pid"
  PROJECT_MEMORY_LOCK_DIR="$lockdir"
}

release_project_memory_lock() {
  if [ -n "${PROJECT_MEMORY_LOCK_DIR:-}" ]; then
    rm -rf "$PROJECT_MEMORY_LOCK_DIR"
    PROJECT_MEMORY_LOCK_DIR=""
  fi
}

REQUIRED_FILES=(
  "$MEMORY_DIR/README.md"
  "$MEMORY_DIR/INDEX.md"
  "$MEMORY_DIR/STATUS.md"
  "$MEMORY_DIR/todo.md"
)

REQUIRED_DIRS=(
  "$MEMORY_DIR/daily"
  "$MEMORY_DIR/decisions"
  "$MEMORY_DIR/issues"
  "$MEMORY_DIR/templates"
)

required_sections_in_file() {
  local file="$1"
  shift

  for section in "$@"; do
    if ! grep -Fq "$section" "$file"; then
      echo "Missing required section '$section' in $file" >&2
      exit 1
    fi
  done
}

validate_link_target_exists() {
  local current_file="$1"
  local link_path="$2"
  local resolved

  [ -n "$link_path" ] || return 0

  resolved="$(cd "$(dirname "$current_file")" && realpath -m "$link_path")"
  if [ ! -f "$resolved" ]; then
    echo "Broken project memory link in $current_file: $link_path" >&2
    exit 1
  fi
}

ensure_structure() {
  local file
  local dir

  for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$file" ]; then
      echo "Missing required project memory file: $file" >&2
      exit 1
    fi
  done

  for dir in "${REQUIRED_DIRS[@]}"; do
    if [ ! -d "$dir" ]; then
      echo "Missing required project memory directory: $dir" >&2
      exit 1
    fi
  done

  required_sections_in_file \
    "$MEMORY_DIR/templates/daily.md" \
    "## Summary" \
    "## Progress" \
    "## Decisions" \
    "## Issues" \
    "## Risks And Blockers" \
    "## Next Actions" \
    "## Carry Over"

  required_sections_in_file \
    "$MEMORY_DIR/templates/decision.md" \
    "## Decision" \
    "## Context" \
    "## Options Considered" \
    "## Rationale" \
    "## Consequences" \
    "## Verification"

  required_sections_in_file \
    "$MEMORY_DIR/templates/issue.md" \
    "## Symptoms" \
    "## Impact" \
    "## Root Cause" \
    "## Resolution" \
    "## Validation" \
    "## Prevention"
}

ensure_generated_views_up_to_date() {
  local index_tmp
  local status_tmp
  local generated_index_tmp
  local generated_status_tmp

  index_tmp="$(mktemp)"
  status_tmp="$(mktemp)"
  generated_index_tmp="$(mktemp)"
  generated_status_tmp="$(mktemp)"
  cp "$MEMORY_DIR/INDEX.md" "$index_tmp"
  cp "$MEMORY_DIR/STATUS.md" "$status_tmp"

  PROJECT_MEMORY_LOCKED=1 \
  PROJECT_MEMORY_SKIP_OMX_SYNC=1 \
  PROJECT_MEMORY_SKIP_CLAUDE_SYNC=1 \
  PROJECT_MEMORY_INDEX_OUT="$generated_index_tmp" \
  PROJECT_MEMORY_STATUS_OUT="$generated_status_tmp" \
    bash "$ROOT_DIR/scripts/project-memory.sh" refresh >/dev/null

  if ! cmp -s "$index_tmp" "$generated_index_tmp" || ! cmp -s "$status_tmp" "$generated_status_tmp"; then
    rm -f "$index_tmp" "$status_tmp" "$generated_index_tmp" "$generated_status_tmp"
    echo "Project memory generated views are out of date." >&2
    echo "Run ./scripts/project-memory.sh refresh and commit docs/project-memory/INDEX.md and docs/project-memory/STATUS.md." >&2
    exit 1
  fi

  rm -f "$index_tmp" "$status_tmp" "$generated_index_tmp" "$generated_status_tmp"
}

validate_record_links() {
  local file
  local related_links
  local link

  while IFS= read -r file; do
    [ -n "$file" ] || continue
    related_links="$(grep -o '\(\.\./[^)]*\.md\)' "$file" | tr -d '()' || true)"
    while IFS= read -r link; do
      [ -n "$link" ] || continue
      validate_link_target_exists "$file" "$link"
    done <<EOF
$related_links
EOF
  done < <(find "$MEMORY_DIR/daily" "$MEMORY_DIR/decisions" "$MEMORY_DIR/issues" -maxdepth 1 -type f -name '*.md' | sort)
}

resolve_compare_range() {
  local base="${1:-}"
  local head="${2:-HEAD}"

  if [ -n "$base" ]; then
    printf '%s\n%s\n' "$base" "$head"
    return 0
  fi

  printf '\n\n'
}

load_changed_files() {
  local base="$1"
  local head="$2"

  if [ -n "$base" ]; then
    git diff --name-only --diff-filter=ACMR "$base" "$head"
  else
    git diff --name-only --diff-filter=ACMR HEAD --
    git ls-files --others --exclude-standard
  fi
}

is_memory_path() {
  case "$1" in
    docs/project-memory/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

requires_memory_update() {
  case "$1" in
    .github/*|config/*|docs/*|helm/*|k8s/*|scripts/*|src/*|Dockerfile|docker-compose*.yml|pom.xml|Makefile|README.md|TODO.md|AGENTS.md)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

validate_changed_memory_records() {
  local changed_memory_files=("$@")
  local file

  for file in "${changed_memory_files[@]}"; do
    case "$file" in
      docs/project-memory/daily/*.md)
        required_sections_in_file \
          "$ROOT_DIR/$file" \
          "## Summary" \
          "## Progress" \
          "## Decisions" \
          "## Issues" \
          "## Risks And Blockers" \
          "## Next Actions" \
          "## Carry Over"
        ;;
      docs/project-memory/decisions/*.md)
        required_sections_in_file \
          "$ROOT_DIR/$file" \
          "## Decision" \
          "## Context" \
          "## Options Considered" \
          "## Rationale" \
          "## Consequences" \
          "## Verification"
        ;;
      docs/project-memory/issues/*.md)
        required_sections_in_file \
          "$ROOT_DIR/$file" \
          "## Symptoms" \
          "## Impact" \
          "## Root Cause" \
          "## Resolution" \
          "## Validation" \
          "## Prevention"
        ;;
    esac
  done
}

main() {
  local base
  local head
  local changed_files_raw
  local file
  local requires_memory="false"
  local memory_updated="false"
  local changed_memory_files=()

  acquire_project_memory_lock
  trap 'release_project_memory_lock' EXIT
  ensure_structure
  ensure_generated_views_up_to_date
  validate_record_links

  mapfile -t compare_range < <(resolve_compare_range "${1:-}" "${2:-}")
  base="${compare_range[0]}"
  head="${compare_range[1]}"

  mapfile -t changed_files_raw < <(load_changed_files "$base" "$head")

  if [ "${#changed_files_raw[@]}" -eq 0 ]; then
    echo "Project memory validation passed: no changed files detected."
    exit 0
  fi

  for file in "${changed_files_raw[@]}"; do
    if is_memory_path "$file"; then
      memory_updated="true"
      changed_memory_files+=("$file")
    elif requires_memory_update "$file"; then
      requires_memory="true"
    fi
  done

  validate_changed_memory_records "${changed_memory_files[@]}"

  if [ "$requires_memory" = "true" ] && [ "$memory_updated" = "false" ]; then
    echo "Project memory validation failed: substantive repository changes were detected without updates under docs/project-memory/." >&2
    echo "Add at least one relevant daily, decision, issue, index, or todo update before merging." >&2
    exit 1
  fi

  echo "Project memory validation passed."
}

main "$@"
