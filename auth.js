const express = require('express');
const bcrypt = require('bcryptjs');

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.redirect('/login');
}

function loginRouter(db) {
  const router = express.Router();

  router.get('/login', (req, res) => {
    res.render('login', { error: null, email: '' });
  });

  router.post('/login', (req, res) => {
    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.render('login', { error: 'Invalid email or password', email: email || '' });
    }
    req.session.userId = user.id;
    res.redirect('/');
  });

  return router;
}

module.exports = { requireAuth, loginRouter };
