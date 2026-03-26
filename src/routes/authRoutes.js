// src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Đăng ký
router.post('/register', authController.register);

// Lấy Salt
router.get('/salt', authController.getSalt);

// Đăng nhập — trả về accessToken (15m) + refreshToken (24h)
router.post('/login', authController.login);

// [MỚI] Cấp lại Access Token bằng Refresh Token
router.post('/refresh', authController.refreshToken);

// [MỚI] Đăng xuất — thu hồi Refresh Token
router.post('/logout', authController.logout);

// Verify Recovery Key (quên mật khẩu bước 1)
router.post('/verify-recovery', authController.verifyRecoveryKey);

// Reset Password (quên mật khẩu bước 2)
router.post('/reset-password', authController.resetPassword);

module.exports = router;