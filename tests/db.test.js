const { initDb } = require('../db');

describe('initDb', () => {
  let db;

  beforeEach(() => {
    process.env.ADMIN_EMAIL = 'admin@test.com';
    process.env.ADMIN_PASSWORD = 'test123';
    db = initDb(':memory:');
  });

  afterEach(() => db.close());

  test('creates all required tables', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map(r => r.name);
    expect(tables).toEqual(expect.arrayContaining([
      'links', 'node_paths', 'node_tags', 'nodes', 'tags', 'users'
    ]));
  });

  test('seeds admin user with hashed password', () => {
    const user = db.prepare('SELECT * FROM users').get();
    expect(user.email).toBe('admin@test.com');
    expect(user.password_hash).toMatch(/^\$2/);
  });

  test('does not duplicate admin on repeated calls', () => {
    const db2 = initDb(':memory:');
    const count = db2.prepare('SELECT COUNT(*) as c FROM users').get().c;
    expect(count).toBe(1);
    db2.close();
  });

  test('seeds root node', () => {
    const root = db.prepare("SELECT * FROM nodes WHERE id = 'root'").get();
    expect(root).toBeDefined();
    expect(root.type).toBe('root');
    expect(root.label).toBe('My projects');
  });
});
