// auth.js
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';


// __dirname 在 ES Module 中不可用，需要手动创建
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 从环境变量获取配置
const ACCESS_PASSWORD = 'cxk2022';
const COOKIE_SECRET = 'JXyUgsAQxg02yNV1s0rWrSJfdia3Z';
const AUTH_COOKIE_NAME = 'access_granted'; // 认证Cookie的名称
const SESSION_DURATION_MS = 240 * 60 * 60 * 1000; // 240小时

// 认证中间件
const authenticateMiddleware = (req, res, next) => {
    // 豁免登录相关的路径和静态资源 (login.html)
    // 注意：这里的路径需要与主应用中的静态文件服务和路由匹配
    if (req.path === '/login.html' || req.path === '/api/login' || req.path === '/api/logout') {
        return next();
    }

    // 检查是否存在有效的认证Cookie
    if (req.signedCookies[AUTH_COOKIE_NAME] === 'true') {
        return next(); // 认证通过，继续处理请求
    }

    // 如果是API请求，返回401 Unauthorized
    if (req.path.startsWith('/api')) {
        return res.status(401).json({ message: 'Unauthorized. Please log in to access this resource.' });
    }

    // 对于其他页面请求，重定向到登录页面或直接提供登录页面
    // 假设 login.html 位于 public 目录下，且 public 目录与 auth.js 在同一层级，
    // 或者 auth.js 在一个子目录中 (例如 /src/auth.js)，那么路径需要调整。
    // 这里假设 auth.js 在根目录，public 也在根目录。
    // 如果 auth.js 在一个子文件夹 (e.g., `src/auth.js`), 那么路径应该是 `path.join(__dirname, '../public', 'login.html')`
    res.status(401).sendFile(path.join(__dirname, 'public', 'login.html'));
};

// 登录路由处理函数
const loginRoute = (req, res) => {
    const { password } = req.body;

    if (!ACCESS_PASSWORD || !COOKIE_SECRET) {
        console.error('Authentication configuration missing: ACCESS_PASSWORD or COOKIE_SECRET not set.');
        return res.status(500).json({ message: 'Server authentication not configured.' });
    }

    if (password === ACCESS_PASSWORD) {
        // 密码正确，设置认证Cookie
        res.cookie(AUTH_COOKIE_NAME, 'true', {
            maxAge: SESSION_DURATION_MS, // 48小时过期
            httpOnly: true, // 客户端JS无法访问
            secure: process.env.NODE_ENV === 'production', // 生产环境只在HTTPS下发送
            signed: true, // 签名Cookie，防止篡改
            sameSite: 'Lax' // CSRF保护
        });
        return res.status(200).json({ message: 'Login successful!' });
    } else {
        return res.status(401).json({ message: 'Invalid password.' });
    }
};

// 登出路由处理函数
const logoutRoute = (req, res) => {
    // 清除认证Cookie
    res.clearCookie(AUTH_COOKIE_NAME, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        signed: true,
        sameSite: 'Lax'
    });
    return res.status(200).json({ message: 'Logged out successfully.' });
};

/**
 * 初始化认证模块并将其应用于Express应用。
 * @param {Express.Application} app Express应用实例
 */
const initializeAuth = (app) => {
    // 检查必要的环境变量
    if (!ACCESS_PASSWORD || !COOKIE_SECRET) {
        console.error('ERROR: ACCESS_PASSWORD or COOKIE_SECRET environment variables are not set!');
        console.error('Please set them in your .env file.');
        process.exit(1); // 退出应用
    }

    // 使用 cookie-parser 中间件，并传入密钥用于签名
    app.use(cookieParser(COOKIE_SECRET));

    // 应用认证中间件。它应该在所有受保护的路由之前。
    // 并且在 express.json() 之后，因为登录路由需要解析请求体。
    app.use(authenticateMiddleware);

    // 定义认证相关的API路由
    app.post('/api/login', loginRoute);
    app.post('/api/logout', logoutRoute);

    console.log('Authentication module initialized.');
};

export { initializeAuth };
