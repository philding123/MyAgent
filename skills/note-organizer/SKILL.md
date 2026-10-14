---
name: note-organizer
description: Organize messy notes in the workspace into a structured summary file. Use when the user asks to tidy, summarize, or restructure notes.
allowed-tools:
  - read_file
  - list_dir
  - write_file
disable: false
---

# Note Organizer

When asked to organize notes:

1. `list_dir` on the workspace root to find note files (`.md`, `.txt`).
2. `read_file` each candidate (limit to first 200 lines).
3. Produce `SUMMARY.md` at the workspace root with sections per source file:
   key points as bullets, followed by an "Open questions" section.
4. Reply with the file path and a one-paragraph digest.
