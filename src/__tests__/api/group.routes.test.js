// src/__tests__/api/group.routes.test.js
// API tests cho /api/groups/* — test routing + authMiddleware.

process.env.SESSION_SECRET = 'api_test_secret_2026';
process.env.NODE_ENV       = 'test';

jest.mock('../../controllers/groupController', () => ({
  getMemberKeys:       jest.fn((req, res) => res.json([])),
  createGroup:         jest.fn((req, res) => res.status(201).json({ _id: 'gid1', name: 'G' })),
  getGroups:           jest.fn((req, res) => res.json([])),
  getGroupHistory:     jest.fn((req, res) => res.json([])),
  getGroupInfo:        jest.fn((req, res) => res.json({ _id: 'gid1', name: 'G', members: [] })),
  getMyGroupKey:       jest.fn((req, res) => res.json({ encryptedGroupKey: 'enc=', keyIv: 'iv=' })),
  addMember:           jest.fn((req, res) => res.json({ success: true })),
  removeMember:        jest.fn((req, res) => res.json({ success: true, removedName: 'bob' })),
  leaveGroup:          jest.fn((req, res) => res.json({ success: true, leavingName: 'alice' })),
  deleteGroupMessage:  jest.fn((req, res) => res.json({ success: true })),
  toggleGroupReaction: jest.fn((req, res) => res.json({ success: true })),
}));

jest.mock('../../middleware/rateLimiter', () => ({
  apiLimiter:      (req, res, next) => next(),
  authLimiter:     (req, res, next) => next(),
  registerLimiter: (req, res, next) => next(),
  resetLimiter:    (req, res, next) => next(),
}));

const request      = require('supertest');
const express      = require('express');
const cookieParser = require('cookie-parser');
const jwt          = require('jsonwebtoken');
const groupRoutes  = require('../../routes/groupRoutes');
const groupController = require('../../controllers/groupController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/groups', groupRoutes);
  return app;
}
const app = buildApp();

function makeToken(userId = 'uid_alice') {
  return jwt.sign({ userId, username: 'alice' }, process.env.SESSION_SECRET, { expiresIn: '15m' });
}

beforeEach(() => jest.clearAllMocks());

// ════════════════════════════════════════════════════════════════════════
describe('authMiddleware trên group routes', () => {
  test('mọi route đều cần token — GET / không có token → 401', async () => {
    const res = await request(app).get('/api/groups');
    expect(res.status).toBe(401);
    expect(groupController.getGroups).not.toHaveBeenCalled();
  });

  test('token hợp lệ → getGroups được gọi', async () => {
    const res = await request(app)
      .get('/api/groups')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(groupController.getGroups).toHaveBeenCalledTimes(1);
  });

  test('token giả → 401 TOKEN_INVALID', async () => {
    const res = await request(app)
      .get('/api/groups')
      .set('Authorization', 'Bearer fake.token.here');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_INVALID');
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('GET /api/groups/member-keys', () => {
  test('token hợp lệ + userIds param → controller được gọi', async () => {
    const res = await request(app)
      .get('/api/groups/member-keys?userIds=uid1,uid2')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(groupController.getMemberKeys).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/groups/create', () => {
  test('token hợp lệ → 201, controller được gọi', async () => {
    const res = await request(app)
      .post('/api/groups/create')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ name: 'NewGroup', members: [] });
    expect(res.status).toBe(201);
    expect(groupController.createGroup).toHaveBeenCalledTimes(1);
  });

  test('không có token → 401', async () => {
    const res = await request(app).post('/api/groups/create').send({ name: 'G', members: [] });
    expect(res.status).toBe(401);
    expect(groupController.createGroup).not.toHaveBeenCalled();
  });
});

describe('GET /api/groups/:groupId/history', () => {
  test('token hợp lệ + groupId → controller được gọi với đúng params', async () => {
    await request(app)
      .get('/api/groups/gid999/history')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(groupController.getGroupHistory).toHaveBeenCalledTimes(1);
    const reqArg = groupController.getGroupHistory.mock.calls[0][0];
    expect(reqArg.params.groupId).toBe('gid999');
  });

  test('không có token → 401', async () => {
    const res = await request(app).get('/api/groups/gid999/history');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/groups/:groupId/info', () => {
  test('token hợp lệ → controller được gọi', async () => {
    await request(app)
      .get('/api/groups/gid888/info')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(groupController.getGroupInfo).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/groups/:groupId/my-key', () => {
  test('token hợp lệ → controller được gọi', async () => {
    await request(app)
      .get('/api/groups/gid777/my-key')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(groupController.getMyGroupKey).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/groups/:groupId/add-member', () => {
  test('token hợp lệ → controller được gọi', async () => {
    const res = await request(app)
      .post('/api/groups/gid1/add-member')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ userId: 'uid2', encryptedGroupKey: 'enc=', keyIv: 'iv=' });
    expect(res.status).toBe(200);
    expect(groupController.addMember).toHaveBeenCalledTimes(1);
  });

  test('không có token → 401', async () => {
    const res = await request(app).post('/api/groups/gid1/add-member').send({});
    expect(res.status).toBe(401);
  });
});

describe('POST /api/groups/:groupId/remove-member', () => {
  test('token hợp lệ → controller được gọi', async () => {
    const res = await request(app)
      .post('/api/groups/gid1/remove-member')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ userId: 'uid2' });
    expect(res.status).toBe(200);
    expect(groupController.removeMember).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/groups/:groupId/leave', () => {
  test('token hợp lệ → controller được gọi', async () => {
    const res = await request(app)
      .post('/api/groups/gid1/leave')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(groupController.leaveGroup).toHaveBeenCalledTimes(1);
  });

  test('userId đến từ JWT, không phải body', async () => {
    const token = makeToken('uid_alice_jwt');
    await request(app)
      .post('/api/groups/gid1/leave')
      .set('Authorization', `Bearer ${token}`);
    const reqArg = groupController.leaveGroup.mock.calls[0][0];
    expect(reqArg.user.userId).toBe('uid_alice_jwt');
  });
});

describe('POST /api/groups/message/delete', () => {
  test('token hợp lệ → controller được gọi', async () => {
    const res = await request(app)
      .post('/api/groups/message/delete')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ messageId: '507f1f77bcf86cd799439011' });
    expect(res.status).toBe(200);
    expect(groupController.deleteGroupMessage).toHaveBeenCalledTimes(1);
  });

  test('không có token → 401', async () => {
    const res = await request(app).post('/api/groups/message/delete').send({});
    expect(res.status).toBe(401);
    expect(groupController.deleteGroupMessage).not.toHaveBeenCalled();
  });
});

describe('POST /api/groups/message/reaction', () => {
  test('token hợp lệ → controller được gọi', async () => {
    const res = await request(app)
      .post('/api/groups/message/reaction')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ messageId: '507f1f77bcf86cd799439011', emoji: '👍' });
    expect(res.status).toBe(200);
    expect(groupController.toggleGroupReaction).toHaveBeenCalledTimes(1);
  });
});
