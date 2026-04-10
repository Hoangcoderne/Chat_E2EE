// src/middleware/validators/authValidators.js
// Validators cho /api/auth/* endpoints.

const { body } = require('express-validator');
const { handleValidationErrors, validateUsername, validateRecoveryKey } = require('./common');

// Atomic validators

/**
 * authKeyHash: PBKDF2-derived Base64 key gửi thay cho password thật.
 * KHÔNG dùng .isBase64() vì window.btoa() dùng standard Base64 (+/=),
 * trong khi isBase64() chỉ chấp nhận URL-safe Base64.
 */
const validateAuthKeyHash = body('authKeyHash')
    .notEmpty().withMessage('Thiếu authKeyHash')
    .isString().withMessage('authKeyHash phải là chuỗi')
    .isLength({ min: 20, max: 600 }).withMessage('authKeyHash không hợp lệ');

/**
 * Salt: Base64 của 16 bytes ngẫu nhiên (~24 ký tự).
 */
const validateSalt = body('salt')
    .notEmpty().withMessage('Thiếu salt')
    .isString().withMessage('Salt phải là chuỗi')
    .isLength({ min: 10, max: 200 }).withMessage('Salt không hợp lệ');

// Validation chains cho từng route

/** POST /api/auth/login */
const loginValidation = [
    validateUsername,
    validateAuthKeyHash,
    handleValidationErrors,
];

/**
 * POST /api/auth/register
 * Không validate password trực tiếp (E2EE — client đã derive key từ password).
 * Chỉ validate các trường cần thiết để chống injection.
 */
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
    handleValidationErrors,
];

/** POST /api/auth/verify-recovery */
const verifyRecoveryValidation = [
    validateUsername,
    validateRecoveryKey,
    handleValidationErrors,
];

/** POST /api/auth/reset-password */
const resetPasswordValidation = [
    validateUsername,
    validateRecoveryKey,
    body('newSalt')
        .notEmpty().withMessage('Thiếu newSalt')
        .isString().isLength({ min: 10, max: 200 }).withMessage('newSalt không hợp lệ'),
    body('newAuthKeyHash')
        .notEmpty().withMessage('Thiếu newAuthKeyHash')
        .isString().isLength({ min: 20, max: 600 }).withMessage('newAuthKeyHash không hợp lệ'),
    body('newEncryptedPrivateKey').notEmpty().withMessage('Thiếu newEncryptedPrivateKey'),
    body('newIv').notEmpty().withMessage('Thiếu newIv'),
    handleValidationErrors,
];

module.exports = {
    loginValidation,
    registerValidation,
    verifyRecoveryValidation,
    resetPasswordValidation,
};
