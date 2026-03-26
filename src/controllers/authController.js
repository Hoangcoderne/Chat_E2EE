// src/controllers/authController.js
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// ============================================================
// HELPER: Tạo & lưu Refresh Token, set HttpOnly Cookie
// ============================================================
async function issueRefreshToken(res, userId) {
    const refreshTokenPlain = crypto.randomBytes(64).toString('hex');
    const refreshTokenHash = crypto
        .createHash('sha256')
        .update(refreshTokenPlain)
        .digest('hex');

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 giờ
    await RefreshToken.create({
        userId,
        tokenHash: refreshTokenHash,
        expiresAt,
        revoked: false
    });

    // [FIX #5] Lưu vào HttpOnly Cookie thay vì trả về body
    // JS phía client KHÔNG thể đọc cookie này → chống XSS
    res.cookie('refreshToken', refreshTokenPlain, {
        httpOnly: true,                                     // Không cho JS đọc
        secure: process.env.NODE_ENV === 'production',     // Chỉ HTTPS khi production
        sameSite: 'strict',                                 // Chống CSRF
        maxAge: 24 * 60 * 60 * 1000                        // 24 giờ (ms)
    });
}

// ============================================================
// 1. ĐĂNG KÝ
// ============================================================
exports.register = async (req, res) => {
    try {
        const {
            username, salt, authKeyHash, publicKey, encryptedPrivateKey, iv,
            signingPublicKey, encryptedSigningPrivateKey, signingIv,
            recoveryKeyPlain,
            encryptedPrivateKeyByRecovery, recoveryIv,
            encryptedSigningPrivateKeyByRecovery, recoverySigningIv
        } = req.body;

        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ message: 'Username đã tồn tại' });
        }

        const serverAuthHash = await bcrypt.hash(authKeyHash, 10);
        const recoveryKeyHash = await bcrypt.hash(recoveryKeyPlain, 10);

        const newUser = new User({
            username, salt,
            authKeyHash: serverAuthHash,
            publicKey, encryptedPrivateKey, iv,
            signingPublicKey, encryptedSigningPrivateKey, signingIv,
            recoveryKeyHash,
            encryptedPrivateKeyByRecovery, recoveryIv,
            encryptedSigningPrivateKeyByRecovery, recoverySigningIv
        });

        await newUser.save();
        res.status(201).json({ message: 'Đăng ký thành công!' });

    } catch (error) {
        console.error("Register Error:", error);
        res.status(500).json({ message: 'Lỗi server khi đăng ký' });
    }
};

// ============================================================
// 2. LẤY SALT
// ============================================================
exports.getSalt = async (req, res) => {
    try {
        const { username } = req.query;
        if (!username) return res.status(400).json({ message: "Thiếu username" });

        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ message: "Tài khoản không tồn tại" });

        res.json({ salt: user.salt });
    } catch (err) {
        console.error("Get Salt Error:", err);
        res.status(500).json({ message: "Lỗi Server" });
    }
};

// ============================================================
// 3. ĐĂNG NHẬP
// ============================================================
exports.login = async (req, res) => {
    try {
        const { username, authKeyHash } = req.body;

        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ message: "Tài khoản không tồn tại" });

        const isMatch = await bcrypt.compare(authKeyHash, user.authKeyHash);
        if (!isMatch) return res.status(400).json({ message: "Mật khẩu không đúng" });

        // Access Token ngắn hạn 15 phút
        const accessToken = jwt.sign(
            { userId: user._id, username: user.username },
            process.env.SESSION_SECRET,
            { expiresIn: '15m' }
        );

        // [FIX #5] Refresh Token → HttpOnly Cookie (không trả về body nữa)
        await issueRefreshToken(res, user._id);

        res.json({
            message: "Đăng nhập thành công",
            accessToken,
            // [FIX #5] Không còn refreshToken trong body
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
// VERIFY RECOVERY KEY (Quên mật khẩu bước 1)
// ============================================================
exports.verifyRecoveryKey = async (req, res) => {
    try {
        const { username, recoveryKey } = req.body;
        if (!username || !recoveryKey) {
            return res.status(400).json({ message: "Thiếu thông tin" });
        }

        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ message: "Tài khoản không tồn tại" });

        const isValid = await bcrypt.compare(recoveryKey.trim(), user.recoveryKeyHash);
        if (!isValid) return res.status(400).json({ message: "Recovery Key không đúng" });

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

// ============================================================
// RESET PASSWORD (Quên mật khẩu bước 2)
// ============================================================
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

        // Verify lại recovery key lần 2
        const isValid = await bcrypt.compare(recoveryKey.trim(), user.recoveryKeyHash);
        if (!isValid) return res.status(400).json({ message: "Recovery Key không đúng" });

        const newServerAuthHash = await bcrypt.hash(newAuthKeyHash, 10);

        await User.findByIdAndUpdate(user._id, {
            salt: newSalt,
            authKeyHash: newServerAuthHash,
            encryptedPrivateKey: newEncryptedPrivateKey,
            iv: newIv,
            encryptedSigningPrivateKey: newEncryptedSigningPrivateKey,
            signingIv: newSigningIv,
        });

        // [FIX #4] Thu hồi TẤT CẢ refresh token cũ sau khi đổi mật khẩu
        // Kẻ tấn công đang giữ session cũ sẽ bị đá ra ngay lập tức
        await RefreshToken.updateMany(
            { userId: user._id, revoked: false },
            { revoked: true }
        );

        res.json({ message: "Đặt lại mật khẩu thành công!" });
    } catch (err) {
        console.error("Reset Password Error:", err);
        res.status(500).json({ message: "Lỗi server" });
    }
};

// ============================================================
// REFRESH TOKEN — Cấp Access Token mới
// [FIX #5] Đọc từ HttpOnly Cookie thay vì req.body
// ============================================================
exports.refreshToken = async (req, res) => {
    try {
        // [FIX #5] Lấy từ cookie (browser tự gửi kèm)
        const refreshToken = req.cookies.refreshToken;
        if (!refreshToken) {
            return res.status(401).json({ message: "Thiếu refresh token" });
        }

        const tokenHash = crypto
            .createHash('sha256')
            .update(refreshToken)
            .digest('hex');

        const storedToken = await RefreshToken.findOne({ tokenHash });

        if (!storedToken) return res.status(401).json({ message: "Refresh token không hợp lệ" });
        if (storedToken.revoked) return res.status(401).json({ message: "Refresh token đã bị thu hồi" });
        if (storedToken.expiresAt < new Date()) return res.status(401).json({ message: "Refresh token đã hết hạn" });

        // [FIX #6] Dùng trực tiếp User đã require ở đầu file, không require lại bên trong
        const user = await User.findById(storedToken.userId);
        if (!user) return res.status(401).json({ message: "Người dùng không tồn tại" });

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
// [FIX #5] Đọc từ cookie và xóa cookie
// ============================================================
exports.logout = async (req, res) => {
    try {
        // [FIX #5] Lấy từ cookie
        const refreshToken = req.cookies.refreshToken;
        if (refreshToken) {
            const tokenHash = crypto
                .createHash('sha256')
                .update(refreshToken)
                .digest('hex');

            await RefreshToken.findOneAndUpdate(
                { tokenHash },
                { revoked: true }
            );
        }

        // [FIX #5] Xóa HttpOnly cookie
        res.clearCookie('refreshToken', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict'
        });

        res.json({ message: "Đã đăng xuất thành công" });

    } catch (err) {
        console.error("Logout Error:", err);
        res.status(500).json({ message: "Lỗi server" });
    }
};