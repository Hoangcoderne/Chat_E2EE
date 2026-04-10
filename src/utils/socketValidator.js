// src/utils/socketValidator.js
// Validation helper cho Socket.io event payloads.
// Ngăn chặn payload quá lớn, sai kiểu dữ liệu, hoặc chứa nội dung độc hại.

const mongoose = require('mongoose');

const MAX_ENCRYPTED_LENGTH = 65536; // 64KB max cho encrypted content
const MAX_STRING_LENGTH    = 1024;  // 1KB cho các string thường

/**
 * Validate payload của socket event.
 * @param {object} data - payload từ client
 * @param {object} schema - schema mô tả kiểu + ràng buộc
 * @returns {{ valid: boolean, error?: string }}
 *
 * Schema format: { fieldName: { type: 'string'|'mongoId'|'array', required?: boolean, maxLength?: number } }
 */
function validateSocketPayload(data, schema) {
    if (!data || typeof data !== 'object') {
        return { valid: false, error: 'Payload phải là object' };
    }

    for (const [field, rules] of Object.entries(schema)) {
        const value = data[field];

        // Required check
        if (rules.required && (value === undefined || value === null || value === '')) {
            return { valid: false, error: `Thiếu trường bắt buộc: ${field}` };
        }

        // Skip optional fields that are not present
        if (value === undefined || value === null) continue;

        // Type checks
        switch (rules.type) {
            case 'string':
                if (typeof value !== 'string') {
                    return { valid: false, error: `${field} phải là string` };
                }
                if (rules.maxLength && value.length > rules.maxLength) {
                    return { valid: false, error: `${field} quá dài (max ${rules.maxLength})` };
                }
                break;

            case 'mongoId':
                if (typeof value !== 'string' || !mongoose.Types.ObjectId.isValid(value)) {
                    return { valid: false, error: `${field} không phải MongoId hợp lệ` };
                }
                break;

            case 'array':
                if (!Array.isArray(value)) {
                    return { valid: false, error: `${field} phải là array` };
                }
                if (rules.maxLength && value.length > rules.maxLength) {
                    return { valid: false, error: `${field} có quá nhiều phần tử (max ${rules.maxLength})` };
                }
                break;

            case 'object':
                if (typeof value !== 'object' || Array.isArray(value)) {
                    return { valid: false, error: `${field} phải là object` };
                }
                break;
        }
    }

    return { valid: true };
}

// Pre-defined schemas cho các event phổ biến
const SCHEMAS = {
    send_message: {
        recipientId:      { type: 'mongoId', required: true },
        encryptedContent: { type: 'string',  required: true, maxLength: MAX_ENCRYPTED_LENGTH },
        iv:               { type: 'string',  required: true, maxLength: 64 },
        signature:        { type: 'string',  required: false, maxLength: MAX_STRING_LENGTH },
    },
    send_group_message: {
        groupId:          { type: 'mongoId', required: true },
        encryptedContent: { type: 'string',  required: true, maxLength: MAX_ENCRYPTED_LENGTH },
        iv:               { type: 'string',  required: true, maxLength: 64 },
        signature:        { type: 'string',  required: false, maxLength: MAX_STRING_LENGTH },
    },
    request_public_key: {
        username: { type: 'string', required: true, maxLength: 20 },
    },
    mark_read: {
        partnerId: { type: 'mongoId', required: true },
    },
    mark_group_read: {
        groupId: { type: 'mongoId', required: true },
    },
    join_groups: {
        _self: { type: 'array', maxLength: 100 },
    },
};

module.exports = { validateSocketPayload, SCHEMAS };
