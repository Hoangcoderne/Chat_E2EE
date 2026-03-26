// src/middleware/validators.js
const { body, validationResult } = require('express-validator');

// ── Middleware xử lý lỗi validation ──
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            code: 'VALIDATION_ERROR',
            errors: errors.array().map(err => ({
                field: err.path,
                message: err.msg
            }))
        });
    }
    next();
};

// ── Validators riêng lẻ ──

// Username: 3-20 ký tự, chỉ chữ/số/gạch dưới/gạch ngang
const validateUsername = body('username')
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage('Tên đăng nhập phải từ 3–20 ký tự')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Tên đăng nhập chỉ được chứa chữ cái, số, _ hoặc -')
    .escape();

// Password: tối thiểu 6 ký tự (giữ nguyên yêu cầu của dự án, không tăng lên để không breaking)
const validatePassword = body('password')
    .isLength({ min: 6 })
    .withMessage('Mật khẩu phải ít nhất 6 ký tự');

// AuthKeyHash: chuỗi Base64 do client gửi lên (không validate password trực tiếp vì E2EE)
// Client đã hash password trước khi gửi → chỉ cần kiểm tra tồn tại và độ dài hợp lý
const validateAuthKeyHash = body('authKeyHash')
    .notEmpty()
    .withMessage('Thiếu authKeyHash')
    .isLength({ min: 20, max: 500 })
    .withMessage('authKeyHash không hợp lệ');

// Salt: chuỗi Base64
const validateSalt = body('salt')
    .notEmpty()
    .withMessage('Thiếu salt')
    .isLength({ min: 10, max: 200 })
    .withMessage('Salt không hợp lệ');

// Recovery Key: định dạng HEX-HEX-HEX-HEX-HEX-HEX-HEX-HEX (8 nhóm 8 ký tự hex)
const validateRecoveryKey = body('recoveryKey')
    .trim()
    .matches(/^[A-Fa-f0-9]{8}(-[A-Fa-f0-9]{8}){7}$/)
    .withMessage('Recovery Key không đúng định dạng (XXXXXXXX-XXXXXXXX-..., 8 nhóm)');

// targetId: MongoDB ObjectId
const validateTargetId = body('targetId')
    .notEmpty()
    .withMessage('Thiếu targetId')
    .isMongoId()
    .withMessage('targetId không hợp lệ');

// ── Tập hợp validator cho từng route ──

// POST /api/auth/login
const loginValidation = [
    validateUsername,
    validateAuthKeyHash,
    handleValidationErrors
];

// POST /api/auth/register
// Lưu ý: không validate password trực tiếp vì E2EE — client đã derive key từ password
// Chỉ cần validate các trường thiết yếu để chống injection
const registerValidation = [
    validateUsername,
    validateSalt,
    validateAuthKeyHash,
    body('publicKey').notEmpty().withMessage('Thiếu publicKey'),
    body('encryptedPrivateKey').notEmpty().withMessage('Thiếu encryptedPrivateKey'),
    body('iv').notEmpty().withMessage('Thiếu iv'),
    body('signingPublicKey').notEmpty().withMessage('Thiếu signingPublicKey'),
    body('encryptedSigningPrivateKey').notEmpty().withMessage('Thiếu encryptedSigningPrivateKey'),
    body('signingIv').notEmpty().withMessage('Thiếu signingIv'),
    body('recoveryKeyPlain').notEmpty().withMessage('Thiếu recoveryKeyPlain'),
    handleValidationErrors
];

// POST /api/auth/verify-recovery
const verifyRecoveryValidation = [
    validateUsername,
    validateRecoveryKey,
    handleValidationErrors
];

// POST /api/auth/reset-password
const resetPasswordValidation = [
    validateUsername,
    validateRecoveryKey,
    validateSalt,
    validateAuthKeyHash,
    body('newEncryptedPrivateKey').notEmpty().withMessage('Thiếu newEncryptedPrivateKey'),
    body('newIv').notEmpty().withMessage('Thiếu newIv'),
    handleValidationErrors
];

// POST /api/chat/unfriend, /block, /unblock
const targetIdValidation = [
    validateTargetId,
    handleValidationErrors
];

module.exports = {
    handleValidationErrors,
    validateUsername,
    validateRecoveryKey,
    loginValidation,
    registerValidation,
    verifyRecoveryValidation,
    resetPasswordValidation,
    targetIdValidation,
};
