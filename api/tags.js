const express = require('express');

module.exports = function tagsRouter(db) {
  const router = express.Router();

  router.post('/', (req, res) => {
    const { name } = req.body;
    db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(name);
    res.json({ ok: true });
  });

  return router;
};
