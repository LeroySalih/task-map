const express = require('express');

module.exports = function linksRouter(db) {
  const router = express.Router();

  router.post('/', (req, res) => {
    const { source_id, target_id } = req.body;
    const result = db.prepare('INSERT INTO links (source_id, target_id) VALUES (?, ?)').run(source_id, target_id);
    res.status(201).json({ id: result.lastInsertRowid, source_id, target_id });
  });

  router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM links WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  return router;
};
