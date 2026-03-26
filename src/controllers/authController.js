// src/controllers/authController.js
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken'); // [MỚI]
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto'); // [MỚI] để tạo random refresh token

// 1. ĐĂNG KÝ (Giữ nguyên logic của bạn)
exports.register = async (req, res) => {
    try {
        const { username, salt, authKeyHash, publicKey, encryptedPrivateKey, iv,
                signingPublicKey, encryptedSigningPrivateKey, signingIv,
                recoveryKeyPlain,
                encryptedPrivateKeyByRecovery, recoveryIv,
                encryptedSigningPrivateKeyByRecovery, recoverySigningIv } = req.body;

        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ message: 'Username đã tồn tại' });
        }

        const serverAuthHash = await bcrypt.hash(authKeyHash, 10);

        // [MỚI] Hash recovery key để lưu server — dùng để verify khi reset password
        const recoveryKeyHash = await bcrypt.hash(recoveryKeyPlain, 10);

        const newUser = new User({
            username,
            salt,
            authKeyHash: serverAuthHash,
            publicKey,
            encryptedPrivateKey,
            iv,
            signingPublicKey,
            encryptedSigningPrivateKey,
            signingIv,
            // [MỚI] Recovery fields
            recoveryKeyHash,
            encryptedPrivateKeyByRecovery,
            recoveryIv,
            encryptedSigningPrivateKeyByRecovery,
            recoverySigningIv
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

        // [SỬA] Access Token — ngắn hạn 15 phút
        const accessToken = jwt.sign(
            { userId: user._id, username: user.username },
            process.env.SESSION_SECRET,
            { expiresIn: '15m' }
        );

        // [MỚI] Refresh Token — dài hạn 24 giờ
        // Tạo random 64 bytes làm token plaintext
        const refreshTokenPlain = crypto.randomBytes(64).toString('hex');
        // Hash trước khi lưu DB — không lưu plaintext
        const refreshTokenHash = crypto
            .createHash('sha256')
            .update(refreshTokenPlain)
            .digest('hex');

        // Lưu refresh token vào DB
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 giờ
        await RefreshToken.create({
            userId: user._id,
            tokenHash: refreshTokenHash,
            expiresAt,
            revoked: false
        });

        res.json({
            message: "Đăng nhập thành công",
            accessToken,           // [SỬA] đổi tên từ token → accessToken
            refreshToken: refreshTokenPlain, // [MỚI] gửi plaintext về client
            user: {
                userId: user._id,
                username: user.username,
                publicKey: user.publicKey,
                encryptedPrivateKey: user.encryptedPrivateKey,
                iv: user.iv,
                signingPublicKey: user.signingPublicKey,
                encryptedSigningPrivateKey: user.encryptedSigningPrivateKey,
                signingIv: user.signingIv
            }
        });

    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ message: "Lỗi đăng nhập" });
    }
};
// ============================================================
// RESET PASSWORD (Quên mật khẩu bằng Recovery Key)
// Flow:
//   1. Client gửi username + recoveryKey + newPassword
//   2. Server verify recoveryKey bằng bcrypt
//   3. Server trả về recovery-encrypted key bundle
//   4. Client giải mã bằng recoveryKey → re-encrypt bằng newPassword
//   5. Client gửi lại key bundle mới + salt mới + authKey mới
// ============================================================

// BƯỚC 1+2: Verify recovery key, trả về encrypted bundle
exports.verifyRecoveryKey = async (req, res) => {
    try {
        const { username, recoveryKey } = req.body;
        if (!username || !recoveryKey) {
            return res.status(400).json({ message: "Thiếu thông tin" });
        }

        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ message: "Tài khoản không tồn tại" });

        // Verify recovery key
        const isValid = await bcrypt.compare(recoveryKey.trim(), user.recoveryKeyHash);
        if (!isValid) {
            return res.status(400).json({ message: "Recovery Key không đúng" });
        }

        // Trả về recovery-encrypted key bundle để client giải mã
        res.json({
            encryptedPrivateKeyByRecovery: user.encryptedPrivateKeyByRecovery,
            recoveryIv: user.recoveryIv,
            encryptedSigningPrivateKeyByRecovery: user.encryptedSigningPrivateKeyByRecovery,
            recoverySigningIv: user.recoverySigningIv,
        });
    } catch (err) {
        console.error("Verify Recovery Error:", err);
        res.status(500).json({ message: "Lỗi server" });
    }
};

// BƯỚC 5: Nhận key bundle mới đã re-encrypt bằng password mới
exports.resetPassword = async (req, res) => {
    try {
        const {
            username, recoveryKey,
            newSalt, newAuthKeyHash,
            newEncryptedPrivateKey, newIv,
            newEncryptedSigningPrivateKey, newSigningIv
        } = req.body;

        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ message: "Tài khoản không tồn tại" });

        // Verify lại recovery key lần 2 để tránh request giả mạo
        const isValid = await bcrypt.compare(recoveryKey.trim(), user.recoveryKeyHash);
        if (!isValid) {
            return res.status(400).json({ message: "Recovery Key không đúng" });
        }

        // Hash newAuthKey
        const newServerAuthHash = await bcrypt.hash(newAuthKeyHash, 10);

        // Cập nhật user: salt mới, authHash mới, encrypted keys mới
        await User.findByIdAndUpdate(user._id, {
            salt: newSalt,
            authKeyHash: newServerAuthHash,
            encryptedPrivateKey: newEncryptedPrivateKey,
            iv: newIv,
            encryptedSigningPrivateKey: newEncryptedSigningPrivateKey,
            signingIv: newSigningIv,
            // Recovery key và public keys giữ nguyên — private key không đổi, chỉ đổi lớp mã hóa
        });

        res.json({ message: "Đặt lại mật khẩu thành công!" });
    } catch (err) {
        console.error("Reset Password Error:", err);
        res.status(500).json({ message: "Lỗi server" });
    }
};

// ============================================================
// REFRESH TOKEN — Cấp Access Token mới
// Client gửi: { refreshToken: "..." }
// Server:
//   1. Hash token → tìm trong DB
//   2. Kiểm tra chưa hết hạn, chưa bị revoke
//   3. Cấp access token mới 15 phút
// ============================================================
exports.refreshToken = async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(401).json({ message: "Thiếu refresh token" });
        }

        // Hash token nhận được rồi tìm trong DB
        const tokenHash = crypto
            .createHash('sha256')
            .update(refreshToken)
            .digest('hex');

        const storedToken = await RefreshToken.findOne({ tokenHash });

        if (!storedToken) {
            return res.status(401).json({ message: "Refresh token không hợp lệ" });
        }
        if (storedToken.revoked) {
            return res.status(401).json({ message: "Refresh token đã bị thu hồi" });
        }
        if (storedToken.expiresAt < new Date()) {
            return res.status(401).json({ message: "Refresh token đã hết hạn" });
        }

        // Cấp access token mới — 15 phút
        const user = await require('../models/User').findById(storedToken.userId);
        if (!user) {
            return res.status(401).json({ message: "Người dùng không tồn tại" });
        }

        const newAccessToken = jwt.sign(
            { userId: user._id, username: user.username },
            process.env.SESSION_SECRET,
            { expiresIn: '15m' }
        );

        res.json({ accessToken: newAccessToken });

    } catch (err) {
        console.error("Refresh Token Error:", err);
        res.status(500).json({ message: "Lỗi server" });
    }
};

// ============================================================
// LOGOUT — Thu hồi Refresh Token
// Client gửi: { refreshToken: "..." }
// Server đánh dấu revoked: true trong DB
// ============================================================
exports.logout = async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(200).json({ message: "Đã đăng xuất" });
        }

        const tokenHash = crypto
            .createHash('sha256')
            .update(refreshToken)
            .digest('hex');

        // Đánh dấu revoked thay vì xóa — để audit log
        await RefreshToken.findOneAndUpdate(
            { tokenHash },
            { revoked: true }
        );

        res.json({ message: "Đã đăng xuất thành công" });

    } catch (err) {
        console.error("Logout Error:", err);
        res.status(500).json({ message: "Lỗi server" });
    }
};