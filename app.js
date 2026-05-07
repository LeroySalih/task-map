const express = require('express');
const path = require('path');
const session = require('express-session');
const { requireAuth, loginRouter } = require('./auth');
const nodesRouter = require('./api/nodes');
const tagsRouter = require('./api/tags');
const linksRouter = require('./api/links');

function createApp(db, opts = {}) {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  const sessionOpts = {
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 }
  };
  if (opts.sessionStore) sessionOpts.store = opts.sessionStore;
  app.use(session(sessionOpts));

  app.use('/', loginRouter(db));
  app.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
  });

  app.use(requireAuth);

  // nodesRouter is mounted at /api so it can own both /api/tree and /api/nodes/*
  app.use('/api', nodesRouter(db));
  app.use('/api/tags', tagsRouter(db));
  app.use('/api/links', linksRouter(db));

  app.use(express.static(path.join(__dirname, 'public')));

  return app;
}

module.exports = { createApp };
