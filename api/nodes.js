const express = require('express');

function buildTree(db) {
  const nodes = db.prepare('SELECT * FROM nodes ORDER BY sort_order').all();
  const nodeTags = db.prepare(
    'SELECT nt.node_id, t.name FROM node_tags nt JOIN tags t ON t.id = nt.tag_id'
  ).all();
  const paths = db.prepare('SELECT * FROM node_paths ORDER BY sort_order').all();
  const links = db.prepare('SELECT * FROM links').all();
  const allTags = db.prepare('SELECT name FROM tags ORDER BY name').all().map(r => r.name);

  const map = {};
  for (const n of nodes) {
    map[n.id] = { ...n, done: !!n.done, tags: [], paths: [], children: [] };
  }
  for (const { node_id, name } of nodeTags) {
    if (map[node_id]) map[node_id].tags.push(name);
  }
  for (const p of paths) {
    if (map[p.node_id]) map[p.node_id].paths.push({ id: p.id, label: p.label, path: p.path });
  }

  let root = null;
  for (const n of nodes) {
    if (!n.parent_id) {
      root = map[n.id];
    } else if (map[n.parent_id]) {
      map[n.parent_id].children.push(map[n.id]);
    }
  }

  return { tree: root, links, tags: allTags };
}

module.exports = function nodesRouter(db) {
  const router = express.Router();

  router.get('/tree', (req, res) => {
    res.json(buildTree(db));
  });

  router.post('/nodes', (req, res) => {
    const { label, type, parent_id, status, progress, due, priority, notes } = req.body;
    const id = 'n' + Date.now();
    const { m: maxOrder } = db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) as m FROM nodes WHERE parent_id IS ?'
    ).get(parent_id || null);
    db.prepare(
      'INSERT INTO nodes (id, label, type, parent_id, status, progress, due, priority, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, label, type, parent_id || null, status || 'idea', progress || 0, due || null, priority || null, notes || null, maxOrder + 1);
    const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
    res.status(201).json({ ...node, done: !!node.done, tags: [], paths: [], children: [] });
  });

  router.patch('/nodes/:id', (req, res) => {
    const allowed = ['label', 'type', 'status', 'progress', 'due', 'priority', 'notes', 'done', 'parent_id', 'sort_order'];
    const fields = Object.keys(req.body).filter(k => allowed.includes(k));
    if (fields.length > 0) {
      const sets = fields.map(f => `${f} = ?`).join(', ');
      db.prepare(`UPDATE nodes SET ${sets} WHERE id = ?`).run(...fields.map(f => req.body[f]), req.params.id);
    }
    res.json({ ok: true });
  });

  router.delete('/nodes/:id', (req, res) => {
    db.prepare('DELETE FROM nodes WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  router.post('/nodes/:id/paths', (req, res) => {
    const { label, path } = req.body;
    const { m: maxOrder } = db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) as m FROM node_paths WHERE node_id = ?'
    ).get(req.params.id);
    const result = db.prepare(
      'INSERT INTO node_paths (node_id, label, path, sort_order) VALUES (?, ?, ?, ?)'
    ).run(req.params.id, label || '', path, maxOrder + 1);
    res.status(201).json({ id: result.lastInsertRowid, node_id: req.params.id, label: label || '', path });
  });

  router.patch('/nodes/:id/paths/:pid', (req, res) => {
    const { label, path } = req.body;
    db.prepare('UPDATE node_paths SET label = ?, path = ? WHERE id = ? AND node_id = ?')
      .run(label, path, req.params.pid, req.params.id);
    res.json({ ok: true });
  });

  router.delete('/nodes/:id/paths/:pid', (req, res) => {
    db.prepare('DELETE FROM node_paths WHERE id = ? AND node_id = ?')
      .run(req.params.pid, req.params.id);
    res.json({ ok: true });
  });

  router.post('/nodes/:id/tags', (req, res) => {
    const { name } = req.body;
    db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(name);
    const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(name);
    db.prepare('INSERT OR IGNORE INTO node_tags (node_id, tag_id) VALUES (?, ?)').run(req.params.id, tag.id);
    res.json({ ok: true });
  });

  router.delete('/nodes/:id/tags/:name', (req, res) => {
    const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(req.params.name);
    if (tag) {
      db.prepare('DELETE FROM node_tags WHERE node_id = ? AND tag_id = ?').run(req.params.id, tag.id);
    }
    res.json({ ok: true });
  });

  return router;
};
