// src/middleware/validators/chatValidators.js
// Validators cho /api/chat/* và /api/groups/* endpoints.

const { body } = require('express-validator');
const { handleValidationErrors } = require('./common');

/** targetId: MongoDB ObjectId — dùng cho block, unblock, unfriend */
const validateTargetId = body('targetId')
    .notEmpty().withMessage('Thiếu targetId')
    .isMongoId().withMessage('targetId không hợp lệ');

/** POST /api/chat/unfriend, /block, /unblock */
const targetIdValidation = [
    validateTargetId,
    handleValidationErrors,
];

module.exports = { validateTargetId, targetIdValidation };
