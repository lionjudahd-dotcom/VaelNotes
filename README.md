# Vael Notes

The notes app for **Vael Awakening**: design notes with Obsidian-style links and a graph, the NPC roster, and the island map. It installs to a phone's home screen and works for reading offline.

This repository holds only the app's code. The notes themselves live in a private database and need a team login.

## Layout

| Folder | What it is |
| --- | --- |
| `docs/` | The app as it is served (GitHub Pages publishes this folder). `index.html` is built, so don't edit it by hand. |
| `src/` | Sources for the page: `page.html` (frame, NPC roster, island), `notes.*` (the notes system), `graph.js` (graph view). |
| `tools/` | `build.ps1` builds `docs/index.html`. `serve.ps1` serves the app at http://localhost:8765 for testing. |
| `supabase/` | The database setup (`schema.sql`) and the `join` function that turns an invite into a login. |

## Changing the app

1. Edit files in `src/` (or `docs/shell.js` and `docs/shell.css` for sign-in and settings).
2. Run `powershell -ExecutionPolicy Bypass -File tools\build.ps1`.
3. Commit and push. GitHub Pages updates in a minute or two.

## How access works

- People sign in with an email and a password they chose themselves.
- The owner invites people from Settings → Team. Each invite has a one-time code that the owner sends to the person.
- Roles: **Owner** (everything, plus the team), **Writer** (read and edit), **Reader** (read only).
- The key in `docs/config.js` is the database's public key. It is meant to be visible and can read nothing without a team login.
