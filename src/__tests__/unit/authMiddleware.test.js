// src/__tests__/unit/authMiddleware.test.js
// Unit tests cho src/middleware/authMiddleware.js
// Mock jwt để test các nhánh xử lý token.

const jwt = require('jsonwebtoken');
const authMiddleware = require('../../middleware/authMiddleware');

// Thiết lập biến môi trường bắt buộc
process.env.SESSION_SECRET = 'test_jwt_secret_for_unit_tests';

describe('src/middleware/authMiddleware.js', () => {

  let req, res, next;

  beforeEach(() => {
    req  = { headers: {} };
    res  = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    next = jest.fn();
    jest.restoreAllMocks();
  });

  // ── Không có token ──────────────────────────────────────────────────────
  describe('Không có Authorization header', () => {
    test('trả 401 khi không có header nào', () => {
      authMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.any(String) })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('trả 401 khi header authorization là chuỗi rỗng', () => {
      req.headers['authorization'] = '';
      authMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ── Token hợp lệ ────────────────────────────────────────────────────────
  describe('Token hợp lệ', () => {
    test('token hợp lệ → gọi next() và gán req.user', () => {
      const payload = { userId: 'user123', username: 'alice' };
      const token   = jwt.sign(payload, process.env.SESSION_SECRET, { expiresIn: '15m' });
      req.headers['authorization'] = `Bearer ${token}`;

      authMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toBeDefined();
      expect(req.user.userId).toBe('user123');
      expect(req.user.username).toBe('alice');
    });

    test('token không có prefix Bearer vẫn được xử lý', () => {
      const payload = { userId: 'user456', username: 'bob' };
      const token   = jwt.sign(payload, process.env.SESSION_SECRET, { expiresIn: '15m' });
      req.headers['authorization'] = token; // không có Bearer

      authMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user.userId).toBe('user456');
    });

    test('token qua header x-access-token cũng được chấp nhận', () => {
      const payload = { userId: 'user789', username: 'charlie' };
      const token   = jwt.sign(payload, process.env.SESSION_SECRET, { expiresIn: '15m' });
      req.headers['x-access-token'] = `Bearer ${token}`;

      authMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  // ── Token hết hạn ───────────────────────────────────────────────────────
  describe('Token hết hạn (TokenExpiredError)', () => {
    test('token hết hạn → 401 với code TOKEN_EXPIRED', () => {
      jest.spyOn(jwt, 'verify').mockImplementation(() => {
        const err  = new Error('jwt expired');
        err.name   = 'TokenExpiredError';
        throw err;
      });

      req.headers['authorization'] = 'Bearer expired.token.here';
      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'TOKEN_EXPIRED' })
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ── Token không hợp lệ ──────────────────────────────────────────────────
  describe('Token không hợp lệ (JsonWebTokenError)', () => {
    test('token giả mạo → 401 với code TOKEN_INVALID', () => {
      req.headers['authorization'] = 'Bearer this.is.a.fake.token';
      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'TOKEN_INVALID' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('token ký bằng secret khác → 401 TOKEN_INVALID', () => {
      const token = jwt.sign({ userId: 'x' }, 'wrong_secret', { expiresIn: '15m' });
      req.headers['authorization'] = `Bearer ${token}`;

      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'TOKEN_INVALID' })
      );
    });

    test('token bị cắt bớt → 401 TOKEN_INVALID', () => {
      const token = jwt.sign({ userId: 'y' }, process.env.SESSION_SECRET);
      req.headers['authorization'] = `Bearer ${token.slice(0, -10)}`; // cắt bớt

      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });
  });
});
