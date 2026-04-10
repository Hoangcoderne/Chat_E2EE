// src/app.js
// Chỉ khởi tạo Express app, gắn middleware và routes.

const express      = require('express');
const path         = require('path');
const helmet       = require('helmet');
const cookieParser = require('cookie-parser');

const logger        = require('./utils/logger');
const requestLogger = require('./middleware/requestLogger');
const { apiLimiter, authLimiter, registerLimiter, resetLimiter } = require('./middleware/rateLimiter');

const authRoutes  = require('./routes/authRoutes');
const chatRoutes  = require('./routes/chatRoutes');
const groupRoutes = require('./routes/groupRoutes');

const app = express();

//  Trust proxy 
// Bắt buộc khi deploy sau Nginx / Heroku / Render.
// Không có → rate limit dùng IP proxy thay vì IP client thật.
app.set('trust proxy', 1);

//  Security headers (Helmet) ─
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc:  ["'self'"],
            scriptSrc:   ["'self'"],
            scriptSrcAttr: ["'none'"],        // Chặn inline onclick="..."
            styleSrc:    ["'self'", "'unsafe-inline'"],
            imgSrc:      ["'self'", "data:"],
            connectSrc:  ["'self'", "ws:", "wss:"],
            fontSrc:     ["'self'"],
            objectSrc:   ["'none'"],
            upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
        },
        reportOnly: false,
    },
    crossOriginEmbedderPolicy: false,
}));

//  Body / Cookie parsers 
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

//  HTTP request logging 
app.use(requestLogger);

//  Static files 
app.use(express.static(path.join(__dirname, '../public')));

//  Rate limiting ─
// Thứ tự quan trọng: specific limiters TRƯỚC apiLimiter chung
app.use('/api/auth/login',           authLimiter);
app.use('/api/auth/register',        registerLimiter);
app.use('/api/auth/verify-recovery', resetLimiter);
app.use('/api/auth/reset-password',  resetLimiter);
app.use('/api/',                     apiLimiter);

//  Routes 
app.use('/api/auth',   authRoutes);
app.use('/api/chat',   chatRoutes);
app.use('/api/groups', groupRoutes);

//  Global error handler 
// Bắt tất cả lỗi không được xử lý trong routes / middleware phía trên.
app.use((err, req, res, next) => {
    logger.error({
        event:  'unhandled_error',
        error:  err.message,
        stack:  err.stack,
        method: req.method,
        path:   req.path,
        userId: req.user?.userId || 'anonymous',
    });
    res.status(500).json({ message: 'Lỗi server không xác định.' });
});

module.exports = app;
