// src/__tests__/helpers/fixtures.js
// Factory helpers tạo plain objects mẫu cho tests (không cần DB thật)

const jwt  = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const FAKE_KEYS = {
  publicKey:                            'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEFAKEPUBLICKEY==',
  encryptedPrivateKey:                  'encryptedPrivateKeyBase64==',
  iv:                                   'ivBase64==',
  signingPublicKey:                     'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEFAKESIGNINGKEY==',
  encryptedSigningPrivateKey:           'encryptedSigningPrivBase64==',
  signingIv:                            'signingIvBase64==',
  encryptedPrivateKeyByRecovery:        'encryptedByRecoveryBase64==',
  recoveryIv:                           'recoveryIvBase64==',
  encryptedSigningPrivateKeyByRecovery: 'encryptedSigningByRecovery==',
  recoverySigningIv:                    'recoverySigningIv==',
};

const DEFAULT_AUTH_KEY   = 'dGVzdEF1dGhLZXlIYXNoQmFzZTY0U3RyaW5nRm9yVGVzdA==';
const DEFAULT_RECOV_KEY  = 'AABB1122-CCDD3344-EEFF5566-77889900-AABB1122-CCDD3344-EEFF5566-77889900';

/**
 * Tạo plain user object mẫu (đã bcrypt hash authKey + recovKey).
 * Không insert vào DB — dùng trong mock return values.
 */
async function makeFakeUser(overrides = {}) {
  const authKey  = overrides.authKey  || DEFAULT_AUTH_KEY;
  const recovKey = overrides.recovKey || DEFAULT_RECOV_KEY;

  const authKeyHash    = await bcrypt.hash(authKey,  10);
  const recoveryKeyHash = await bcrypt.hash(recovKey, 10);
  const id = overrides._id || { toString: () => 'mock_user_id_' + Math.random().toString(36).slice(2, 8) };

  return {
    _id:         id,
    username:    overrides.username || 'testuser',
    salt:        overrides.salt     || 'c2FsdEJhc2U2NFN0cmluZw==',
    authKeyHash,
    recoveryKeyHash,
    ...FAKE_KEYS,
    notifications: [],
    ...overrides,
    // keep hashed values unless explicitly overridden
    authKeyHash,
    recoveryKeyHash,
    __authKey:  authKey,
    __recovKey: recovKey,
  };
}

/**
 * Tạo JWT access token cho mock user.
 */
function makeAccessToken(userId, username) {
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test_secret';
  return jwt.sign(
    { userId: userId.toString(), username },
    process.env.SESSION_SECRET,
    { expiresIn: '15m' }
  );
}

/**
 * Tạo plain refresh token object.
 */
function makeFakeRefreshToken(userId, overrides = {}) {
  const plain    = crypto.randomBytes(64).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(plain).digest('hex');
  return {
    _id:       { toString: () => 'rt_' + Math.random().toString(36).slice(2, 8) },
    userId,
    tokenHash,
    expiresAt: overrides.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000),
    revoked:   overrides.revoked   || false,
    __plain:   plain,
  };
}

module.exports = {
  makeFakeUser,
  makeAccessToken,
  makeFakeRefreshToken,
  FAKE_KEYS,
  DEFAULT_AUTH_KEY,
  DEFAULT_RECOV_KEY,
};
