// src/models/RefreshToken.js
const mongoose = require('mongoose');

const RefreshTokenSchema = new mongoose.Schema({
    // Ai sở hữu token này
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    // Lưu HASH của token — không lưu plaintext
    tokenHash: {
        type: String,
        required: true
    },

    // Thời điểm hết hạn — 24 giờ
    expiresAt: {
        type: Date,
        required: true
    },

    // Đã bị thu hồi chưa (logout, đổi mật khẩu)
    revoked: {
        type: Boolean,
        default: false
    },

    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Index để tự động xóa token hết hạn khỏi DB
// MongoDB TTL index — tự động chạy cleanup
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RefreshToken', RefreshTokenSchema);