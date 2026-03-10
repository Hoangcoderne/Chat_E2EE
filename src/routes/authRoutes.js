// src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Đăng ký
router.post('/register', authController.register);

// Lấy Salt (Đổi thành GET cho đúng chuẩn RESTful)
router.get('/salt', authController.getSalt);

// Đăng nhập
router.post('/login', authController.login);

module.exports = router;