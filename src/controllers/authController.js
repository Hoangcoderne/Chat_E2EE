// src/controllers/authController.js
const User = require('../models/User');
const bcrypt = require('bcryptjs');

// Xử lý Đăng ký
exports.register = async (req, res) => {
    try {
        const { username, salt, authKeyHash, publicKey, encryptedPrivateKey, iv } = req.body;

        // 1. Kiểm tra user tồn tại
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ message: 'Username đã tồn tại' });
        }

        // 2. Hash lại AuthKey một lần nữa trước khi lưu (Double Hashing)
        // Để đảm bảo ngay cả khi DB lộ, hacker không có AuthKey gốc để giả mạo login
        const serverAuthHash = await bcrypt.hash(authKeyHash, 10);

        // 3. Tạo User mới
        const newUser = new User({
            username,
            salt,
            authKeyHash: serverAuthHash, // Lưu hash của hash
            publicKey,
            encryptedPrivateKey,
            iv
        });

        await newUser.save();

        res.status(201).json({ message: 'Đăng ký thành công! Hãy đăng nhập.' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Xử lý Lấy thông tin Login (Bước 1 Login: Lấy Salt về để tính toán)
exports.getLoginParams = async (req, res) => {
    try {
        const { username } = req.body;
        const user = await User.findOne({ username });

        if (!user) {
            return res.status(404).json({ message: 'User không tồn tại' });
        }

        // Trả về Salt và Key Blob để Client tự xử lý giải mã
        res.json({
            salt: user.salt,
            encryptedPrivateKey: user.encryptedPrivateKey,
            iv: user.iv
        });

    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Xử lý Xác thực Login (Bước 2 Login: Verify AuthKey)
exports.login = async (req, res) => {
    try {
        const { username, authKeyHash } = req.body; // authKeyHash này là từ Client gửi lên
        
        const user = await User.findOne({ username });
        if (!user) return res.status(400).json({ message: 'User không tìm thấy' });

        // So sánh AuthKey Client gửi lên với Hash trong DB
        const isMatch = await bcrypt.compare(authKeyHash, user.authKeyHash);

        if (!isMatch) {
            return res.status(400).json({ message: 'Mật khẩu sai' });
        }

        // Login thành công -> Trả về ID và Public Key để client dùng
        res.json({
            message: 'Đăng nhập thành công',
            userId: user._id,
            username: user.username,
            publicKey: user.publicKey
        });

    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
};