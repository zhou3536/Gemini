// auth.js
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

// __dirname 在 ES Module 中不可用，需要手动创建
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 从环境变量获取配置
let ACCESS_PASSWORD;
let COOKIE_SECRET;
const AUTH_COOKIE_NAME = 'access_granted';
const SESSION_DURATION_MS = 240 * 60 * 60 * 1000; // 240小时 = 10天

// --- 速率限制相关配置和存储 ---
const loginAttemptTimestamps = new Map();
const LOGIN_RATE_LIMIT_INTERVAL_MS = 10 * 1000;
const MAX_AGE_FOR_ATTEMPTS_MS = LOGIN_RATE_LIMIT_INTERVAL_MS * 2;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 每5分钟清理一次

// 辅助函数：获取客户端IP地址，考虑代理
const getClientIp = (req) => {
    // 优先检查 X-Forwarded-For
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
        return forwardedFor.split(',')[0].trim();
    }
    // 检查 X-Real-IP
    const realIp = req.headers['x-real-ip'];
    if (realIp) {
        return realIp.trim();
    }
    // 如果都没有，使用 req.ip (Express 默认连接IP)
    // 注意：如果 Express app.set('trust proxy') 未配置或配置不当，
    // req.ip 可能是反向代理的IP，而不是真实客户端IP。
    return req.ip;
};

// 速率限制中间件，专门用于登录路由
const loginRateLimitMiddleware = (req, res, next) => {
    const clientIp = getClientIp(req);
    const lastAttemptTime = loginAttemptTimestamps.get(clientIp);
    const currentTime = Date.now();

    if (lastAttemptTime && (currentTime - lastAttemptTime < LOGIN_RATE_LIMIT_INTERVAL_MS)) {
        const remainingTimeSeconds = Math.ceil((LOGIN_RATE_LIMIT_INTERVAL_MS - (currentTime - lastAttemptTime)) / 1000);
        // console.warn(`[RATE LIMIT] IP: ${clientIp} - Too many login attempts. Remaining: ${remainingTimeSeconds}s`);
        return res.status(429).json({
            message: `Please try again in ${remainingTimeSeconds} seconds.`,
            retryAfter: remainingTimeSeconds
        });
    }

    loginAttemptTimestamps.set(clientIp, currentTime); // 记录当前尝试的时间
    next();
};

// 定期清理 loginAttemptTimestamps Map 中的旧条目
const cleanupLoginAttempts = () => {
    const currentTime = Date.now();
    let cleanedCount = 0;
    for (const [ip, timestamp] of loginAttemptTimestamps.entries()) {
        if (currentTime - timestamp > MAX_AGE_FOR_ATTEMPTS_MS) {
            loginAttemptTimestamps.delete(ip);
            cleanedCount++;
        }
    }
    if (cleanedCount > 0) {
        console.log(`[CLEANUP] Cleaned up ${cleanedCount} expired login attempt entries. Current map size: ${loginAttemptTimestamps.size}`);
    }
};

// --- 认证中间件和路由处理函数 ---

const authenticateMiddleware = (req, res, next) => {
    if (req.path === '/login.html' ||
        req.path === '/api/login' ||
        req.path === '/api/logout' ||
        req.path === '/theme.js' ||
        req.path === '/color.css' ||
        req.path === '/favicon.ico' ||
        req.path === '/manifest.json') {
        return next();
    }

    // if (!req.path.startsWith('/api')) {
    //     return next();
    // }

    if (req.signedCookies[AUTH_COOKIE_NAME] === 'true') {
        return next();
    }

    if (req.path.startsWith('/api')) {
        return res.status(401).json({ message: 'Unauthorized. Please log in to access this resource.' });
    }

    res.status(401).sendFile(path.join(__dirname, 'public', 'login.html'));
};

// 登录路由处理函数
const loginRoute = (req, res) => {
    const { password } = req.body;
    const clientIp = getClientIp(req); // 获取客户端IP

    if (!ACCESS_PASSWORD || !COOKIE_SECRET) {
        console.error('Authentication configuration missing: ACCESS_PASSWORD or COOKIE_SECRET not set.');
        // 在服务器配置错误时也打印IP，虽然此时不是登录尝试本身的问题
        console.error(`[LOGIN ERROR] IP: ${clientIp} - Server authentication not configured.`);
        return res.status(500).json({ message: 'Server authentication not configured.' });
    }

    if (password === ACCESS_PASSWORD) {
        res.cookie(AUTH_COOKIE_NAME, 'true', {
            maxAge: SESSION_DURATION_MS,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            signed: true,
            sameSite: 'Lax'
        });
        // 登录成功后，更新时间戳，防止立即再次尝试登录
        loginAttemptTimestamps.set(clientIp, Date.now());
        // 打印登录成功日志
        console.log(`IP: ${clientIp} - Login successful.`);
        return res.status(200).json({ message: 'Login successful!' });
    } else {
        // 密码错误，更新时间戳，强制执行冷却时间
        loginAttemptTimestamps.set(clientIp, Date.now());
        // 打印登录失败日志
        console.warn(`IP: ${clientIp} - Login failed`);
        return res.status(401).json({ message: 'Login failed' });
    }
};

// 登出路由处理函数
const logoutRoute = (req, res) => {
    res.clearCookie(AUTH_COOKIE_NAME, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        signed: true,
        sameSite: 'Lax'
    });
    const clientIp = getClientIp(req); // 获取客户端IP
    console.log(`IP: ${clientIp} - Logged out successfully.`);
    return res.status(200).json({ message: 'Logged out successfully.' });
};


//初始化认证模块并将其应用于Express应用。
const initializeAuth = (app, accessPassword, cookieSecret) => {
    ACCESS_PASSWORD = accessPassword;
    COOKIE_SECRET = cookieSecret;
    if (!ACCESS_PASSWORD || !COOKIE_SECRET) {
        console.error('ERROR: ACCESS_PASSWORD or COOKIE_SECRET environment variables are not set!');
        console.error('Please set them in your .env file.');
        process.exit(1);
    }

    // 启用 Express 对代理 IP 的信任，如果你的应用在反向代理后面
    // 例如：app.set('trust proxy', 1); // 信任一个跳 (Nginx)
    // 或者根据你的实际代理层数设置，或者设置为 true (如果所有代理都可信)
    // 示例：如果你有一个Nginx在前面，可以这样设置
    // app.set('trust proxy', 1);

    app.use(cookieParser(COOKIE_SECRET));
    app.use(authenticateMiddleware);
    app.post('/api/login', loginRateLimitMiddleware, loginRoute);
    app.post('/api/logout', logoutRoute);

    setInterval(cleanupLoginAttempts, CLEANUP_INTERVAL_MS);
    console.log('Authentication module initialized.');
    // console.log(`Login rate limit: 1 request per ${LOGIN_RATE_LIMIT_INTERVAL_MS / 1000} seconds.`);
};

export { initializeAuth };
