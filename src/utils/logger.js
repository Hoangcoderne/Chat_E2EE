// src/utils/logger.js
const winston = require('winston');
const path    = require('path');
const fs      = require('fs');

// Tạo thư mục logs — dùng absolute path để tránh lỗi trên Render
// Nếu không tạo được → chỉ log ra console (không crash server)
const LOG_DIR     = path.join(process.cwd(), 'logs');
let fileTransports = [];

try {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    fileTransports = [
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'error.log'),
            level: 'error',
            maxsize: 5 * 1024 * 1024,
            maxFiles: 5,
        }),
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'combined.log'),
            maxsize: 5 * 1024 * 1024,
            maxFiles: 5,
        }),
    ];
} catch (e) {
    // Filesystem không cho phép tạo thư mục (Render read-only layer, etc.)
    // Fallback: chỉ dùng Console transport — không crash server
    console.warn('[Logger] Cannot create logs directory, using console only:', e.message);
}

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'chat-e2ee' },
    transports: [
        // Console transport luôn hoạt động
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, event, ...meta }) => {
                    const metaStr = Object.keys(meta).length
                        ? ' | ' + JSON.stringify(meta)
                        : '';
                    return `${timestamp} [${level}] ${event || message}${metaStr}`;
                })
            )
        }),
        // File transports nếu tạo được thư mục
        ...fileTransports,
    ],
});

module.exports = logger;