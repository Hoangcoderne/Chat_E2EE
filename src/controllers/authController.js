// src/controllers/authController.js
const User = require('../models/User');
const bcrypt = require('bcryptjs'); // Đảm bảo đã npm install bcryptjs
const jwt = require('jsonwebtoken');

// 1. ĐĂNG KÝ (Giữ nguyên logic của bạn)
exports.register = async (req, res) => {
    try {
        const { username, salt, authKeyHash, publicKey, encryptedPrivateKey, iv } = req.body;

        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ message: 'Username đã tồn tại' });
        }

        // Hash AuthKey lần 2 để bảo mật trên server
        const serverAuthHash = await bcrypt.hash(authKeyHash, 10);

        const newUser = new User({
            username,
            salt,
            authKeyHash: serverAuthHash,
            publicKey,
            encryptedPrivateKey,
            iv
        });

        await newUser.save();
        res.status(201).json({ message: 'Đăng ký thành công!' });

    } catch (error) {
        console.error("Register Error:", error);
        res.status(500).json({ message: 'Lỗi server khi đăng ký' });
    }
};

// 2. LẤY SALT (Bước chuẩn bị đăng nhập)
// Frontend gọi: GET /api/auth/salt?username=...
exports.getSalt = async (req, res) => {
    try {
        // [SỬA] Dùng req.query vì là GET method
        const { username } = req.query; 
        
        if (!username) return res.status(400).json({ message: "Thiếu username" });

        const user = await User.findOne({ username });
        if (!user) {
            // Đây là chỗ báo lỗi "User không tồn tại" bạn đang gặp
            return res.status(404).json({ message: "Tài khoản không tồn tại" });
        }

        // Trả về Salt
        res.json({ salt: user.salt });
    } catch (err) {
        console.error("Get Salt Error:", err);
        res.status(500).json({ message: "Lỗi Server" });
    }
};

// 3. ĐĂNG NHẬP (Xác thực & Cấp Token)
// Frontend gọi: POST /api/auth/login
exports.login = async (req, res) => {
    try {
        const { username, authKeyHash } = req.body;

        // Tìm user
        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ message: "Tài khoản không tồn tại" });

        // [SỬA QUAN TRỌNG] So sánh Hash từ Client với Hash trong DB
        // DB lưu dạng $2b$10$... nên PHẢI dùng bcrypt.compare
        const isMatch = await bcrypt.compare(authKeyHash, user.authKeyHash);

        if (!isMatch) {
            return res.status(400).json({ message: "Mật khẩu không đúng" });
        }

        // Tạo JWT Token
        const token = jwt.sign(
            { userId: user._id, username: user.username },
            process.env.SESSION_SECRET,
            { expiresIn: '24h' }
        );

        // Trả về Token + Key Bundle (để Client giải mã)
        res.json({
            message: "Đăng nhập thành công",
            token: token,
            user: {
                userId: user._id,
                username: user.username,
                publicKey: user.publicKey,
                encryptedPrivateKey: user.encryptedPrivateKey, // Blob khóa
                iv: user.iv
            }
        });

    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ message: "Lỗi đăng nhập" });
    }
};