// src/middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');

// ── Giới hạn chung cho tất cả API ──
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 100,
    message: { message: 'Quá nhiều yêu cầu từ IP này, vui lòng thử lại sau 15 phút.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ── Giới hạn nghiêm cho đăng nhập (chống brute-force) ──
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    skipSuccessfulRequests: true, // Không đếm login thành công
    message: { message: 'Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau 15 phút.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ── Giới hạn đăng ký (chống spam tài khoản) ──
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 giờ
    max: 5,
    message: { message: 'Quá nhiều tài khoản được tạo từ IP này. Vui lòng thử lại sau 1 giờ.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ── Giới hạn rất nghiêm cho reset password (chống dò recovery key) ──
const resetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 giờ
    max: 3,
    message: { message: 'Quá nhiều yêu cầu đặt lại mật khẩu. Vui lòng thử lại sau 1 giờ.' },
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = { apiLimiter, authLimiter, registerLimiter, resetLimiter };