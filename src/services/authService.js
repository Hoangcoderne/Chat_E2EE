// src/services/authService.js
// Business logic liên quan đến xác thực: phát hành/thu hồi tokens, xây dựng user payload.
// Controller chỉ điều phối — logic thực nằm ở đây.

const jwt          = require('jsonwebtoken');
const RefreshToken = require('../models/RefreshToken');
const { hashToken, generateRefreshToken, hashPassword } = require('../utils/crypto');

// Token TTLs
const ACCESS_TOKEN_TTL  = '15m';
const REFRESH_TOKEN_TTL = 24 * 60 * 60 * 1000; // 24 giờ tính bằng ms

/**
 * Tạo JWT access token ngắn hạn.
 * @param {{ userId: string, username: string }} payload
 * @returns {string} signed JWT
 */
function signAccessToken(payload) {
    return jwt.sign(
        { userId: payload.userId, username: payload.username },
        process.env.SESSION_SECRET,
        { expiresIn: ACCESS_TOKEN_TTL }
    );
}

/**
 * Tạo refresh token, lưu hash vào DB, set HttpOnly cookie trên response.
 * @param {import('express').Response} res
 * @param {string} userId
 */
async function issueRefreshToken(res, userId) {
    const plainToken  = generateRefreshToken();
    const tokenHash   = hashToken(plainToken);
    const expiresAt   = new Date(Date.now() + REFRESH_TOKEN_TTL);

    await RefreshToken.create({ userId, tokenHash, expiresAt, revoked: false });

    res.cookie('refreshToken', plainToken, {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge:   REFRESH_TOKEN_TTL,
    });
}

/**
 * Thu hồi tất cả refresh token đang active của một user.
 * Dùng sau khi reset mật khẩu hoặc logout toàn thiết bị.
 * @param {string} userId
 * @returns {{ modifiedCount: number }}
 */
async function revokeAllSessions(userId) {
    return RefreshToken.updateMany(
        { userId, revoked: false },
        { revoked: true }
    );
}

/**
 * Xây dựng user payload trả về client sau login / refresh.
 * Chỉ bao gồm các trường client cần để decrypt private key — KHÔNG bao gồm authKeyHash.
 * @param {import('../models/User').default} user
 */
function buildUserPayload(user) {
    return {
        userId:                     user._id,
        username:                   user.username,
        publicKey:                  user.publicKey,
        encryptedPrivateKey:        user.encryptedPrivateKey,
        iv:                         user.iv,
        signingPublicKey:           user.signingPublicKey,
        encryptedSigningPrivateKey: user.encryptedSigningPrivateKey,
        signingIv:                  user.signingIv,
    };
}

/**
 * Xây dựng encrypted key payload cho flow reset mật khẩu.
 * @param {import('../models/User').default} user
 */
function buildRecoveryPayload(user) {
    return {
        encryptedPrivateKeyByRecovery:        user.encryptedPrivateKeyByRecovery,
        recoveryIv:                           user.recoveryIv,
        encryptedSigningPrivateKeyByRecovery: user.encryptedSigningPrivateKeyByRecovery,
        recoverySigningIv:                    user.recoverySigningIv,
    };
}

module.exports = {
    signAccessToken,
    issueRefreshToken,
    revokeAllSessions,
    buildUserPayload,
    buildRecoveryPayload,
};
