// src/middleware/validators/common.js
// Tiện ích validation dùng chung cho tất cả domains.

const { body, validationResult } = require('express-validator');

/**
 * Middleware kết thúc validation chain.
 * Nếu có lỗi → trả 400 VALIDATION_ERROR với danh sách field + message.
 */
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            code:   'VALIDATION_ERROR',
            errors: errors.array().map(err => ({
                field:   err.path,
                message: err.msg,
            })),
        });
    }
    next();
};

// Validators tái sử dụng giữa nhiều domain

/**
 * Username: 3–20 ký tự, chỉ chữ/số/gạch dưới/gạch ngang.
 * KHÔNG dùng .escape() — nó HTML-encode username gây lỗi so sánh.
 */
const validateUsername = body('username')
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage('Tên đăng nhập phải từ 3–20 ký tự')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Tên đăng nhập chỉ được chứa chữ cái, số, _ hoặc -');

/**
 * Recovery Key: 8 nhóm 8 ký tự hex, phân cách bằng dấu gạch ngang.
 * Ví dụ: AABB1122-CCDD3344-...
 */
const validateRecoveryKey = body('recoveryKey')
    .trim()
    .matches(/^[A-Fa-f0-9]{8}(-[A-Fa-f0-9]{8}){7}$/)
    .withMessage('Recovery Key không đúng định dạng (XXXXXXXX-XXXXXXXX-..., 8 nhóm)');

module.exports = { handleValidationErrors, validateUsername, validateRecoveryKey };
