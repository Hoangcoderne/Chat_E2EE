// src/middleware/validators/groupValidators.js
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('./common');

const validateGroupId = param('groupId')
    .isMongoId().withMessage('groupId không hợp lệ');

const validateMemberId = body('userId')
    .notEmpty().withMessage('Thiếu userId')
    .isMongoId().withMessage('userId không hợp lệ');

/** POST /api/groups/create */
const createGroupValidation = [
    body('name')
        .trim()
        .notEmpty().withMessage('Tên nhóm không được trống')
        .isLength({ max: 50 }).withMessage('Tên nhóm tối đa 50 ký tự'),
    body('members')
        .isArray({ min: 2 }).withMessage('Nhóm cần ít nhất 2 thành viên'),
    body('members.*.userId')
        .isMongoId().withMessage('userId thành viên không hợp lệ'),
    body('members.*.encryptedGroupKey')
        .notEmpty().withMessage('Thiếu encryptedGroupKey'),
    body('members.*.keyIv')
        .notEmpty().withMessage('Thiếu keyIv'),
    handleValidationErrors,
];

/** POST /api/groups/:groupId/add-member */
const addMemberValidation = [
    validateGroupId,
    validateMemberId,
    body('encryptedGroupKey').notEmpty().withMessage('Thiếu encryptedGroupKey'),
    body('keyIv').notEmpty().withMessage('Thiếu keyIv'),
    handleValidationErrors,
];

/** POST /api/groups/:groupId/remove-member */
const removeMemberValidation = [
    validateGroupId,
    validateMemberId,
    handleValidationErrors,
];

/** POST /api/groups/message/delete */
const deleteGroupMessageValidation = [
    body('messageId')
        .notEmpty().withMessage('Thiếu messageId')
        .isMongoId().withMessage('messageId không hợp lệ'),
    handleValidationErrors,
];

/** POST /api/groups/message/reaction */
const groupReactionValidation = [
    body('messageId')
        .notEmpty().withMessage('Thiếu messageId')
        .isMongoId().withMessage('messageId không hợp lệ'),
    body('emoji')
        .notEmpty().withMessage('Thiếu emoji')
        .isIn(['👍','❤️','😂','😮','😢','😡']).withMessage('Emoji không hợp lệ'),
    handleValidationErrors,
];

module.exports = {
    createGroupValidation,
    addMemberValidation,
    removeMemberValidation,
    deleteGroupMessageValidation,
    groupReactionValidation,
};