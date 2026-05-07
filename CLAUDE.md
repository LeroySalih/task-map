# Task Map

A personal project mindmap web app. One user, deployed to mr-salih.org VPS.

## What this is

Interactive SVG canvas for tracking projects and tasks, based on `project-mindmap-prototype.html`. The prototype defines the full UI — pan/zoom canvas, sidebar, search, drag-to-link. This app adds persistence, auth, and a REST API behind it.

## Stack

- **Server:** Node.js + Express
- **Database:** SQLite via `better-sqlite3` — no ORM, no Prisma
- **Sessions:** `express-session` + `connect-sqlite3`
- **Passwords:** `bcryptjs`
- **Templates:** EJS (login page only)
- **Frontend:** Vanilla JS + CSS (no framework, no build step)
- **Process:** pm2 on VPS, Nginx reverse proxy

## Key files

| File | Purpose |
|------|---------|
| `server.js` | Express entry point |
| `db.js` | SQLite init, schema creation, admin user seed |
| `auth.js` | Login/logout routes + `requireAuth` middleware |
| `api/nodes.js` | Node CRUD |
| `api/links.js` | Cross-node links |
| `api/tags.js` | Global tag list |
| `views/login.ejs` | Server-rendered login page |
| `public/index.html` | App shell (served after auth) |
| `public/app.js` | Mindmap canvas (adapted from prototype) |
| `public/app.css` | Styles (extracted from prototype) |
| `data/taskmap.db` | SQLite database (gitignored) |

## Auth

- Single admin user only — no registration
- Credentials seeded from `.env` on first start (`ADMIN_EMAIL`, `ADMIN_PASSWORD`)
- `requireAuth` middleware on all routes except `/login`
- Sessions stored in SQLite

## Database rules

- Raw `better-sqlite3` only — no ORM, no query builder
- Schema defined in `db.js` with `CREATE TABLE IF NOT EXISTS`
- Tree stored as adjacency list (`parent_id` on nodes)
- Cascading deletes handle subtree removal

## API shape

- All API routes under `/api/*`, all return JSON
- `GET /api/tree` returns full tree + links + tags in one payload
- All mutations are surgical PATCH/POST/DELETE — no full reload
- Server returns created node (with id) on POST; client swaps temp id in local state

## Environment

```
SESSION_SECRET=
ADMIN_EMAIL=
ADMIN_PASSWORD=
PORT=3000
```

`.env` is gitignored. Set manually on the VPS.

## Design spec

Full design document: `docs/superpowers/specs/2026-05-07-task-map-design.md`

## Prototype reference

`project-mindmap-prototype.html` is the source of truth for UI behaviour. When in doubt about how a canvas interaction should work, refer to it. Do not change the rendering, layout, or interaction logic unless explicitly asked.
