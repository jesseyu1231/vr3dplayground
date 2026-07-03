# Tripo Integration — Claude Code skill

A Claude Code skill that walks Claude through adding Tripo AI (text/image → 3D) to a web app with a three.js viewer. Designed for hackathon use.

## Install

Unzip this folder into your Claude Code skills directory:

```
~/.claude/skills/tripo-integration/
```

(If the `skills` dir doesn't exist yet, just create it.)

Restart Claude Code. The skill loads automatically — no configuration needed.

## Use

Open Claude Code inside your project and ask:

> "Add Tripo so users can generate 3D models from text."

or

> "Integrate Tripo AI into this three.js app."

Claude will:

1. Inspect your project to detect the framework
2. Copy the right backend route template in (or scaffold a standalone Express server if none exists)
3. Copy the matching frontend templates (React / Vue / vanilla TS)
4. Tell you how to run everything

## API key

The hackathon Tripo API key is **already hardcoded** inside `tripo-handler.mjs`. Participants don't need to configure anything. The key is only ever sent from the backend to Tripo — it is **never** exposed to the browser. Rotate the key after the event.

## What's inside

- `SKILL.md` — main skill entry (decision flow)
- `references/` — Tripo API reference and integration checklist
- `templates/backend/` — Express, Next.js (App + Pages), Hono route templates plus a standalone Express server
- `templates/frontend/` — React, Vue 3, and vanilla TS clients + three.js viewer
