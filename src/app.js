// src/app.js
// Khởi tạo Express app, gắn middleware và routes.

const express      = require('express');
const path         = require('path');
const helmet       = require('helmet');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const mongoose     = require('mongoose');

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

//  HTTPS enforcement (production only)
// Redirect HTTP → HTTPS khi deploy sau reverse proxy.
if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
        if (req.headers['x-forwarded-proto'] !== 'https') {
            return res.redirect(301, `https://${req.headers.host}${req.url}`);
        }
        next();
    });
}

//  CORS middleware
// Cho phép frontend gọi API từ domain khác (cần thiết khi tách FE/BE).
app.use(cors({
    origin:      process.env.FRONTEND_URL,
    methods:     ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,                              // Cho phép gửi cookies (refresh token)
}));

//  Security headers (Helmet)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc:  ["'self'"],
            scriptSrc:   ["'self'"],
            scriptSrcAttr: ["'none'"],        // Chặn inline onclick="..."
            styleSrc:    ["'self'"],
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

//  Body / Cookie parsers (giới hạn body size 16KB chống payload quá lớn)
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: true, limit: '16kb' }));
app.use(cookieParser());

//  HTTP request logging 
app.use(requestLogger);

//  Health check endpoint
// Dùng cho monitoring, load balancer, Docker health checks.
app.get('/health', async (req, res) => {
    const dbState = mongoose.connection.readyState;
    const dbStatus = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
    const healthy = dbState === 1;

    res.status(healthy ? 200 : 503).json({
        status:  healthy ? 'ok' : 'degraded',
        uptime:  Math.floor(process.uptime()),
        db:      dbStatus[dbState] || 'unknown',
    });
});

//  Static files 
app.use(express.static(path.join(__dirname, '../public')));

//  Rate limiting
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
