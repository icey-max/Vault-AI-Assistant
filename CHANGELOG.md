# Changelog

## 0.1.2 - 2026-05-07

- Fixed chat switching so new chats and opened saved chats clear draft context, edit targets, image attachments, helper state, and scope mode instead of inheriting composer state from the previously active chat.
- Preserved historical context and edit target snapshots in conversation transcripts while keeping future-send draft context isolated.

## 0.1.1 - 2026-05-07

- Fixed context-backed modify proposals so provider tool calls that send replacement `content` for an attached note hydrate into reviewable diffs instead of failing with missing `previousContent`/`newContent`.
- Added Obsidian plugin guideline guardrails for code, planning, lint, build, and CI.
- Required provider adapters to receive an explicit Obsidian-safe request transport instead of falling back to browser `fetch`.
