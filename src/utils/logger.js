// src/utils/logger.js
const winston = require('winston');
const fs = require('fs');

// Tạo thư mục logs nếu chưa tồn tại
if (!fs.existsSync('logs')) {
    fs.mkdirSync('logs', { recursive: true });
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
        // Chỉ ghi lỗi vào error.log
        new winston.transports.File({
            filename: 'logs/error.log',
            level: 'error',
            maxsize: 5 * 1024 * 1024, // 5MB
            maxFiles: 5,
        }),
        // Tất cả log vào combined.log
        new winston.transports.File({
            filename: 'logs/combined.log',
            maxsize: 5 * 1024 * 1024,
            maxFiles: 5,
        }),
    ],
});

// Trong môi trường development: in thêm ra console với format dễ đọc
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message, event, ...meta }) => {
                const metaStr = Object.keys(meta).length
                    ? ' | ' + JSON.stringify(meta)
                    : '';
                return `${timestamp} [${level}] ${event || message}${metaStr}`;
            })
        )
    }));
}

module.exports = logger;
