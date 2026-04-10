// src/__tests__/api/chat.routes.test.js
// API tests cho /api/chat/* — test toàn bộ pipeline route → authMiddleware → controller.

process.env.SESSION_SECRET = 'api_test_secret_2026';
process.env.NODE_ENV       = 'test';

jest.mock('../../controllers/chatController', () => ({
  getChatHistory:   jest.fn((req, res) => res.json([])),
  getContacts:      jest.fn((req, res) => res.json([])),
  getFriendRequests: jest.fn((req, res) => res.json([])),
  getNotifications: jest.fn((req, res) => res.json([])),
  unfriend:         jest.fn((req, res) => res.json({ success: true })),
  blockUser:        jest.fn((req, res) => res.json({ success: true })),
  unblockUser:      jest.fn((req, res) => res.json({ success: true })),
  deleteMessage:    jest.fn((req, res) => res.json({ success: true })),
  toggleReaction:   jest.fn((req, res) => res.json({ success: true })),
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
const chatRoutes   = require('../../routes/chatRoutes');
const chatController = require('../../controllers/chatController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/chat', chatRoutes);
  return app;
}
const app = buildApp();

function makeToken(userId = 'uid_alice', username = 'alice') {
  return jwt.sign({ userId, username }, process.env.SESSION_SECRET, { expiresIn: '15m' });
}

beforeEach(() => jest.clearAllMocks());

// ════════════════════════════════════════════════════════════════════════
describe('authMiddleware trên chat routes', () => {
  test('không có Authorization header → 401, controller không được gọi', async () => {
    const res = await request(app).get('/api/chat/contacts');
    expect(res.status).toBe(401);
    expect(chatController.getContacts).not.toHaveBeenCalled();
  });

  test('token giả mạo → 401 TOKEN_INVALID', async () => {
    const res = await request(app)
      .get('/api/chat/contacts')
      .set('Authorization', 'Bearer fake.jwt.token');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_INVALID');
  });

  test('token hết hạn → 401 TOKEN_EXPIRED', async () => {
    const expired = jwt.sign({ userId: 'uid1', username: 'u' }, process.env.SESSION_SECRET, { expiresIn: '-1s' });
    const res = await request(app)
      .get('/api/chat/contacts')
      .set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });

  test('token hợp lệ → controller được gọi', async () => {
    const token = makeToken();
    const res   = await request(app)
      .get('/api/chat/contacts')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(chatController.getContacts).toHaveBeenCalledTimes(1);
  });

  test('JWT payload được truyền vào req.user (controller nhận đúng userId)', async () => {
    const token = makeToken('uid_special', 'special_user');
    await request(app)
      .get('/api/chat/contacts')
      .set('Authorization', `Bearer ${token}`);
    const reqArg = chatController.getContacts.mock.calls[0][0];
    expect(reqArg.user.userId).toBe('uid_special');
    expect(reqArg.user.username).toBe('special_user');
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('GET /api/chat/history/:partnerId', () => {
  test('token hợp lệ + partnerId → controller được gọi với đúng params', async () => {
    const token = makeToken();
    const partnerId = '507f1f77bcf86cd799439011';
    await request(app)
      .get(`/api/chat/history/${partnerId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(chatController.getChatHistory).toHaveBeenCalledTimes(1);
    const reqArg = chatController.getChatHistory.mock.calls[0][0];
    expect(reqArg.params.partnerId).toBe(partnerId);
  });

  test('userId đến từ JWT, không phải URL — bảo vệ IDOR', async () => {
    const token = makeToken('uid_alice_real');
    const partnerId = '507f1f77bcf86cd799439022';
    await request(app)
      .get(`/api/chat/history/${partnerId}`)
      .set('Authorization', `Bearer ${token}`);
    const reqArg = chatController.getChatHistory.mock.calls[0][0];
    // userId phải từ JWT, không phải tự inject
    expect(reqArg.user.userId).toBe('uid_alice_real');
  });

  test('không có token → 401', async () => {
    const res = await request(app).get('/api/chat/history/507f1f77bcf86cd799439011');
    expect(res.status).toBe(401);
    expect(chatController.getChatHistory).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('GET /api/chat/requests', () => {
  test('token hợp lệ → 200', async () => {
    const res = await request(app)
      .get('/api/chat/requests')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(chatController.getFriendRequests).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/chat/notifications', () => {
  test('token hợp lệ → 200', async () => {
    const res = await request(app)
      .get('/api/chat/notifications')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(chatController.getNotifications).toHaveBeenCalledTimes(1);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('POST /api/chat/unfriend', () => {
  test('token hợp lệ + body → controller được gọi', async () => {
    const res = await request(app)
      .post('/api/chat/unfriend')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ targetId: '507f1f77bcf86cd799439011' });
    expect(res.status).toBe(200);
    expect(chatController.unfriend).toHaveBeenCalledTimes(1);
  });

  test('không có token → 401', async () => {
    const res = await request(app).post('/api/chat/unfriend').send({ targetId: 'x' });
    expect(res.status).toBe(401);
    expect(chatController.unfriend).not.toHaveBeenCalled();
  });
});

describe('POST /api/chat/block', () => {
  test('token hợp lệ → controller được gọi', async () => {
    const res = await request(app)
      .post('/api/chat/block')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ targetId: '507f1f77bcf86cd799439011' });
    expect(res.status).toBe(200);
    expect(chatController.blockUser).toHaveBeenCalledTimes(1);
  });

  test('không có token → 401', async () => {
    const res = await request(app).post('/api/chat/block').send({ targetId: 'x' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/chat/unblock', () => {
  test('token hợp lệ → 200', async () => {
    const res = await request(app)
      .post('/api/chat/unblock')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ targetId: '507f1f77bcf86cd799439011' });
    expect(res.status).toBe(200);
    expect(chatController.unblockUser).toHaveBeenCalledTimes(1);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('POST /api/chat/message/delete', () => {
  test('token hợp lệ → controller được gọi', async () => {
    const res = await request(app)
      .post('/api/chat/message/delete')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ messageId: '507f1f77bcf86cd799439011' });
    expect(res.status).toBe(200);
    expect(chatController.deleteMessage).toHaveBeenCalledTimes(1);
  });

  test('không có token → 401', async () => {
    const res = await request(app)
      .post('/api/chat/message/delete')
      .send({ messageId: '507f1f77bcf86cd799439011' });
    expect(res.status).toBe(401);
    expect(chatController.deleteMessage).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('POST /api/chat/message/reaction', () => {
  test('token hợp lệ → controller được gọi', async () => {
    const res = await request(app)
      .post('/api/chat/message/reaction')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ messageId: '507f1f77bcf86cd799439011', emoji: '👍' });
    expect(res.status).toBe(200);
    expect(chatController.toggleReaction).toHaveBeenCalledTimes(1);
  });

  test('không có token → 401', async () => {
    const res = await request(app)
      .post('/api/chat/message/reaction')
      .send({ messageId: '507f1f77bcf86cd799439011', emoji: '👍' });
    expect(res.status).toBe(401);
  });
});
