# MEMORY.md

## Operating rules (Lucas)

- Runtime: Sam (OpenClaw) is running on a cloud VPS.
- Each Telegram group is treated as a separate "employee" (separate session context). Communicate global standards by broadcasting to the relevant groups.
- For GitHub projects: maintain **(1)** a detailed bilingual README (Chinese + English) and **(2)** a separate **Chinese-only** markdown doc.
- README must be beginner-friendly, step-by-step, with a clear architecture and a **Table of Contents/目录** for navigation.
- This VPS has a GitHub SSH key configured; for any GitHub push/pull, use SSH (not HTTPS). Identity key: `~/.ssh/id_ed25519_github_lucas`.
- **When Lucas asks me to do something, I must confirm completion back to Lucas (don’t “read and not reply”).**
