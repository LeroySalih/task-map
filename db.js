const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

function initDb(dbPath = path.join(__dirname, 'data', 'taskmap.db')) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('root','project','task')),
      status TEXT CHECK(status IN ('active','onhold','completed','idea')),
      progress INTEGER DEFAULT 0,
      due TEXT,
      priority TEXT,
      notes TEXT,
      done INTEGER DEFAULT 0,
      parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS node_tags (
      node_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
      tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (node_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS node_paths (
      id INTEGER PRIMARY KEY,
      node_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
      label TEXT,
      path TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY,
      source_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
      target_id TEXT REFERENCES nodes(id) ON DELETE CASCADE
    );
  `);

  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (userCount === 0) {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env');
    const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hash);
  }

  const rootCount = db.prepare("SELECT COUNT(*) as c FROM nodes WHERE id = 'root'").get().c;
  if (rootCount === 0) {
    db.prepare("INSERT INTO nodes (id, label, type) VALUES ('root', 'My projects', 'root')").run();
  }

  return db;
}

module.exports = { initDb };
