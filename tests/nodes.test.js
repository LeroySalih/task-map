const request = require('supertest');
const { initDb } = require('../db');
const { createApp } = require('../app');

let db, agent;

beforeEach(async () => {
  process.env.ADMIN_EMAIL = 'admin@test.com';
  process.env.ADMIN_PASSWORD = 'test123';
  db = initDb(':memory:');
  const app = createApp(db);
  agent = request.agent(app);
  await agent.post('/login').send('email=admin%40test.com&password=test123');
});

afterEach(() => db.close());

describe('GET /api/tree', () => {
  test('returns tree with root, empty links and tags', async () => {
    const res = await agent.get('/api/tree');
    expect(res.status).toBe(200);
    expect(res.body.tree.id).toBe('root');
    expect(res.body.tree.children).toEqual([]);
    expect(res.body.links).toEqual([]);
    expect(res.body.tags).toEqual([]);
  });
});

describe('POST /api/nodes', () => {
  test('creates a project node under root', async () => {
    const res = await agent.post('/api/nodes').send({
      label: 'Test project', type: 'project', parent_id: 'root', status: 'active', progress: 0
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.label).toBe('Test project');
    expect(res.body.parent_id).toBe('root');
    expect(res.body.children).toEqual([]);
  });

  test('created node appears in GET /api/tree', async () => {
    await agent.post('/api/nodes').send({ label: 'P1', type: 'project', parent_id: 'root', status: 'active' });
    const res = await agent.get('/api/tree');
    expect(res.body.tree.children).toHaveLength(1);
    expect(res.body.tree.children[0].label).toBe('P1');
  });
});

describe('PATCH /api/nodes/:id', () => {
  test('updates node label', async () => {
    const created = await agent.post('/api/nodes').send({ label: 'Old', type: 'project', parent_id: 'root', status: 'active' });
    const id = created.body.id;
    const res = await agent.patch(`/api/nodes/${id}`).send({ label: 'New' });
    expect(res.status).toBe(200);
    const tree = await agent.get('/api/tree');
    expect(tree.body.tree.children[0].label).toBe('New');
  });
});

describe('DELETE /api/nodes/:id', () => {
  test('deletes a node', async () => {
    const created = await agent.post('/api/nodes').send({ label: 'Gone', type: 'project', parent_id: 'root', status: 'active' });
    await agent.delete(`/api/nodes/${created.body.id}`);
    const tree = await agent.get('/api/tree');
    expect(tree.body.tree.children).toHaveLength(0);
  });

  test('cascades to child nodes', async () => {
    const parent = await agent.post('/api/nodes').send({ label: 'Parent', type: 'project', parent_id: 'root', status: 'active' });
    await agent.post('/api/nodes').send({ label: 'Child', type: 'task', parent_id: parent.body.id, status: 'idea' });
    await agent.delete(`/api/nodes/${parent.body.id}`);
    const count = db.prepare("SELECT COUNT(*) as c FROM nodes WHERE id != 'root'").get().c;
    expect(count).toBe(0);
  });
});

describe('Node paths', () => {
  let nodeId;
  beforeEach(async () => {
    const n = await agent.post('/api/nodes').send({ label: 'N', type: 'project', parent_id: 'root', status: 'active' });
    nodeId = n.body.id;
  });

  test('POST adds a path and it appears in tree', async () => {
    await agent.post(`/api/nodes/${nodeId}/paths`).send({ label: 'Code', path: '~/Code/app' });
    const tree = await agent.get('/api/tree');
    expect(tree.body.tree.children[0].paths[0].path).toBe('~/Code/app');
  });

  test('PATCH updates path', async () => {
    const added = await agent.post(`/api/nodes/${nodeId}/paths`).send({ label: 'Code', path: '~/old' });
    await agent.patch(`/api/nodes/${nodeId}/paths/${added.body.id}`).send({ label: 'Code', path: '~/new' });
    const tree = await agent.get('/api/tree');
    expect(tree.body.tree.children[0].paths[0].path).toBe('~/new');
  });

  test('DELETE removes path', async () => {
    const added = await agent.post(`/api/nodes/${nodeId}/paths`).send({ label: 'Code', path: '~/Code/app' });
    await agent.delete(`/api/nodes/${nodeId}/paths/${added.body.id}`);
    const tree = await agent.get('/api/tree');
    expect(tree.body.tree.children[0].paths).toHaveLength(0);
  });
});

describe('Node tags', () => {
  let nodeId;
  beforeEach(async () => {
    const n = await agent.post('/api/nodes').send({ label: 'N', type: 'project', parent_id: 'root', status: 'active' });
    nodeId = n.body.id;
  });

  test('POST adds tag and it appears in tree + tags list', async () => {
    await agent.post(`/api/nodes/${nodeId}/tags`).send({ name: 'Teaching' });
    const tree = await agent.get('/api/tree');
    expect(tree.body.tree.children[0].tags).toContain('Teaching');
    expect(tree.body.tags).toContain('Teaching');
  });

  test('DELETE removes tag from node but keeps global tag', async () => {
    await agent.post(`/api/nodes/${nodeId}/tags`).send({ name: 'Teaching' });
    await agent.delete(`/api/nodes/${nodeId}/tags/Teaching`);
    const tree = await agent.get('/api/tree');
    expect(tree.body.tree.children[0].tags).toHaveLength(0);
    expect(tree.body.tags).toContain('Teaching');
  });
});

describe('PATCH /api/nodes/:id color', () => {
  test('PATCH color persists in tree', async () => {
    const created = await agent.post('/api/nodes').send({ label: 'Coloured', type: 'project', parent_id: 'root', status: 'active' });
    const id = created.body.id;
    await agent.patch(`/api/nodes/${id}`).send({ color: '#8b5cf6' });
    const tree = await agent.get('/api/tree');
    const node = tree.body.tree.children.find(c => c.id === id);
    expect(node.color).toBe('#8b5cf6');
  });

  test('PATCH color null clears colour', async () => {
    const created = await agent.post('/api/nodes').send({ label: 'Coloured', type: 'project', parent_id: 'root', status: 'active' });
    const id = created.body.id;
    await agent.patch(`/api/nodes/${id}`).send({ color: '#8b5cf6' });
    await agent.patch(`/api/nodes/${id}`).send({ color: null });
    const tree = await agent.get('/api/tree');
    const node = tree.body.tree.children.find(c => c.id === id);
    expect(node.color).toBeNull();
  });
});

describe('PATCH sort_order', () => {
  test('reorders siblings in tree', async () => {
    const n1 = await agent.post('/api/nodes').send({ label: 'First', type: 'project', parent_id: 'root', status: 'active' });
    const n2 = await agent.post('/api/nodes').send({ label: 'Second', type: 'project', parent_id: 'root', status: 'active' });
    await agent.patch(`/api/nodes/${n1.body.id}`).send({ sort_order: 1 });
    await agent.patch(`/api/nodes/${n2.body.id}`).send({ sort_order: 0 });
    const tree = await agent.get('/api/tree');
    expect(tree.body.tree.children[0].label).toBe('Second');
    expect(tree.body.tree.children[1].label).toBe('First');
  });
});
