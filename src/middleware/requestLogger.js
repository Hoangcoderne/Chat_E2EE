// src/middleware/requestLogger.js
const logger = require('../utils/logger');

// Ghi log mỗi HTTP request với method, path, status, thời gian xử lý
const requestLogger = (req, res, next) => {
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;

        // Không log các request tới static files (js, css, html, images)
        if (req.path.match(/\.(js|css|html|png|ico|svg|woff|woff2)$/)) return;

        const level = res.statusCode >= 500 ? 'error'
                    : res.statusCode >= 400 ? 'warn'
                    : 'info';

        logger[level]({
            event: 'http_request',
            method: req.method,
            path: req.path,
            status: res.statusCode,
            duration_ms: duration,
            ip: req.ip,
            userId: req.user?.userId || 'anonymous',
        });
    });

    next();
};

module.exports = requestLogger;
