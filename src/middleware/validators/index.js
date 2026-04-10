// src/middleware/validators/index.js
// Entry point cho toàn bộ validators — re-export từ các file theo domain.
// Import: const { loginValidation } = require('./middleware/validators');

const { handleValidationErrors } = require('./common');
const authValidators  = require('./authValidators');
const chatValidators  = require('./chatValidators');
const groupValidators = require('./groupValidators');

module.exports = {
    handleValidationErrors,
    ...authValidators,
    ...chatValidators,
    ...groupValidators,
};
