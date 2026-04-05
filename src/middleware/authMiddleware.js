// src/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
    const token = req.headers['authorization'] || req.headers['x-access-token'];

    if (!token) {
        return res.status(401).json({ message: "Truy cập bị từ chối. Vui lòng đăng nhập." });
    }

    try {
        const tokenString = token.startsWith('Bearer ') ? token.slice(7) : token;
        const decoded = jwt.verify(tokenString, process.env.SESSION_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        // TokenExpiredError → 401 với code 'TOKEN_EXPIRED' → client tự động refresh
        // JsonWebTokenError  → 401 với code 'TOKEN_INVALID' → client logout luôn
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                message: "Access token hết hạn.",
                code: 'TOKEN_EXPIRED'  // Client dùng code này để biết cần refresh
            });
        }
        return res.status(401).json({ 
            message: "Token không hợp lệ.",
            code: 'TOKEN_INVALID'
        });
    }
};