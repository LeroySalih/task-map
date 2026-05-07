# Task Map — Design Spec

**Date:** 2026-05-07  
**Status:** Approved

## Overview

A personal project mindmap web app for one user, deployed to mr-salih.org VPS. Based on `project-mindmap-prototype.html`. The prototype's canvas interaction is preserved exactly; the app adds persistence (SQLite), a login wall, and a REST API.

## Stack

| Layer | Choice |
|-------|--------|
| Runtime | Node.js |
| Server | Express |
| Database | SQLite via `better-sqlite3` |
| Sessions | `express-session` + `connect-sqlite3` |
| Passwords | `bcryptjs` (rounds: 12) |
| Templates | EJS (login page only) |
| Frontend | Vanilla JS (adapted from prototype) |
| Process manager | pm2 |
| Reverse proxy | Nginx |

No ORM. No frontend framework. No build step.

## Folder Structure

```
task-map/
├── server.js              # Express entry point, middleware, route mounting
├── db.js                  # SQLite connection, schema init, seed admin user
├── auth.js                # Login/logout routes + requireAuth middleware
├── api/
│   ├── nodes.js           # CRUD for nodes
│   ├── links.js           # Cross-node links
│   └── tags.js            # Global tags
├── views/
│   └── login.ejs          # Server-rendered login page
├── public/
│   ├── index.html         # App shell (served after auth)
│   ├── app.js             # Mindmap canvas JS (adapted from prototype)
│   └── app.css            # Styles (extracted from prototype)
├── data/
│   └── taskmap.db         # SQLite file (gitignored)
├── .env                   # SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, PORT
├── .gitignore
└── package.json
```

## Database Schema

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);

CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('root','project','task')),
  status TEXT CHECK(status IN ('active','onhold','completed','idea')),
  progress INTEGER DEFAULT 0,
  due TEXT,
  priority TEXT,
  notes TEXT,
  done INTEGER DEFAULT 0,
  parent_id TEXT REFERENCES nodes(id),
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE node_tags (
  node_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (node_id, tag_id)
);

CREATE TABLE node_paths (
  id INTEGER PRIMARY KEY,
  node_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
  label TEXT,
  path TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE links (
  id INTEGER PRIMARY KEY,
  source_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
  target_id TEXT REFERENCES nodes(id) ON DELETE CASCADE
);
```

Tree structure is stored as adjacency list (`parent_id`). `sort_order` preserves sibling order. Cascading deletes handle subtree removal.

## Auth

- Single admin user seeded on startup from `.env` (`ADMIN_EMAIL`, `ADMIN_PASSWORD`)
- If no user exists, password is hashed and inserted; subsequent startups skip this
- `requireAuth` middleware: checks `req.session.userId`, redirects to `/login` if absent
- Applied to all routes except `GET /login` and `POST /login`
- `POST /logout` destroys session, redirects to `/login`
- No registration route

## API Endpoints

All routes under `/api/*` are protected by `requireAuth`. All return JSON.

```
POST   /login
POST   /logout

GET    /api/tree                      # full tree + links + tags
POST   /api/nodes                     # { label, type, parent_id, status, progress, due, priority, notes }
PATCH  /api/nodes/:id                 # any subset of node fields
DELETE /api/nodes/:id                 # cascades to children, tags, paths, links

POST   /api/nodes/:id/tags            # { name } — creates global tag if needed
DELETE /api/nodes/:id/tags/:name

POST   /api/nodes/:id/paths           # { label, path }
PATCH  /api/nodes/:id/paths/:pid      # { label, path }
DELETE /api/nodes/:id/paths/:pid

POST   /api/links                     # { source_id, target_id }
DELETE /api/links/:id
```

`GET /api/tree` returns:
```json
{
  "tree": { /* nested node tree, same shape as prototype's `data` */ },
  "links": [ { "id": 1, "source_id": "p1", "target_id": "p3" } ],
  "tags": ["Teaching", "Infrastructure", ...]
}
```

## Frontend Adaptation

`public/app.js` is the prototype JS with these changes only:

1. Remove hardcoded `data`, `links`, `allTags` — replaced with `fetch('/api/tree')` on load
2. Each mutation calls its API endpoint, then patches in-memory state; no full re-fetch
3. `newId()` uses a timestamp-based string to avoid collisions before server assigns a real id (server returns the created node and client swaps the temp id)
4. All canvas rendering, pan/zoom, search, sidebar, drag-link logic is unchanged

`public/index.html` is the prototype's `<body>` HTML (the `.app` div and its children), in a standard HTML shell. Loads `app.css` and `app.js`.

## Deployment

- Nginx reverse-proxies `tasks.mr-salih.org` → `localhost:3000`
- `pm2 start server.js --name task-map` keeps the process alive
- `data/taskmap.db` is created on first start; excluded from git
- `.env` is excluded from git; set manually on the VPS
