// src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const {
    loginValidation,
    registerValidation,
    verifyRecoveryValidation,
    resetPasswordValidation,
} = require('../middleware/validators'); // Input validation

// Đăng ký — validate input trước khi xử lý
router.post('/register', registerValidation, authController.register);

// Lấy Salt — GET không cần validate body
router.get('/salt', authController.getSalt);

// Đăng nhập — validate username + authKeyHash
router.post('/login', loginValidation, authController.login);

// Cấp lại Access Token (cookie gửi kèm tự động)
router.post('/refresh', authController.refreshToken);

// Đăng xuất — thu hồi Refresh Token trong cookie
router.post('/logout', authController.logout);

// Verify Recovery Key (bước 1 reset password)
router.post('/verify-recovery', verifyRecoveryValidation, authController.verifyRecoveryKey);

// Reset Password (bước 2 reset password)
router.post('/reset-password', resetPasswordValidation, authController.resetPassword);

module.exports = router;