// src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// POST /api/auth/register
router.post('/register', authController.register);

// POST /api/auth/login-params (Lấy salt)
router.post('/login-params', authController.getLoginParams);

// POST /api/auth/login (Xác thực cuối cùng)
router.post('/login', authController.login);

module.exports = router;