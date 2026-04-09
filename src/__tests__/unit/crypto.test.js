// src/__tests__/unit/crypto.test.js
// Unit tests cho src/utils/crypto.js
// Chạy hoàn toàn độc lập, không cần DB hay server.

const cryptoUtil = require('../../utils/crypto');

describe('src/utils/crypto.js', () => {

  // ══════════════════════════════════════════════════════
  // hashToken
  // ══════════════════════════════════════════════════════
  describe('hashToken()', () => {
    test('cùng input → cùng output (deterministic)', () => {
      const token = 'my-refresh-token-abc-123';
      expect(cryptoUtil.hashToken(token)).toBe(cryptoUtil.hashToken(token));
    });

    test('input khác → output khác', () => {
      expect(cryptoUtil.hashToken('tokenA')).not.toBe(cryptoUtil.hashToken('tokenB'));
    });

    test('output là chuỗi hex 64 ký tự (SHA-256)', () => {
      const hash = cryptoUtil.hashToken('any-token');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    test('input rỗng vẫn tạo ra hash hợp lệ', () => {
      const hash = cryptoUtil.hashToken('');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    test('hash không thể đảo ngược (không chứa nội dung gốc)', () => {
      const token = 'supersecrettoken';
      const hash  = cryptoUtil.hashToken(token);
      expect(hash).not.toContain(token);
    });
  });

  // ══════════════════════════════════════════════════════
  // generateRefreshToken
  // ══════════════════════════════════════════════════════
  describe('generateRefreshToken()', () => {
    test('tạo chuỗi hex 128 ký tự (64 bytes random)', () => {
      const token = cryptoUtil.generateRefreshToken();
      expect(token).toMatch(/^[a-f0-9]{128}$/);
    });

    test('mỗi lần gọi tạo token khác nhau (random)', () => {
      const t1 = cryptoUtil.generateRefreshToken();
      const t2 = cryptoUtil.generateRefreshToken();
      expect(t1).not.toBe(t2);
    });

    test('gọi 100 lần không có 2 token trùng nhau', () => {
      const tokens = new Set();
      for (let i = 0; i < 100; i++) {
        tokens.add(cryptoUtil.generateRefreshToken());
      }
      expect(tokens.size).toBe(100);
    });
  });

  // ══════════════════════════════════════════════════════
  // hashPassword (bcrypt)
  // ══════════════════════════════════════════════════════
  describe('hashPassword()', () => {
    test('output bắt đầu bằng $2 (bcrypt prefix)', async () => {
      const hash = await cryptoUtil.hashPassword('MyPassword123!');
      expect(hash.startsWith('$2')).toBe(true);
    });

    test('hash không giống plaintext', async () => {
      const pw   = 'MyPassword123!';
      const hash = await cryptoUtil.hashPassword(pw);
      expect(hash).not.toBe(pw);
    });

    test('cùng password → hash khác nhau (salt ngẫu nhiên mỗi lần)', async () => {
      const pw = 'SamePassword!1';
      const h1 = await cryptoUtil.hashPassword(pw);
      const h2 = await cryptoUtil.hashPassword(pw);
      expect(h1).not.toBe(h2);
    });

    test('hash authKeyHash (Base64 dài) thành công', async () => {
      const authKey = 'dGVzdEF1dGhLZXlCYXNlNjRTdHJpbmdGb3JUZXN0aW5nPT0=';
      const hash    = await cryptoUtil.hashPassword(authKey);
      expect(hash.startsWith('$2')).toBe(true);
    });

    test('hash chuỗi rỗng cũng trả về bcrypt hash hợp lệ', async () => {
      const hash = await cryptoUtil.hashPassword('');
      expect(hash.startsWith('$2')).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════
  // verifyPassword (bcrypt compare)
  // ══════════════════════════════════════════════════════
  describe('verifyPassword()', () => {
    test('đúng password → true', async () => {
      const pw   = 'CorrectPassword!9';
      const hash = await cryptoUtil.hashPassword(pw);
      expect(await cryptoUtil.verifyPassword(pw, hash)).toBe(true);
    });

    test('sai password → false', async () => {
      const hash = await cryptoUtil.hashPassword('CorrectPassword!9');
      expect(await cryptoUtil.verifyPassword('WrongPassword!9', hash)).toBe(false);
    });

    test('chuỗi rỗng vs hash không rỗng → false', async () => {
      const hash = await cryptoUtil.hashPassword('SomePassword!1');
      expect(await cryptoUtil.verifyPassword('', hash)).toBe(false);
    });

    test('password có unicode/ký tự đặc biệt → verify đúng', async () => {
      const pw   = 'P@ssw0rd!#$%^&*()';
      const hash = await cryptoUtil.hashPassword(pw);
      expect(await cryptoUtil.verifyPassword(pw, hash)).toBe(true);
    });

    test('hash khác nhau cho cùng password → cả 2 đều verify đúng', async () => {
      const pw = 'MultiHash!1A';
      const h1 = await cryptoUtil.hashPassword(pw);
      const h2 = await cryptoUtil.hashPassword(pw);
      expect(await cryptoUtil.verifyPassword(pw, h1)).toBe(true);
      expect(await cryptoUtil.verifyPassword(pw, h2)).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════
  // verifyTokenHash
  // ══════════════════════════════════════════════════════
  describe('verifyTokenHash()', () => {
    test('token đúng → true', () => {
      const token = 'valid-refresh-token-xyz';
      const hash  = cryptoUtil.hashToken(token);
      expect(cryptoUtil.verifyTokenHash(token, hash)).toBe(true);
    });

    test('token bị thay đổi 1 ký tự → false', () => {
      const hash = cryptoUtil.hashToken('original-token');
      expect(cryptoUtil.verifyTokenHash('original-tOken', hash)).toBe(false);
    });

    test('hash rỗng → false', () => {
      expect(cryptoUtil.verifyTokenHash('some-token', '')).toBe(false);
    });

    test('token rỗng vs hash của token rỗng → true', () => {
      const hash = cryptoUtil.hashToken('');
      expect(cryptoUtil.verifyTokenHash('', hash)).toBe(true);
    });

    test('hash của token A không khớp token B', () => {
      const hashA = cryptoUtil.hashToken('tokenA');
      expect(cryptoUtil.verifyTokenHash('tokenB', hashA)).toBe(false);
    });
  });
});
