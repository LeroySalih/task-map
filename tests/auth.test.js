const request = require('supertest');
const express = require('express');
const session = require('express-session');
const { initDb } = require('../db');
const { requireAuth, loginRouter } = require('../auth');

function makeApp(db) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', require('path').join(__dirname, '../views'));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.use('/', loginRouter(db));
  app.post('/logout', (req, res) => { req.session.destroy(() => res.redirect('/login')); });
  app.get('/protected', requireAuth, (req, res) => res.json({ ok: true }));
  return app;
}

let db, app;

beforeEach(() => {
  process.env.ADMIN_EMAIL = 'admin@test.com';
  process.env.ADMIN_PASSWORD = 'test123';
  db = initDb(':memory:');
  app = makeApp(db);
});

afterEach(() => db.close());

test('GET /login returns 200 with form', async () => {
  const res = await request(app).get('/login');
  expect(res.status).toBe(200);
  expect(res.text).toContain('<form');
});

test('POST /login with wrong password re-renders with error', async () => {
  const res = await request(app)
    .post('/login')
    .send('email=admin%40test.com&password=wrong');
  expect(res.status).toBe(200);
  expect(res.text).toContain('Invalid');
});

test('POST /login with correct credentials redirects to /', async () => {
  const res = await request(app)
    .post('/login')
    .send('email=admin%40test.com&password=test123');
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/');
});

test('requireAuth redirects unauthenticated requests to /login', async () => {
  const res = await request(app).get('/protected');
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/login');
});

test('requireAuth allows authenticated requests', async () => {
  const agent = request.agent(app);
  await agent.post('/login').send('email=admin%40test.com&password=test123');
  const res = await agent.get('/protected');
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
});

test('POST /logout destroys session', async () => {
  const agent = request.agent(app);
  await agent.post('/login').send('email=admin%40test.com&password=test123');
  await agent.post('/logout');
  const res = await agent.get('/protected');
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/login');
});
