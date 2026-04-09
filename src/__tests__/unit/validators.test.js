// src/__tests__/unit/validators.test.js
// Unit tests cho src/middleware/validators.js
// Test từng validation rule thông qua express request pipeline giả lập.

const express = require('express');
const request = require('supertest');
const {
  loginValidation,
  registerValidation,
  verifyRecoveryValidation,
  resetPasswordValidation,
} = require('../../middleware/validators');

// ── Helper: tạo mini Express app với validation chain ──────────────────
function makeApp(middlewares) {
  const app = express();
  app.use(express.json());
  app.post('/test', ...middlewares, (req, res) => res.json({ ok: true }));
  return app;
}

// ── Payload mẫu hợp lệ ────────────────────────────────────────────────
const validLogin = {
  username:    'alice_test',
  authKeyHash: 'dGVzdEF1dGhLZXlIYXNoQmFzZTY0U3RyaW5nRm9yVGVzdGluZw==',
};

const validRegister = {
  username:                             'alice_test',
  salt:                                 'c2FsdEJhc2U2NFN0cmluZw==',
  authKeyHash:                          'dGVzdEF1dGhLZXlIYXNoQmFzZTY0U3RyaW5nRm9yVGVzdGluZw==',
  publicKey:                            'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEpubkey==',
  encryptedPrivateKey:                  'encPrivKey==',
  iv:                                   'ivBase64==',
  signingPublicKey:                     'signingPubKey==',
  encryptedSigningPrivateKey:           'encSignPriv==',
  signingIv:                            'signingIvB==',
  recoveryKeyPlain:                     'AABBCCDD-EEFF0011-22334455-66778899-AABBCCDD-EEFF0011-22334455-66778899',
};

const validRecovery = {
  username:    'alice_test',
  recoveryKey: 'AABBCCDD-EEFF0011-22334455-66778899-AABBCCDD-EEFF0011-22334455-66778899',
};

const validReset = {
  username:                'alice_test',
  recoveryKey:             'AABBCCDD-EEFF0011-22334455-66778899-AABBCCDD-EEFF0011-22334455-66778899',
  newSalt:                 'bmV3U2FsdEJhc2U2NA==',
  newAuthKeyHash:          'bmV3QXV0aEtleUhhc2hCYXNlNjRTdHJpbmc=',
  newEncryptedPrivateKey:  'bmV3RW5jUHJpdktleQ==',
  newIv:                   'bmV3SXZCYXNLNDI=',
};

describe('src/middleware/validators.js', () => {

  // ══════════════════════════════════════════════════════
  // loginValidation
  // ══════════════════════════════════════════════════════
  describe('loginValidation', () => {
    const app = makeApp(loginValidation);

    test('payload hợp lệ → 200 ok', async () => {
      const res = await request(app).post('/test').send(validLogin);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    test('thiếu username → 400 VALIDATION_ERROR', async () => {
      const res = await request(app).post('/test').send({ authKeyHash: validLogin.authKeyHash });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    test('thiếu authKeyHash → 400', async () => {
      const res = await request(app).post('/test').send({ username: 'alice_test' });
      expect(res.status).toBe(400);
    });

    test('username có khoảng trắng → 400', async () => {
      const res = await request(app).post('/test').send({ ...validLogin, username: 'alice test' });
      expect(res.status).toBe(400);
    });

    test('username quá ngắn (< 3 ký tự) → 400', async () => {
      const res = await request(app).post('/test').send({ ...validLogin, username: 'ab' });
      expect(res.status).toBe(400);
    });

    test('username quá dài (> 20 ký tự) → 400', async () => {
      const res = await request(app).post('/test').send({ ...validLogin, username: 'a'.repeat(21) });
      expect(res.status).toBe(400);
    });

    test('username có ký tự không hợp lệ (dấu tiếng Việt) → 400', async () => {
      const res = await request(app).post('/test').send({ ...validLogin, username: 'nguyễn123' });
      expect(res.status).toBe(400);
    });

    test('username có ký tự hợp lệ (chữ, số, _, -) → 200', async () => {
      const res = await request(app).post('/test').send({ ...validLogin, username: 'user_name-01' });
      expect(res.status).toBe(200);
    });

    test('authKeyHash quá ngắn → 400', async () => {
      const res = await request(app).post('/test').send({ ...validLogin, authKeyHash: 'short' });
      expect(res.status).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════
  // registerValidation
  // ══════════════════════════════════════════════════════
  describe('registerValidation', () => {
    const app = makeApp(registerValidation);

    test('payload đầy đủ hợp lệ → 200', async () => {
      const res = await request(app).post('/test').send(validRegister);
      expect(res.status).toBe(200);
    });

    test('thiếu publicKey → 400', async () => {
      const { publicKey: _, ...body } = validRegister;
      const res = await request(app).post('/test').send(body);
      expect(res.status).toBe(400);
    });

    test('thiếu encryptedPrivateKey → 400', async () => {
      const { encryptedPrivateKey: _, ...body } = validRegister;
      const res = await request(app).post('/test').send(body);
      expect(res.status).toBe(400);
    });

    test('thiếu signingPublicKey → 400', async () => {
      const { signingPublicKey: _, ...body } = validRegister;
      const res = await request(app).post('/test').send(body);
      expect(res.status).toBe(400);
    });

    test('thiếu recoveryKeyPlain → 400', async () => {
      const { recoveryKeyPlain: _, ...body } = validRegister;
      const res = await request(app).post('/test').send(body);
      expect(res.status).toBe(400);
    });

    test('salt quá ngắn → 400', async () => {
      const res = await request(app).post('/test').send({ ...validRegister, salt: 'abc' });
      expect(res.status).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════
  // verifyRecoveryValidation
  // ══════════════════════════════════════════════════════
  describe('verifyRecoveryValidation', () => {
    const app = makeApp(verifyRecoveryValidation);

    test('recoveryKey đúng format 8 nhóm 8 hex → 200', async () => {
      const res = await request(app).post('/test').send(validRecovery);
      expect(res.status).toBe(200);
    });

    test('recoveryKey thiếu nhóm (7 nhóm) → 400', async () => {
      const res = await request(app).post('/test').send({
        ...validRecovery,
        recoveryKey: 'AABBCCDD-EEFF0011-22334455-66778899-AABBCCDD-EEFF0011-22334455',
      });
      expect(res.status).toBe(400);
    });

    test('recoveryKey có ký tự không phải hex → 400', async () => {
      const res = await request(app).post('/test').send({
        ...validRecovery,
        recoveryKey: 'ZZZZZZZZ-EEFF0011-22334455-66778899-AABBCCDD-EEFF0011-22334455-66778899',
      });
      expect(res.status).toBe(400);
    });

    test('recoveryKey lowercase được chấp nhận (sau trim + toUpperCase sẽ match)', async () => {
      const res = await request(app).post('/test').send({
        ...validRecovery,
        recoveryKey: 'aabbccdd-eeff0011-22334455-66778899-aabbccdd-eeff0011-22334455-66778899',
      });
      expect(res.status).toBe(200);
    });

    test('thiếu username → 400', async () => {
      const { username: _, ...body } = validRecovery;
      const res = await request(app).post('/test').send(body);
      expect(res.status).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════
  // resetPasswordValidation
  // ══════════════════════════════════════════════════════
  describe('resetPasswordValidation', () => {
    const app = makeApp(resetPasswordValidation);

    test('payload đầy đủ hợp lệ → 200', async () => {
      const res = await request(app).post('/test').send(validReset);
      expect(res.status).toBe(200);
    });

    test('thiếu newSalt → 400', async () => {
      const { newSalt: _, ...body } = validReset;
      const res = await request(app).post('/test').send(body);
      expect(res.status).toBe(400);
    });

    test('thiếu newAuthKeyHash → 400', async () => {
      const { newAuthKeyHash: _, ...body } = validReset;
      const res = await request(app).post('/test').send(body);
      expect(res.status).toBe(400);
    });

    test('thiếu newEncryptedPrivateKey → 400', async () => {
      const { newEncryptedPrivateKey: _, ...body } = validReset;
      const res = await request(app).post('/test').send(body);
      expect(res.status).toBe(400);
    });

    test('newSalt quá ngắn → 400', async () => {
      const res = await request(app).post('/test').send({ ...validReset, newSalt: 'abc' });
      expect(res.status).toBe(400);
    });

    test('newAuthKeyHash quá ngắn → 400', async () => {
      const res = await request(app).post('/test').send({ ...validReset, newAuthKeyHash: 'short' });
      expect(res.status).toBe(400);
    });
  });
});
