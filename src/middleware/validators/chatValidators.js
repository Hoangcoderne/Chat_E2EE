// src/middleware/validators/chatValidators.js
// Validators cho /api/chat/* và /api/groups/* endpoints.

const { body, param } = require('express-validator');
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

/** POST /api/chat/message/delete */
const messageIdValidation = [
    body('messageId')
        .notEmpty().withMessage('Thiếu messageId')
        .isMongoId().withMessage('messageId không hợp lệ'),
    handleValidationErrors,
];

/** POST /api/chat/message/reaction */
const reactionValidation = [
    body('messageId')
        .notEmpty().withMessage('Thiếu messageId')
        .isMongoId().withMessage('messageId không hợp lệ'),
    body('emoji')
        .notEmpty().withMessage('Thiếu emoji')
        .isIn(['👍', '❤️', '😂', '😮', '😢', '😡']).withMessage('Emoji không hợp lệ'),
    handleValidationErrors,
];

/** GET /api/chat/history/:partnerId */
const partnerIdValidation = [
    param('partnerId').isMongoId().withMessage('partnerId không hợp lệ'),
    handleValidationErrors,
];

module.exports = {
    validateTargetId,
    targetIdValidation,
    messageIdValidation,
    reactionValidation,
    partnerIdValidation,
};