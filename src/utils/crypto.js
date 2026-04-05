// src/utils/crypto.js
// Tách logic crypto ra utility riêng để dễ test và tái sử dụng
const crypto = require('crypto');
const bcrypt = require('bcryptjs');


// Hash token bằng SHA-256 để lưu DB (không lưu plaintext)
function hashToken(token) {
    return crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');
}


// Tạo refresh token ngẫu nhiên 64 bytes
function generateRefreshToken() {
    return crypto.randomBytes(64).toString('hex');
}


// Hash password/authKey bằng bcrypt
async function hashPassword(password) {
    return await bcrypt.hash(password, 10);
}


// So sánh password với bcrypt hash
async function verifyPassword(plain, hash) {
    return await bcrypt.compare(plain, hash);
}


// Kiểm tra token plaintext khớp với hash đã lưu
function verifyTokenHash(plainToken, storedHash) {
    return hashToken(plainToken) === storedHash;
}

module.exports = {
    hashToken,
    generateRefreshToken,
    hashPassword,
    verifyPassword,
    verifyTokenHash,
};
