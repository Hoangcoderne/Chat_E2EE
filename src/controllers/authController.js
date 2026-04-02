// src/controllers/authController.js
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');                        
const { hashToken, generateRefreshToken, hashPassword, verifyPassword } = require('../utils/crypto'); 

// ============================================================
// HELPER: Tạo & lưu Refresh Token, set HttpOnly Cookie
// ============================================================
async function issueRefreshToken(res, userId) {
    const refreshTokenPlain = generateRefreshToken();
    const refreshTokenHash  = hashToken(refreshTokenPlain);

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await RefreshToken.create({ userId, tokenHash: refreshTokenHash, expiresAt, revoked: false });

    res.cookie('refreshToken', refreshTokenPlain, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000
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

        const serverAuthHash  = await hashPassword(authKeyHash);
        const recoveryKeyHash = await hashPassword(recoveryKeyPlain);

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

        logger.info({ event: 'register_success', username });
        res.status(201).json({ message: 'Đăng ký thành công!' });

    } catch (error) {
        // Log stack đầy đủ để debug
        logger.error({ event: 'register_error', error: error.message, stack: error.stack });

        // Mongoose ValidationError (required field thiếu hoặc sai format)
        if (error.name === 'ValidationError') {
            const fields = Object.keys(error.errors).join(', ');
            return res.status(400).json({ message: `Dữ liệu không hợp lệ: ${fields}` });
        }

        // MongoDB duplicate key (username đã tồn tại — race condition)
        if (error.code === 11000) {
            return res.status(400).json({ message: 'Username đã tồn tại' });
        }

        // Trong development → trả về lỗi thật để debug dễ hơn
        const isDev = process.env.NODE_ENV !== 'production';
        res.status(500).json({
            message: isDev ? `Lỗi server: ${error.message}` : 'Lỗi server khi đăng ký'
        });
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
        logger.error({ event: 'get_salt_error', error: err.message });
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
        if (!user) {
            logger.warn({ event: 'login_failed', reason: 'user_not_found', username });
            return res.status(404).json({ message: "Tài khoản không tồn tại" });
        }

        const isMatch = await verifyPassword(authKeyHash, user.authKeyHash);
        if (!isMatch) {
            logger.warn({ event: 'login_failed', reason: 'wrong_password', username });
            return res.status(400).json({ message: "Mật khẩu không đúng" });
        }

        const accessToken = jwt.sign(
            { userId: user._id, username: user.username },
            process.env.SESSION_SECRET,
            { expiresIn: '15m' }
        );

        await issueRefreshToken(res, user._id);

        logger.info({ event: 'login_success', userId: user._id, username });

        res.json({
            message: "Đăng nhập thành công",
            accessToken,
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
        logger.error({ event: 'login_error', error: err.message });
        res.status(500).json({ message: "Lỗi đăng nhập" });
    }
};

// ============================================================
// VERIFY RECOVERY KEY (Bước 1)
// ============================================================
exports.verifyRecoveryKey = async (req, res) => {
    try {
        const { username, recoveryKey } = req.body;

        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ message: "Tài khoản không tồn tại" });

        const isValid = await verifyPassword(recoveryKey.trim(), user.recoveryKeyHash);
        if (!isValid) {
            logger.warn({ event: 'recovery_verify_failed', username });
            return res.status(400).json({ message: "Recovery Key không đúng" });
        }

        logger.info({ event: 'recovery_verify_success', username });
        res.json({
            encryptedPrivateKeyByRecovery: user.encryptedPrivateKeyByRecovery,
            recoveryIv: user.recoveryIv,
            encryptedSigningPrivateKeyByRecovery: user.encryptedSigningPrivateKeyByRecovery,
            recoverySigningIv: user.recoverySigningIv,
        });
    } catch (err) {
        logger.error({ event: 'recovery_verify_error', error: err.message });
        res.status(500).json({ message: "Lỗi server" });
    }
};

// ============================================================
// RESET PASSWORD (Bước 2)
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
        const isValid = await verifyPassword(recoveryKey.trim(), user.recoveryKeyHash);
        if (!isValid) {
            logger.warn({ event: 'reset_password_failed', reason: 'wrong_recovery_key', username });
            return res.status(400).json({ message: "Recovery Key không đúng" });
        }

        const newServerAuthHash = await hashPassword(newAuthKeyHash);

        await User.findByIdAndUpdate(user._id, {
            salt: newSalt,
            authKeyHash: newServerAuthHash,
            encryptedPrivateKey: newEncryptedPrivateKey,
            iv: newIv,
            encryptedSigningPrivateKey: newEncryptedSigningPrivateKey,
            signingIv: newSigningIv,
        });

        // Thu hồi TẤT CẢ refresh token cũ — đá ra tất cả session đang hoạt động
        const revokedCount = await RefreshToken.updateMany(
            { userId: user._id, revoked: false },
            { revoked: true }
        );

        logger.info({
            event: 'reset_password_success',
            username,
            sessions_revoked: revokedCount.modifiedCount
        });

        res.json({ message: "Đặt lại mật khẩu thành công!" });
    } catch (err) {
        logger.error({ event: 'reset_password_error', error: err.message });
        res.status(500).json({ message: "Lỗi server" });
    }
};

// ============================================================
// REFRESH TOKEN
// ============================================================
exports.refreshToken = async (req, res) => {
    try {
        const refreshToken = req.cookies.refreshToken;
        if (!refreshToken) {
            return res.status(401).json({ message: "Thiếu refresh token" });
        }

        const storedToken = await RefreshToken.findOne({ tokenHash: hashToken(refreshToken) });

        if (!storedToken)              return res.status(401).json({ message: "Refresh token không hợp lệ" });
        if (storedToken.revoked)       return res.status(401).json({ message: "Refresh token đã bị thu hồi" });
        if (storedToken.expiresAt < new Date()) return res.status(401).json({ message: "Refresh token đã hết hạn" });

        const user = await User.findById(storedToken.userId);
        if (!user) return res.status(401).json({ message: "Người dùng không tồn tại" });

        const newAccessToken = jwt.sign(
            { userId: user._id, username: user.username },
            process.env.SESSION_SECRET,
            { expiresIn: '15m' }
        );

        logger.info({ event: 'token_refreshed', userId: user._id });
        res.json({ accessToken: newAccessToken });

    } catch (err) {
        logger.error({ event: 'refresh_token_error', error: err.message });
        res.status(500).json({ message: "Lỗi server" });
    }
};

// ============================================================
// LOGOUT
// ============================================================
exports.logout = async (req, res) => {
    try {
        const refreshToken = req.cookies.refreshToken;
        if (refreshToken) {
            await RefreshToken.findOneAndUpdate(
                { tokenHash: hashToken(refreshToken) },
                { revoked: true }
            );
        }

        res.clearCookie('refreshToken', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict'
        });

        logger.info({ event: 'logout_success', userId: req.user?.userId || 'unknown' });
        res.json({ message: "Đã đăng xuất thành công" });

    } catch (err) {
        logger.error({ event: 'logout_error', error: err.message });
        res.status(500).json({ message: "Lỗi server" });
    }
};