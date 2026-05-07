const request = require('supertest');
const { initDb } = require('../db');
const { createApp } = require('../app');

let db, agent, p1Id, p2Id;

beforeEach(async () => {
  process.env.ADMIN_EMAIL = 'admin@test.com';
  process.env.ADMIN_PASSWORD = 'test123';
  db = initDb(':memory:');
  const app = createApp(db);
  agent = request.agent(app);
  await agent.post('/login').send('email=admin%40test.com&password=test123');
  const r1 = await agent.post('/api/nodes').send({ label: 'P1', type: 'project', parent_id: 'root', status: 'active' });
  const r2 = await agent.post('/api/nodes').send({ label: 'P2', type: 'project', parent_id: 'root', status: 'active' });
  p1Id = r1.body.id;
  p2Id = r2.body.id;
});

afterEach(() => db.close());

test('POST /api/links creates a link', async () => {
  const res = await agent.post('/api/links').send({ source_id: p1Id, target_id: p2Id });
  expect(res.status).toBe(201);
  expect(res.body.id).toBeDefined();
  expect(res.body.source_id).toBe(p1Id);
  expect(res.body.target_id).toBe(p2Id);
});

test('link appears in GET /api/tree', async () => {
  await agent.post('/api/links').send({ source_id: p1Id, target_id: p2Id });
  const tree = await agent.get('/api/tree');
  expect(tree.body.links).toHaveLength(1);
  expect(tree.body.links[0].source_id).toBe(p1Id);
});

test('DELETE /api/links/:id removes the link', async () => {
  const created = await agent.post('/api/links').send({ source_id: p1Id, target_id: p2Id });
  await agent.delete(`/api/links/${created.body.id}`);
  const tree = await agent.get('/api/tree');
  expect(tree.body.links).toHaveLength(0);
});
