// src/__tests__/integration/authController.test.js
// Integration tests cho authController — dùng jest.mock để mock mongoose models.
// Không cần kết nối DB thật.

process.env.SESSION_SECRET = 'integration_test_secret_2026';
process.env.NODE_ENV       = 'test';

const { makeFakeUser, makeFakeRefreshToken, FAKE_KEYS, DEFAULT_AUTH_KEY, DEFAULT_RECOV_KEY } = require('../helpers/fixtures');

// ── Mock toàn bộ mongoose models ──────────────────────────────────────────
jest.mock('../../models/User');
jest.mock('../../models/RefreshToken');
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const User         = require('../../models/User');
const RefreshToken = require('../../models/RefreshToken');
const authController = require('../../controllers/authController');

// ── mock req/res factory ──────────────────────────────────────────────────
function mkRes() {
  const res = {
    _status: null, _body: null, _cookies: {},
    status(s)  { this._status = s; return this; },
    json(b)    { this._body = b;   return this; },
    cookie(name, val, opts) { this._cookies[name] = { val, opts }; },
    clearCookie(name) { this._cookies[name] = null; },
  };
  return res;
}
function mkReq(body = {}, cookies = {}, query = {}) {
  return { body, cookies, query, user: null };
}

beforeEach(() => jest.clearAllMocks());

// ════════════════════════════════════════════════════════════════════════════
describe('authController.register()', () => {
  const validBody = {
    username: 'newuser', salt: 'saltVal==', authKeyHash: DEFAULT_AUTH_KEY,
    recoveryKeyPlain: DEFAULT_RECOV_KEY, ...FAKE_KEYS,
  };

  test('đăng ký thành công → 201', async () => {
    User.findOne.mockResolvedValue(null);           // username chưa tồn tại
    User.prototype.save = jest.fn().mockResolvedValue(true);
    // mockReturnThis cho new User(...) → save()
    User.mockImplementation(() => ({ save: jest.fn().mockResolvedValue(true) }));

    const req = mkReq(validBody); const res = mkRes();
    await authController.register(req, res);

    expect(res._status).toBe(201);
    expect(res._body).toHaveProperty('message');
  });

  test('username đã tồn tại → 400', async () => {
    const fakeUser = await makeFakeUser({ username: 'newuser' });
    User.findOne.mockResolvedValue(fakeUser);

    const req = mkReq(validBody); const res = mkRes();
    await authController.register(req, res);

    expect(res._status).toBe(400);
    expect(res._body.message).toMatch(/tồn tại/);
  });

  test('authKeyHash được bcrypt hash trước khi lưu (không lưu plaintext)', async () => {
    User.findOne.mockResolvedValue(null);
    let savedData = null;
    User.mockImplementation((data) => {
      savedData = data;
      return { save: jest.fn().mockResolvedValue(true) };
    });

    const req = mkReq(validBody); const res = mkRes();
    await authController.register(req, res);

    // authKeyHash trong object được tạo phải là bcrypt hash
    expect(savedData.authKeyHash).toMatch(/^\$2/);
    expect(savedData.authKeyHash).not.toBe(DEFAULT_AUTH_KEY);
  });

  test('recoveryKeyHash được bcrypt hash, không lưu plaintext recovery key', async () => {
    User.findOne.mockResolvedValue(null);
    let savedData = null;
    User.mockImplementation((data) => {
      savedData = data;
      return { save: jest.fn().mockResolvedValue(true) };
    });

    const req = mkReq(validBody); const res = mkRes();
    await authController.register(req, res);

    expect(savedData.recoveryKeyHash).toMatch(/^\$2/);
    expect(savedData.recoveryKeyHash).not.toBe(DEFAULT_RECOV_KEY);
  });

  test('Mongoose ValidationError → 400 với thông báo field', async () => {
    User.findOne.mockResolvedValue(null);
    const valErr = Object.assign(new Error('Validation failed'), {
      name: 'ValidationError',
      errors: { username: { message: 'required' } },
    });
    User.mockImplementation(() => ({ save: jest.fn().mockRejectedValue(valErr) }));

    const req = mkReq(validBody); const res = mkRes();
    await authController.register(req, res);

    expect(res._status).toBe(400);
  });

  test('MongoDB duplicate key (race condition) → 400', async () => {
    User.findOne.mockResolvedValue(null);
    const dupErr = Object.assign(new Error('E11000'), { code: 11000 });
    User.mockImplementation(() => ({ save: jest.fn().mockRejectedValue(dupErr) }));

    const req = mkReq(validBody); const res = mkRes();
    await authController.register(req, res);

    expect(res._status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('authController.getSalt()', () => {
  test('username tồn tại → 200 + trả salt', async () => {
    const fakeUser = await makeFakeUser({ username: 'alice', salt: 'mySalt123==' });
    User.findOne.mockResolvedValue(fakeUser);

    const req = mkReq({}, {}, { username: 'alice' }); const res = mkRes();
    await authController.getSalt(req, res);

    expect(res._body).toEqual({ salt: 'mySalt123==' });
  });

  test('username không tồn tại → vẫn 200 + trả fake salt (chống enumeration)', async () => {
    User.findOne.mockResolvedValue(null);
    const req = mkReq({}, {}, { username: 'ghost' }); const res = mkRes();
    await authController.getSalt(req, res);

    // Phải trả 200 với salt (fake) — không lộ user không tồn tại
    expect(res._status).toBeNull(); // 200 mặc định
    expect(res._body).toHaveProperty('salt');
    expect(typeof res._body.salt).toBe('string');
  });

  test('thiếu username param → 400', async () => {
    const req = mkReq({}, {}, {}); const res = mkRes();
    await authController.getSalt(req, res);

    expect(res._status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('authController.login()', () => {
  test('đăng nhập đúng authKeyHash → 200 + accessToken + set HttpOnly cookie', async () => {
    const fakeUser = await makeFakeUser({ username: 'alice', _id: { toString: () => 'uid001' } });
    User.findOne.mockResolvedValue(fakeUser);
    RefreshToken.create = jest.fn().mockResolvedValue({});

    const req = mkReq({ username: 'alice', authKeyHash: fakeUser.__authKey }); const res = mkRes();
    await authController.login(req, res);

    expect(res._body).toHaveProperty('accessToken');
    expect(res._cookies['refreshToken']).toBeDefined();
    expect(res._cookies['refreshToken'].opts.httpOnly).toBe(true);
    expect(res._cookies['refreshToken'].opts.sameSite).toBe('strict');
  });

  test('response user không chứa authKeyHash hay recoveryKeyHash', async () => {
    const fakeUser = await makeFakeUser({ username: 'alice', _id: { toString: () => 'uid002' } });
    User.findOne.mockResolvedValue(fakeUser);
    RefreshToken.create = jest.fn().mockResolvedValue({});

    const req = mkReq({ username: 'alice', authKeyHash: fakeUser.__authKey }); const res = mkRes();
    await authController.login(req, res);

    expect(res._body.user).not.toHaveProperty('authKeyHash');
    expect(res._body.user).not.toHaveProperty('recoveryKeyHash');
  });

  test('response user có encryptedPrivateKey (blob)', async () => {
    const fakeUser = await makeFakeUser({ username: 'alice', _id: { toString: () => 'uid003' } });
    User.findOne.mockResolvedValue(fakeUser);
    RefreshToken.create = jest.fn().mockResolvedValue({});

    const req = mkReq({ username: 'alice', authKeyHash: fakeUser.__authKey }); const res = mkRes();
    await authController.login(req, res);

    expect(res._body.user).toHaveProperty('encryptedPrivateKey');
    expect(res._body.user).toHaveProperty('iv');
    expect(res._body.user).toHaveProperty('encryptedSigningPrivateKey');
  });

  test('sai authKeyHash → 401 (unified error)', async () => {
    const fakeUser = await makeFakeUser({ username: 'alice', _id: { toString: () => 'uid004' } });
    User.findOne.mockResolvedValue(fakeUser);

    const req = mkReq({ username: 'alice', authKeyHash: 'wrongKey==' }); const res = mkRes();
    await authController.login(req, res);

    expect(res._status).toBe(401);
  });

  test('username không tồn tại → 401 (unified error, chống enumeration)', async () => {
    User.findOne.mockResolvedValue(null);
    const req = mkReq({ username: 'ghost', authKeyHash: DEFAULT_AUTH_KEY }); const res = mkRes();
    await authController.login(req, res);

    expect(res._status).toBe(401);
  });

  test('refreshToken được lưu dưới dạng SHA-256 hash (không phải plaintext)', async () => {
    const fakeUser = await makeFakeUser({ username: 'alice', _id: { toString: () => 'uid005' } });
    User.findOne.mockResolvedValue(fakeUser);
    let createdData = null;
    RefreshToken.create = jest.fn().mockImplementation((data) => { createdData = data; return data; });

    const req = mkReq({ username: 'alice', authKeyHash: fakeUser.__authKey }); const res = mkRes();
    await authController.login(req, res);

    // cookie plainToken ≠ tokenHash stored in DB
    const cookiePlain = res._cookies['refreshToken'].val;
    expect(createdData.tokenHash).not.toBe(cookiePlain);
    expect(createdData.tokenHash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('authController.refreshToken()', () => {
  test('cookie hợp lệ → 200 + accessToken mới + rotation (new cookie)', async () => {
    const rt = makeFakeRefreshToken('uid006');
    const storedToken = { ...rt, revoked: false, expiresAt: new Date(Date.now() + 9999999), save: jest.fn().mockResolvedValue(true) };
    RefreshToken.findOne = jest.fn().mockResolvedValue(storedToken);
    RefreshToken.create  = jest.fn().mockResolvedValue({});
    User.findById = jest.fn().mockResolvedValue(await makeFakeUser({ username: 'bob', _id: { toString: () => 'uid006' } }));

    const req = mkReq({}, { refreshToken: rt.__plain }); const res = mkRes();
    await authController.refreshToken(req, res);

    expect(res._body).toHaveProperty('accessToken');
    // Rotation: old token revoked
    expect(storedToken.save).toHaveBeenCalled();
    expect(storedToken.revoked).toBe(true);
    // Rotation: new cookie issued
    expect(res._cookies['refreshToken']).toBeDefined();
  });

  test('token đã revoked → 401', async () => {
    RefreshToken.findOne = jest.fn().mockResolvedValue({ revoked: true });
    const req = mkReq({}, { refreshToken: 'sometoken' }); const res = mkRes();
    await authController.refreshToken(req, res);

    expect(res._status).toBe(401);
  });

  test('token hết hạn → 401', async () => {
    RefreshToken.findOne = jest.fn().mockResolvedValue({
      revoked: false, expiresAt: new Date(Date.now() - 1000)
    });
    const req = mkReq({}, { refreshToken: 'sometoken' }); const res = mkRes();
    await authController.refreshToken(req, res);

    expect(res._status).toBe(401);
  });

  test('không có cookie → 401', async () => {
    const req = mkReq({}, {}); const res = mkRes();
    await authController.refreshToken(req, res);

    expect(res._status).toBe(401);
  });

  test('token không tồn tại trong DB → 401', async () => {
    RefreshToken.findOne = jest.fn().mockResolvedValue(null);
    const req = mkReq({}, { refreshToken: 'unknowntoken' }); const res = mkRes();
    await authController.refreshToken(req, res);

    expect(res._status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('authController.logout()', () => {
  test('logout → token bị revoked, cookie bị clear', async () => {
    RefreshToken.findOneAndUpdate = jest.fn().mockResolvedValue({});
    const req = mkReq({}, { refreshToken: 'validtoken' }); const res = mkRes();
    await authController.logout(req, res);

    expect(RefreshToken.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ tokenHash: expect.any(String) }),
      { revoked: true }
    );
    expect(res._cookies['refreshToken']).toBeNull();
    expect(res._body).toHaveProperty('message');
  });

  test('logout không có cookie → vẫn 200 (graceful)', async () => {
    RefreshToken.findOneAndUpdate = jest.fn();
    const req = mkReq({}, {}); const res = mkRes();
    await authController.logout(req, res);

    expect(res._body).toHaveProperty('message');
    expect(res._status).toBeNull(); // không set explicit status → 200 mặc định
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('authController.verifyRecoveryKey()', () => {
  test('recovery key đúng → 200 + trả encrypted blobs, không trả private key raw', async () => {
    const fakeUser = await makeFakeUser({ username: 'carol' });
    User.findOne.mockResolvedValue(fakeUser);

    const req = mkReq({ username: 'carol', recoveryKey: fakeUser.__recovKey }); const res = mkRes();
    await authController.verifyRecoveryKey(req, res);

    expect(res._body).toHaveProperty('encryptedPrivateKeyByRecovery');
    expect(res._body).toHaveProperty('recoveryIv');
    // Không tiết lộ key thô
    expect(res._body).not.toHaveProperty('authKeyHash');
    expect(res._body).not.toHaveProperty('salt');
    expect(res._body).not.toHaveProperty('privateKey');
  });

  test('recovery key sai → 400', async () => {
    const fakeUser = await makeFakeUser({ username: 'carol' });
    User.findOne.mockResolvedValue(fakeUser);

    const req = mkReq({ username: 'carol', recoveryKey: 'FFFFFFFF-FFFFFFFF-FFFFFFFF-FFFFFFFF-FFFFFFFF-FFFFFFFF-FFFFFFFF-FFFFFFFF' });
    const res = mkRes();
    await authController.verifyRecoveryKey(req, res);

    expect(res._status).toBe(400);
  });

  test('username không tồn tại → 404', async () => {
    User.findOne.mockResolvedValue(null);
    const req = mkReq({ username: 'nobody', recoveryKey: DEFAULT_RECOV_KEY }); const res = mkRes();
    await authController.verifyRecoveryKey(req, res);

    expect(res._status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('authController.resetPassword()', () => {
  const newCreds = {
    newSalt: 'bmV3U2FsdA==', newAuthKeyHash: 'bmV3QXV0aEtleQ==',
    newEncryptedPrivateKey: 'bmV3RW5j==', newIv: 'bmV3SXY=',
    newEncryptedSigningPrivateKey: 'bmV3U2ln==', newSigningIv: 'bmV3U2ln==',
  };

  test('reset thành công → DB cập nhật salt và keys mới', async () => {
    const fakeUser = await makeFakeUser({ username: 'dave', _id: { toString: () => 'uid_dave' } });
    User.findOne.mockResolvedValue(fakeUser);
    User.findByIdAndUpdate = jest.fn().mockResolvedValue({});
    RefreshToken.updateMany = jest.fn().mockResolvedValue({ modifiedCount: 2 });

    const req = mkReq({ username: 'dave', recoveryKey: fakeUser.__recovKey, ...newCreds });
    const res = mkRes();
    await authController.resetPassword(req, res);

    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      fakeUser._id,
      expect.objectContaining({ salt: newCreds.newSalt, iv: newCreds.newIv })
    );
    expect(res._body).toHaveProperty('message');
  });

  test('sau reset → TẤT CẢ refresh token bị revoked (session invalidation)', async () => {
    const fakeUser = await makeFakeUser({ username: 'dave2', _id: { toString: () => 'uid_dave2' } });
    User.findOne.mockResolvedValue(fakeUser);
    User.findByIdAndUpdate = jest.fn().mockResolvedValue({});
    const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 3 });
    RefreshToken.updateMany = updateMany;

    const req = mkReq({ username: 'dave2', recoveryKey: fakeUser.__recovKey, ...newCreds });
    const res = mkRes();
    await authController.resetPassword(req, res);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ userId: fakeUser._id, revoked: false }),
      { revoked: true }
    );
  });

  test('recovery key sai → 400, User.findByIdAndUpdate không được gọi', async () => {
    const fakeUser = await makeFakeUser({ username: 'dave3' });
    User.findOne.mockResolvedValue(fakeUser);
    User.findByIdAndUpdate = jest.fn();

    const req = mkReq({ username: 'dave3', recoveryKey: 'WRONG-KEY-DATA', ...newCreds });
    const res = mkRes();
    await authController.resetPassword(req, res);

    expect(res._status).toBe(400);
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});
