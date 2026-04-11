// src/__tests__/api/auth.routes.test.js
// API tests cho /api/auth/* — test toàn bộ pipeline route → validator → controller.
// Dùng supertest + mock controller để tránh phụ thuộc DB.

process.env.SESSION_SECRET = 'api_test_secret_2026';
process.env.NODE_ENV       = 'test';

// Mock controller để test chỉ kiểm tra validation + routing
jest.mock('../../controllers/authController', () => ({
  checkUsername:     jest.fn((req, res) => res.json({ exists: false })),
  register:          jest.fn((req, res) => res.status(201).json({ message: 'ok' })),
  getSalt:           jest.fn((req, res) => res.json({ salt: 'saltVal==' })),
  login:             jest.fn((req, res) => res.json({ accessToken: 'fakeJWT', user: { userId: 'uid1', username: 'u', encryptedPrivateKey: 'enc=', iv: 'iv=', encryptedSigningPrivateKey: 'esig=', signingIv: 'siv=' } })),
  refreshToken:      jest.fn((req, res) => res.json({ accessToken: 'newJWT' })),
  logout:            jest.fn((req, res) => res.json({ message: 'logged out' })),
  verifyRecoveryKey: jest.fn((req, res) => res.json({ encryptedPrivateKeyByRecovery: 'enc=', recoveryIv: 'iv=', encryptedSigningPrivateKeyByRecovery: 'es=', recoverySigningIv: 'rsiv=' })),
  resetPassword:     jest.fn((req, res) => res.json({ message: 'reset ok' })),
}));

jest.mock('../../middleware/rateLimiter', () => ({
  apiLimiter:      (req, res, next) => next(),
  authLimiter:     (req, res, next) => next(),
  registerLimiter: (req, res, next) => next(),
  resetLimiter:    (req, res, next) => next(),
}));

const request    = require('supertest');
const express    = require('express');
const cookieParser = require('cookie-parser');
const authRoutes = require('../../routes/authRoutes');
const authController = require('../../controllers/authController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  return app;
}
const app = buildApp();

const VALID_REGISTER = {
  username:    'alice_test',
  salt:        'c2FsdEJhc2U2NFN0cmluZw==',
  authKeyHash: 'dGVzdEF1dGhLZXlIYXNoQmFzZTY0U3RyaW5nRm9yVGVzdGluZw==',
  recoveryKeyPlain: 'AABB1122-CCDD3344-EEFF5566-77889900-AABB1122-CCDD3344-EEFF5566-77889900',
  publicKey:                            'pubKey==',
  encryptedPrivateKey:                  'encPriv==',
  iv:                                   'iv==',
  signingPublicKey:                     'sigPub==',
  encryptedSigningPrivateKey:           'encSig==',
  signingIv:                            'sigIv==',
};

beforeEach(() => jest.clearAllMocks());

// ════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/register — validation pipeline', () => {
  test('payload hợp lệ đầy đủ → 201, controller được gọi', async () => {
    const res = await request(app).post('/api/auth/register').send(VALID_REGISTER);
    expect(res.status).toBe(201);
    expect(authController.register).toHaveBeenCalledTimes(1);
  });

  test('username chứa khoảng trắng → 400 VALIDATION_ERROR, controller KHÔNG được gọi', async () => {
    const res = await request(app).post('/api/auth/register').send({ ...VALID_REGISTER, username: 'bad user' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(authController.register).not.toHaveBeenCalled();
  });

  test('username quá ngắn (< 3 ký tự) → 400 VALIDATION_ERROR', async () => {
    const res = await request(app).post('/api/auth/register').send({ ...VALID_REGISTER, username: 'ab' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('username quá dài (> 20 ký tự) → 400 VALIDATION_ERROR', async () => {
    const res = await request(app).post('/api/auth/register').send({ ...VALID_REGISTER, username: 'a'.repeat(21) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('username có dấu tiếng Việt → 400 VALIDATION_ERROR', async () => {
    const res = await request(app).post('/api/auth/register').send({ ...VALID_REGISTER, username: 'nguyễn' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('thiếu publicKey → 400 VALIDATION_ERROR', async () => {
    const { publicKey: _, ...body } = VALID_REGISTER;
    const res = await request(app).post('/api/auth/register').send(body);
    expect(res.status).toBe(400);
    expect(authController.register).not.toHaveBeenCalled();
  });

  test('thiếu encryptedPrivateKey → 400', async () => {
    const { encryptedPrivateKey: _, ...body } = VALID_REGISTER;
    const res = await request(app).post('/api/auth/register').send(body);
    expect(res.status).toBe(400);
  });

  test('thiếu signingPublicKey → 400', async () => {
    const { signingPublicKey: _, ...body } = VALID_REGISTER;
    const res = await request(app).post('/api/auth/register').send(body);
    expect(res.status).toBe(400);
  });

  test('thiếu recoveryKeyPlain → 400', async () => {
    const { recoveryKeyPlain: _, ...body } = VALID_REGISTER;
    const res = await request(app).post('/api/auth/register').send(body);
    expect(res.status).toBe(400);
  });

  test('salt quá ngắn (< 10 ký tự) → 400', async () => {
    const res = await request(app).post('/api/auth/register').send({ ...VALID_REGISTER, salt: 'abc' });
    expect(res.status).toBe(400);
  });

  test('authKeyHash quá ngắn → 400', async () => {
    const res = await request(app).post('/api/auth/register').send({ ...VALID_REGISTER, authKeyHash: 'short' });
    expect(res.status).toBe(400);
  });

  test('username hợp lệ với ký tự _, - và số → 201', async () => {
    const res = await request(app).post('/api/auth/register').send({ ...VALID_REGISTER, username: 'user_01-test' });
    expect(res.status).toBe(201);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('GET /api/auth/salt', () => {
  test('có username param → 200, controller được gọi', async () => {
    const res = await request(app).get('/api/auth/salt?username=alice');
    expect(res.status).toBe(200);
    expect(authController.getSalt).toHaveBeenCalledTimes(1);
  });

  test('không có username param → controller vẫn được gọi (validation ở controller)', async () => {
    const res = await request(app).get('/api/auth/salt');
    // Route không có validator cho GET, controller xử lý
    expect(authController.getSalt).toHaveBeenCalledTimes(1);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/login — validation pipeline', () => {
  const VALID_LOGIN = { username: 'alice_test', authKeyHash: 'dGVzdEF1dGhLZXlIYXNoQmFzZTY0U3RyaW5nRm9yVGVzdGluZw==' };

  test('payload hợp lệ → 200, controller được gọi', async () => {
    const res = await request(app).post('/api/auth/login').send(VALID_LOGIN);
    expect(res.status).toBe(200);
    expect(authController.login).toHaveBeenCalledTimes(1);
  });

  test('thiếu username → 400 VALIDATION_ERROR, controller KHÔNG được gọi', async () => {
    const res = await request(app).post('/api/auth/login').send({ authKeyHash: VALID_LOGIN.authKeyHash });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(authController.login).not.toHaveBeenCalled();
  });

  test('thiếu authKeyHash → 400 VALIDATION_ERROR', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'alice_test' });
    expect(res.status).toBe(400);
    expect(authController.login).not.toHaveBeenCalled();
  });

  test('username có ký tự đặc biệt không hợp lệ → 400', async () => {
    const res = await request(app).post('/api/auth/login').send({ ...VALID_LOGIN, username: 'alice@test' });
    expect(res.status).toBe(400);
  });

  test('authKeyHash quá ngắn → 400', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'alice_test', authKeyHash: 'x' });
    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/refresh', () => {
  test('có cookie refreshToken → controller được gọi', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', 'refreshToken=sometoken123');
    expect(authController.refreshToken).toHaveBeenCalledTimes(1);
  });

  test('không có cookie → controller vẫn được gọi (xử lý ở controller level)', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(authController.refreshToken).toHaveBeenCalledTimes(1);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/logout', () => {
  test('gọi logout → controller được invoke', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(authController.logout).toHaveBeenCalledTimes(1);
  });

  test('không cần JWT để logout (không có authMiddleware trên route này)', async () => {
    // Gọi không có Authorization header vẫn phải reach controller
    const res = await request(app).post('/api/auth/logout');
    expect(authController.logout).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/verify-recovery — validation pipeline', () => {
  const VALID = {
    username:    'alice_test',
    recoveryKey: 'AABB1122-CCDD3344-EEFF5566-77889900-AABB1122-CCDD3344-EEFF5566-77889900',
  };

  test('payload hợp lệ → 200, controller được gọi', async () => {
    const res = await request(app).post('/api/auth/verify-recovery').send(VALID);
    expect(res.status).toBe(200);
    expect(authController.verifyRecoveryKey).toHaveBeenCalledTimes(1);
  });

  test('recoveryKey format sai (7 nhóm) → 400 VALIDATION_ERROR', async () => {
    const res = await request(app).post('/api/auth/verify-recovery').send({
      ...VALID,
      recoveryKey: 'AABB1122-CCDD3344-EEFF5566-77889900-AABB1122-CCDD3344-EEFF5566',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(authController.verifyRecoveryKey).not.toHaveBeenCalled();
  });

  test('recoveryKey có ký tự không phải hex → 400', async () => {
    const res = await request(app).post('/api/auth/verify-recovery').send({
      ...VALID,
      recoveryKey: 'GGGGGGGG-CCDD3344-EEFF5566-77889900-AABB1122-CCDD3344-EEFF5566-77889900',
    });
    expect(res.status).toBe(400);
  });

  test('thiếu username → 400', async () => {
    const { username: _, ...body } = VALID;
    const res = await request(app).post('/api/auth/verify-recovery').send(body);
    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/reset-password — validation pipeline', () => {
  const VALID = {
    username:    'alice_test',
    recoveryKey: 'AABB1122-CCDD3344-EEFF5566-77889900-AABB1122-CCDD3344-EEFF5566-77889900',
    newSalt:     'bmV3U2FsdEJhc2U2NA==',
    newAuthKeyHash: 'bmV3QXV0aEtleUhhc2hCYXNlNjRTdHJpbmc=',
    newEncryptedPrivateKey: 'bmV3RW5jUHJpdktleQ==',
    newIv: 'bmV3SXZCYXNLNDI=',
  };

  test('payload đầy đủ hợp lệ → controller được gọi', async () => {
    const res = await request(app).post('/api/auth/reset-password').send(VALID);
    expect(res.status).toBe(200);
    expect(authController.resetPassword).toHaveBeenCalledTimes(1);
  });

  test('thiếu newSalt → 400', async () => {
    const { newSalt: _, ...body } = VALID;
    const res = await request(app).post('/api/auth/reset-password').send(body);
    expect(res.status).toBe(400);
    expect(authController.resetPassword).not.toHaveBeenCalled();
  });

  test('thiếu newAuthKeyHash → 400', async () => {
    const { newAuthKeyHash: _, ...body } = VALID;
    const res = await request(app).post('/api/auth/reset-password').send(body);
    expect(res.status).toBe(400);
  });

  test('thiếu newEncryptedPrivateKey → 400', async () => {
    const { newEncryptedPrivateKey: _, ...body } = VALID;
    const res = await request(app).post('/api/auth/reset-password').send(body);
    expect(res.status).toBe(400);
  });

  test('newSalt quá ngắn → 400', async () => {
    const res = await request(app).post('/api/auth/reset-password').send({ ...VALID, newSalt: 'abc' });
    expect(res.status).toBe(400);
  });

  test('newAuthKeyHash quá ngắn → 400', async () => {
    const res = await request(app).post('/api/auth/reset-password').send({ ...VALID, newAuthKeyHash: 'x' });
    expect(res.status).toBe(400);
  });

  test('recoveryKey format sai → 400', async () => {
    const res = await request(app).post('/api/auth/reset-password').send({ ...VALID, recoveryKey: 'BAD' });
    expect(res.status).toBe(400);
  });
});
