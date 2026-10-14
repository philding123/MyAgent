#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MEMORY_DIR="$ROOT_DIR/docs/project-memory"
DAILY_DIR="$MEMORY_DIR/daily"
DECISION_DIR="$MEMORY_DIR/decisions"
ISSUE_DIR="$MEMORY_DIR/issues"
INDEX_FILE="$MEMORY_DIR/INDEX.md"
STATUS_FILE="$MEMORY_DIR/STATUS.md"
OMX_DIR="$ROOT_DIR/.omx"
OMX_PROJECT_MEMORY_FILE="$OMX_DIR/project-memory.json"
OMX_NOTEPAD_FILE="$OMX_DIR/notepad.md"
CLAUDE_MEMORY_DIR="$ROOT_DIR/.claude/memory"
CLAUDE_PROJECT_MEMORY_FILE="$CLAUDE_MEMORY_DIR/project-memory.json"
CLAUDE_MEMORY_INDEX_FILE="$CLAUDE_MEMORY_DIR/MEMORY.md"
PROJECT_MEMORY_LOCK_FILE="$OMX_DIR/project-memory.lock"
INDEX_OUTPUT_FILE="${PROJECT_MEMORY_INDEX_OUT:-$INDEX_FILE}"
STATUS_OUTPUT_FILE="${PROJECT_MEMORY_STATUS_OUT:-$STATUS_FILE}"

acquire_project_memory_lock() {
  if [ "${PROJECT_MEMORY_LOCKED:-0}" = "1" ]; then
    return 0
  fi

  mkdir -p "$OMX_DIR"

  # flock is absent on Git Bash/MSYS; fall back to an atomic mkdir lock.
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$PROJECT_MEMORY_LOCK_FILE"
    flock 9
    return 0
  fi

  local lockdir="$PROJECT_MEMORY_LOCK_FILE.d"
  local waited=0
  while ! mkdir "$lockdir" 2>/dev/null; do
    # stale takeover: owner pid dead or lock older than 30s
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

usage() {
  cat <<'EOF'
Usage:
  ./scripts/project-memory.sh init
  ./scripts/project-memory.sh daily [YYYY-MM-DD]
  ./scripts/project-memory.sh decision <slug>
  ./scripts/project-memory.sh issue <slug>
  ./scripts/project-memory.sh note <target> <text>
  ./scripts/project-memory.sh todo-add <section> <text>
  ./scripts/project-memory.sh refresh
  ./scripts/project-memory.sh status

Examples:
  ./scripts/project-memory.sh init
  ./scripts/project-memory.sh daily
  ./scripts/project-memory.sh decision switch-default-port-source
  ./scripts/project-memory.sh issue login-rate-limit-gap
  ./scripts/project-memory.sh note completed "Added CI guardrail"
  ./scripts/project-memory.sh todo-add next "Review stale issue policy"
  ./scripts/project-memory.sh refresh
  ./scripts/project-memory.sh status
EOF
}

init_project_memory() {
  ensure_parent "$DAILY_DIR"
  ensure_parent "$DECISION_DIR"
  ensure_parent "$ISSUE_DIR"
  ensure_parent "$MEMORY_DIR/templates"

  if [ ! -f "$MEMORY_DIR/templates/daily.md" ]; then
    cat >"$MEMORY_DIR/templates/daily.md" <<'EOF'
# YYYY-MM-DD

## Summary

- What changed today?

## Progress

- Completed:
- In progress:

## Decisions

- Linked decisions:

## Issues

- New issues:
- Resolved issues:

## Risks And Blockers

- None

## Next Actions

- Next:

## Carry Over

- Move to tomorrow:
EOF
  fi

  if [ ! -f "$MEMORY_DIR/templates/decision.md" ]; then
    cat >"$MEMORY_DIR/templates/decision.md" <<'EOF'
# Title

- Date: YYYY-MM-DD
- Status: proposed
- Owners:
- Related issues:
- Related daily notes:

## Decision

- What is being decided?

## Context

- What prompted the decision?

## Options Considered

- Option A:
- Option B:

## Rationale

- Why was the chosen option selected?

## Consequences

- Positive:
- Negative:
- Follow-up:

## Verification

- How will we know this decision is working?
EOF
  fi

  if [ ! -f "$MEMORY_DIR/templates/issue.md" ]; then
    cat >"$MEMORY_DIR/templates/issue.md" <<'EOF'
# Title

- Date: YYYY-MM-DD
- Status: open
- Severity: medium
- Owners:
- Related decisions:
- Related daily notes:

## Symptoms

- What was observed?

## Impact

- Who or what was affected?

## Root Cause

- What actually caused the issue?

## Resolution

- What changed to fix or mitigate it?

## Validation

- How was the fix checked?

## Prevention

- What should be done to avoid a repeat?
EOF
  fi

  if [ ! -f "$MEMORY_DIR/todo.md" ]; then
    cat >"$MEMORY_DIR/todo.md" <<'EOF'
# Project Memory TODO

## Now

- Initial project setup and memory system adoption.

## Next

- Define core architecture milestones.

## Later

- Long-term optimization and scaling.

## Blocked

- None

## Recently Done

- Project memory initialized.
EOF
  fi

  if [ ! -f "$MEMORY_DIR/README.md" ]; then
    cat >"$MEMORY_DIR/README.md" <<'EOF'
# Project Memory System

This directory is the durable, versioned memory for this repository.

## Layout

- `INDEX.md`: Generated index with the latest links.
- `STATUS.md`: Generated current snapshot.
- `todo.md`: Prioritized work list.
- `daily/`: Daily progress records.
- `decisions/`: Architecture Decision Records (ADRs).
- `issues/`: Incident and problem post-mortems.
- `templates/`: Templates for new entries.
EOF
  fi

  create_daily "$(date '+%Y-%m-%d')" >/dev/null
  refresh_generated_views
  echo "Project memory successfully initialized at $MEMORY_DIR"
}

require_memory_dir() {
  if [ ! -d "$MEMORY_DIR" ]; then
    echo "Missing memory directory: $MEMORY_DIR" >&2
    exit 1
  fi
}

sanitize_slug() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed 's/[^a-z0-9._-]/-/g' \
    | sed 's/--*/-/g' \
    | sed 's/^-//' \
    | sed 's/-$//'
}

title_from_slug() {
  printf '%s' "$1" | tr '-' ' ' | awk '{
    for (i = 1; i <= NF; i++) {
      $i = toupper(substr($i, 1, 1)) substr($i, 2)
    }
    print
  }'
}

ensure_parent() {
  mkdir -p "$1"
}

require_value() {
  local name="$1"
  local value="${2:-}"

  if [ -z "$value" ]; then
    echo "Missing required value: $name" >&2
    usage
    exit 1
  fi
}

path_to_memory_link() {
  local absolute_path="$1"
  printf './%s' "${absolute_path#"$MEMORY_DIR/"}"
}

path_from_repo_root() {
  local absolute_path="$1"
  printf '%s' "${absolute_path#"$ROOT_DIR/"}"
}

write_file_if_changed() {
  local generated_file="$1"
  local target_file="$2"

  ensure_parent "$(dirname "$target_file")"
  if [ -f "$target_file" ] && cmp -s "$generated_file" "$target_file"; then
    rm -f "$generated_file"
    return 0
  fi

  mv "$generated_file" "$target_file"
}

title_for_file() {
  local file="$1"
  local title

  title="$(sed -n '1{s/^# //;p;q;}' "$file")"
  if [ -n "$title" ]; then
    printf '%s' "$title"
  else
    basename "$file" .md
  fi
}

recent_files_in_dir() {
  local dir="$1"
  local limit="$2"

  find "$dir" -maxdepth 1 -type f -name '*.md' -printf '%f\t%p\n' \
    | sort -r \
    | awk -F '\t' -v limit="$limit" 'NR <= limit { print $2 }'
}

latest_file_in_dir() {
  local dir="$1"
  recent_files_in_dir "$dir" 1
}

recent_records_markdown() {
  local dir="$1"
  local limit="$2"
  local link_prefix="${3:-}"
  local file
  local link

  while IFS= read -r file; do
    [ -n "$file" ] || continue
    if [ -n "$link_prefix" ]; then
      link="${link_prefix}$(path_from_repo_root "$file")"
    else
      link="$(path_to_memory_link "$file")"
    fi
    printf -- '- [%s](%s)\n' "$(title_for_file "$file")" "$link"
  done < <(recent_files_in_dir "$dir" "$limit")
}

current_todo_snapshot() {
  sed -n '/^## Now/,/^## /p' "$MEMORY_DIR/todo.md" | sed '$d'
}

json_escape() {
  printf '%s' "$1" | awk '
    BEGIN { ORS = "" }
    {
      gsub(/\\/,"\\\\")
      gsub(/"/,"\\\"")
      gsub(/\t/,"\\t")
      gsub(/\r/,"\\r")
      if (NR > 1) {
        printf "\\n"
      }
      printf "%s", $0
    }
  '
}

record_json() {
  local file="$1"
  printf '{"title":"%s","path":"%s"}' \
    "$(json_escape "$(title_for_file "$file")")" \
    "$(json_escape "$(path_from_repo_root "$file")")"
}

recent_records_json() {
  local dir="$1"
  local limit="$2"
  local first="true"
  local file

  printf '['
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    if [ "$first" = "false" ]; then
      printf ','
    fi
    record_json "$file"
    first="false"
  done < <(recent_files_in_dir "$dir" "$limit")
  printf ']'
}

current_focus_json() {
  local first="true"
  local line

  printf '['
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    if [ "$first" = "false" ]; then
      printf ','
    fi
    printf '"%s"' "$(json_escape "${line#- }")"
    first="false"
  done < <(current_todo_snapshot | grep '^- ' || true)
  printf ']'
}

current_focus_markdown() {
  current_todo_snapshot | grep '^- ' || true
}

sync_omx_memory_cache() {
  if [ "${PROJECT_MEMORY_SKIP_OMX_SYNC:-0}" = "1" ]; then
    return 0
  fi

  local latest_daily
  local latest_decision
  local latest_issue
  local synced_at

  ensure_parent "$OMX_DIR"

  latest_daily="$(latest_file_in_dir "$DAILY_DIR")"
  latest_decision="$(latest_file_in_dir "$DECISION_DIR")"
  latest_issue="$(latest_file_in_dir "$ISSUE_DIR")"
  synced_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

  cat >"$OMX_PROJECT_MEMORY_FILE" <<EOF
{
  "generatedFrom": "docs/project-memory/",
  "canonicalSource": "docs/project-memory/",
  "syncedAt": "$synced_at",
  "snapshot": {
    "status": "docs/project-memory/STATUS.md",
    "index": "docs/project-memory/INDEX.md",
    "todo": "docs/project-memory/todo.md",
    "latestDaily": $(record_json "$latest_daily"),
    "latestDecision": $(record_json "$latest_decision"),
    "latestIssue": $(record_json "$latest_issue")
  },
  "currentFocus": $(current_focus_json),
  "recentDecisions": $(recent_records_json "$DECISION_DIR" 3),
  "recentIssues": $(recent_records_json "$ISSUE_DIR" 3),
  "recentDaily": $(recent_records_json "$DAILY_DIR" 3),
  "notes": [
    "This file is a generated local OMX cache derived from docs/project-memory/.",
    "Do not treat this file as canonical project memory.",
    "Update docs/project-memory/ first, then regenerate the OMX cache."
  ]
}
EOF

  cat >"$OMX_NOTEPAD_FILE" <<EOF
## MANUAL
Generated from \`docs/project-memory/\`.
Use repository memory as the canonical source of truth.

- Latest daily: [$(title_for_file "$latest_daily")](../$(path_from_repo_root "$latest_daily"))
- Latest decision: [$(title_for_file "$latest_decision")](../$(path_from_repo_root "$latest_decision"))
- Latest issue: [$(title_for_file "$latest_issue")](../$(path_from_repo_root "$latest_issue"))
- Status snapshot: [Project Memory Status](../docs/project-memory/STATUS.md)
- Todo list: [Project Memory TODO](../docs/project-memory/todo.md)

## PRIORITY
$(current_focus_markdown)
EOF
}

sync_claude_memory_cache() {
  if [ "${PROJECT_MEMORY_SKIP_CLAUDE_SYNC:-0}" = "1" ]; then
    return 0
  fi

  local latest_daily
  local latest_decision
  local latest_issue
  local synced_at

  ensure_parent "$CLAUDE_MEMORY_DIR"
  mkdir -p "$CLAUDE_MEMORY_DIR"

  latest_daily="$(latest_file_in_dir "$DAILY_DIR")"
  latest_decision="$(latest_file_in_dir "$DECISION_DIR")"
  latest_issue="$(latest_file_in_dir "$ISSUE_DIR")"
  synced_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

  cat >"$CLAUDE_PROJECT_MEMORY_FILE" <<EOF
{
  "generatedFrom": "docs/project-memory/",
  "canonicalSource": "docs/project-memory/",
  "syncedAt": "$synced_at",
  "snapshot": {
    "status": "docs/project-memory/STATUS.md",
    "index": "docs/project-memory/INDEX.md",
    "todo": "docs/project-memory/todo.md",
    "latestDaily": $(record_json "$latest_daily"),
    "latestDecision": $(record_json "$latest_decision"),
    "latestIssue": $(record_json "$latest_issue")
  },
  "currentFocus": $(current_focus_json),
  "recentDecisions": $(recent_records_json "$DECISION_DIR" 3),
  "recentIssues": $(recent_records_json "$ISSUE_DIR" 3),
  "recentDaily": $(recent_records_json "$DAILY_DIR" 3),
  "notes": [
    "This file is a generated Claude Code memory cache derived from docs/project-memory/.",
    "Do not treat this file as canonical project memory.",
    "Do not edit it by hand; update docs/project-memory/ and run ./scripts/project-memory.sh refresh."
  ]
}
EOF

  cat >"$CLAUDE_MEMORY_INDEX_FILE" <<EOF
# Project Memory Index (Claude Code cache)

## MANUAL
Generated from \`docs/project-memory/\` by \`./scripts/project-memory.sh refresh\`.
Do not edit by hand. Repository memory is the canonical source of truth.

- Latest daily: [$(title_for_file "$latest_daily")](../../$(path_from_repo_root "$latest_daily"))
- Latest decision: [$(title_for_file "$latest_decision")](../../$(path_from_repo_root "$latest_decision"))
- Latest issue: [$(title_for_file "$latest_issue")](../../$(path_from_repo_root "$latest_issue"))
- Status snapshot: [Project Memory Status](../../docs/project-memory/STATUS.md)
- Todo list: [Project Memory TODO](../../docs/project-memory/todo.md)
- Recording rules: [Project Memory README](../../docs/project-memory/README.md)

## PRIORITY
$(current_focus_markdown)

## RECENT DECISIONS
$(recent_records_markdown "$DECISION_DIR" 3 "../../")

## RECENT ISSUES
$(recent_records_markdown "$ISSUE_DIR" 3 "../../")
EOF
}

append_line_after_match() {
  local file="$1"
  local match="$2"
  local line="$3"
  local tmp

  tmp="$(mktemp)"
  awk -v target="$match" -v new_line="$line" '
    {
      print
      if (!inserted && $0 == target) {
        print new_line
        inserted = 1
      }
    }
    END {
      if (!inserted) {
        exit 1
      }
    }
  ' "$file" >"$tmp" || {
    rm -f "$tmp"
    echo "Could not find target marker '$match' in $file" >&2
    exit 1
  }
  mv "$tmp" "$file"
}

append_line_after_section_heading() {
  local file="$1"
  local heading="$2"
  local line="$3"
  local tmp

  tmp="$(mktemp)"
  awk -v target="$heading" -v new_line="$line" '
    {
      if (pending && !inserted) {
        print
        if ($0 == "") {
          print new_line
        } else {
          print ""
          print new_line
        }
        inserted = 1
        pending = 0
        next
      }

      print
      if (!inserted && $0 == target) {
        pending = 1
      }
    }
    END {
      if (!inserted) {
        exit 1
      }
    }
  ' "$file" >"$tmp" || {
    rm -f "$tmp"
    echo "Could not find section heading '$heading' in $file" >&2
    exit 1
  }
  mv "$tmp" "$file"
}

refresh_generated_views() {
  local latest_daily
  local latest_decision
  local latest_issue
  local index_tmp
  local status_tmp

  latest_daily="$(latest_file_in_dir "$DAILY_DIR")"
  latest_decision="$(latest_file_in_dir "$DECISION_DIR")"
  latest_issue="$(latest_file_in_dir "$ISSUE_DIR")"

  ensure_parent "$(dirname "$INDEX_OUTPUT_FILE")"
  ensure_parent "$(dirname "$STATUS_OUTPUT_FILE")"

  index_tmp="$(mktemp "$(dirname "$INDEX_OUTPUT_FILE")/.project-memory-index.XXXXXX")"
  status_tmp="$(mktemp "$(dirname "$STATUS_OUTPUT_FILE")/.project-memory-status.XXXXXX")"

  cat >"$index_tmp" <<EOF
# Project Memory Index

## Current Entry Points

- [System overview](./README.md)
- [Architecture overview](./ARCHITECTURE.md)
- [Architecture slides](./ARCHITECTURE-SLIDES.md)
- [Architecture for leadership](./ARCHITECTURE-EXECUTIVE.md)
- [Architecture for engineers](./ARCHITECTURE-TECHNICAL.md)
- [Current status snapshot](./STATUS.md)
- [Current todo list](./todo.md)
- [Latest daily progress]($(path_to_memory_link "$latest_daily"))
- [Latest decision]($(path_to_memory_link "$latest_decision"))
- [Latest issue]($(path_to_memory_link "$latest_issue"))

## Recent Daily Notes

$(recent_records_markdown "$DAILY_DIR" 5)

## Recent Decisions

$(recent_records_markdown "$DECISION_DIR" 5)

## Recent Issues

$(recent_records_markdown "$ISSUE_DIR" 5)

## How To Use

- Read \`STATUS.md\` for the current project-memory snapshot.
- Read \`todo.md\` to understand the current queue.
- Read the latest file in \`daily/\` to catch up on ongoing work.
- Read \`decisions/\` for durable rationale behind important changes.
- Read \`issues/\` for known problems, fixes, and prevention notes.
EOF

  cat >"$status_tmp" <<EOF
# Project Memory Status

## Snapshot

- Latest daily note: [$(title_for_file "$latest_daily")]($(path_to_memory_link "$latest_daily"))
- Latest decision: [$(title_for_file "$latest_decision")]($(path_to_memory_link "$latest_decision"))
- Latest issue: [$(title_for_file "$latest_issue")]($(path_to_memory_link "$latest_issue"))
- Current todo list: [Project Memory TODO](./todo.md)

## Current Focus

$(current_todo_snapshot)

## Recent Activity

### Decisions

$(recent_records_markdown "$DECISION_DIR" 3)

### Issues

$(recent_records_markdown "$ISSUE_DIR" 3)

### Daily Notes

$(recent_records_markdown "$DAILY_DIR" 3)

## Commands

- \`./scripts/project-memory.sh daily\`
- \`./scripts/project-memory.sh decision <slug>\`
- \`./scripts/project-memory.sh issue <slug>\`
- \`./scripts/project-memory.sh note <target> <text>\`
- \`./scripts/project-memory.sh todo-add <section> <text>\`
- \`./scripts/project-memory.sh refresh\`
- \`./scripts/project-memory.sh status\`
- \`./scripts/validate-project-memory.sh\`
EOF

  write_file_if_changed "$index_tmp" "$INDEX_OUTPUT_FILE"
  write_file_if_changed "$status_tmp" "$STATUS_OUTPUT_FILE"
  sync_omx_memory_cache
  sync_claude_memory_cache
}

create_daily() {
  local note_date="${1:-$(date '+%Y-%m-%d')}"
  local file="$DAILY_DIR/$note_date.md"

  if [ -f "$file" ]; then
    refresh_generated_views
    echo "$file"
    return 0
  fi

  ensure_parent "$DAILY_DIR"
  cat >"$file" <<EOF
# $note_date

## Summary

- What changed today?

## Progress

- Completed:
- In progress:

## Decisions

- Linked decisions:

## Issues

- New issues:
- Resolved issues:

## Risks And Blockers

- None

## Next Actions

- Next:

## Carry Over

- Move to tomorrow:
EOF

  refresh_generated_views
  echo "$file"
}

today_daily_file() {
  create_daily "$(date '+%Y-%m-%d')" >/dev/null
  printf '%s/%s.md' "$DAILY_DIR" "$(date '+%Y-%m-%d')"
}

append_daily_note() {
  local target="${1:-}"
  shift || true
  local text="$*"
  local file
  local marker
  local prefix='- '

  require_value "target" "$target"
  require_value "text" "$text"

  file="$(today_daily_file)"

  case "$target" in
    summary)
      append_line_after_section_heading "$file" "## Summary" "- $text"
      refresh_generated_views
      echo "$file"
      return 0
      ;;
    completed)
      marker="- Completed:"
      prefix='  - '
      ;;
    in-progress)
      marker="- In progress:"
      prefix='  - '
      ;;
    decision)
      marker="- Linked decisions:"
      prefix='  - '
      ;;
    issue-new)
      marker="- New issues:"
      prefix='  - '
      ;;
    issue-resolved)
      marker="- Resolved issues:"
      prefix='  - '
      ;;
    risk)
      append_line_after_section_heading "$file" "## Risks And Blockers" "- $text"
      refresh_generated_views
      echo "$file"
      return 0
      ;;
    next)
      marker="- Next:"
      prefix='  - '
      ;;
    carry-over)
      marker="- Move to tomorrow:"
      prefix='  - '
      ;;
    *)
      echo "Unsupported note target: $target" >&2
      echo "Supported targets: summary, completed, in-progress, decision, issue-new, issue-resolved, risk, next, carry-over" >&2
      exit 1
      ;;
  esac

  append_line_after_match "$file" "$marker" "${prefix}${text}"
  refresh_generated_views
  echo "$file"
}

append_todo_item() {
  local section="${1:-}"
  shift || true
  local text="$*"
  local marker

  require_value "section" "$section"
  require_value "text" "$text"

  case "$section" in
    now)
      append_line_after_section_heading "$MEMORY_DIR/todo.md" "## Now" "- $text"
      refresh_generated_views
      echo "$MEMORY_DIR/todo.md"
      return 0
      ;;
    next)
      append_line_after_section_heading "$MEMORY_DIR/todo.md" "## Next" "- $text"
      refresh_generated_views
      echo "$MEMORY_DIR/todo.md"
      return 0
      ;;
    later)
      append_line_after_section_heading "$MEMORY_DIR/todo.md" "## Later" "- $text"
      refresh_generated_views
      echo "$MEMORY_DIR/todo.md"
      return 0
      ;;
    blocked)
      append_line_after_section_heading "$MEMORY_DIR/todo.md" "## Blocked" "- $text"
      refresh_generated_views
      echo "$MEMORY_DIR/todo.md"
      return 0
      ;;
    done)
      append_line_after_section_heading "$MEMORY_DIR/todo.md" "## Recently Done" "- $text"
      refresh_generated_views
      echo "$MEMORY_DIR/todo.md"
      return 0
      ;;
    *)
      echo "Unsupported todo section: $section" >&2
      echo "Supported sections: now, next, later, blocked, done" >&2
      exit 1
      ;;
  esac

  echo "Unexpected todo append path" >&2
  exit 1
}

create_decision() {
  local raw_slug="${1:-}"
  local slug
  local today
  local title
  local file

  if [ -z "$raw_slug" ]; then
    usage
    exit 1
  fi

  slug="$(sanitize_slug "$raw_slug")"
  if [ -z "$slug" ]; then
    echo "Decision slug cannot be empty after sanitization" >&2
    exit 1
  fi

  today="$(date '+%Y-%m-%d')"
  title="$(title_from_slug "$slug")"
  file="$DECISION_DIR/$today-$slug.md"

  if [ -f "$file" ]; then
    refresh_generated_views
    echo "$file"
    return 0
  fi

  ensure_parent "$DECISION_DIR"
  cat >"$file" <<EOF
# $title

- Date: $today
- Status: proposed
- Owners:
- Related issues:
- Related daily notes: [${today}](../daily/${today}.md)

## Decision

- What is being decided?

## Context

- What prompted the decision?

## Options Considered

- Option A:
- Option B:

## Rationale

- Why was the chosen option selected?

## Consequences

- Positive:
- Negative:
- Follow-up:

## Verification

- How will we know this decision is working?
EOF

  refresh_generated_views
  echo "$file"
}

create_issue() {
  local raw_slug="${1:-}"
  local slug
  local today
  local title
  local file

  if [ -z "$raw_slug" ]; then
    usage
    exit 1
  fi

  slug="$(sanitize_slug "$raw_slug")"
  if [ -z "$slug" ]; then
    echo "Issue slug cannot be empty after sanitization" >&2
    exit 1
  fi

  today="$(date '+%Y-%m-%d')"
  title="$(title_from_slug "$slug")"
  file="$ISSUE_DIR/$today-$slug.md"

  if [ -f "$file" ]; then
    refresh_generated_views
    echo "$file"
    return 0
  fi

  ensure_parent "$ISSUE_DIR"
  cat >"$file" <<EOF
# $title

- Date: $today
- Status: open
- Severity: medium
- Owners:
- Related decisions:
- Related daily notes: [${today}](../daily/${today}.md)

## Symptoms

- What was observed?

## Impact

- Who or what was affected?

## Root Cause

- What actually caused the issue?

## Resolution

- What changed to fix or mitigate it?

## Validation

- How was the fix checked?

## Prevention

- What should be done to avoid a repeat?
EOF

  refresh_generated_views
  echo "$file"
}

main() {
  acquire_project_memory_lock
  trap 'release_project_memory_lock' EXIT

  if [ "${1:-}" = "init" ]; then
    init_project_memory
    exit 0
  fi

  require_memory_dir

  case "${1:-}" in
    daily)
      shift
      create_daily "${1:-}"
      ;;
    decision)
      shift
      create_decision "${1:-}"
      ;;
    issue)
      shift
      create_issue "${1:-}"
      ;;
    note)
      shift
      append_daily_note "${1:-}" "${@:2}"
      ;;
    todo-add)
      shift
      append_todo_item "${1:-}" "${@:2}"
      ;;
    refresh)
      refresh_generated_views
      printf '%s\n%s\n' "$INDEX_OUTPUT_FILE" "$STATUS_OUTPUT_FILE"
      ;;
    status)
      refresh_generated_views
      cat "$STATUS_OUTPUT_FILE"
      ;;
    ""|-h|--help|help)
      usage
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
