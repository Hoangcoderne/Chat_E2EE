// src/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
    // 1. Lấy token từ header (Bearer token) hoặc Session (tùy cách bạn lưu)
    // Ở đây giả sử bạn gửi kèm Header: "Authorization: Bearer <token>"
    // Hoặc nếu bạn lưu trong Session/Cookie thì sửa lại tương ứng.
    
    // Cách lấy thông dụng nhất (từ Header):
    const token = req.headers['authorization'] || req.headers['x-access-token'];

    // Nếu không có token
    if (!token) {
        return res.status(401).json({ message: "Truy cập bị từ chối. Vui lòng đăng nhập." });
    }

    try {
        // 2. Xác thực token (Cắt bỏ chữ "Bearer " nếu có)
        const tokenString = token.startsWith('Bearer ') ? token.slice(7, token.length) : token;
        
        const decoded = jwt.verify(tokenString, process.env.SESSION_SECRET);
        
        // 3. Lưu thông tin user vào req để controller dùng
        req.user = decoded; 
        next();
    } catch (err) {
        res.status(400).json({ message: "Token không hợp lệ." });
    }
};