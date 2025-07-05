// backend/server.js

// --- 模块导入 (统一使用 ES Modules) ---
import express from 'express';
import multer from 'multer';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// --- 配置 ---
dotenv.config();

// __dirname 在 ES Module 中不可用，需要手动创建
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3001;
const host = '127.0.0.1';
const HISTORIES_DIR = path.join(__dirname, 'histories');

// Multer 配置，用于处理文件上传（保存在内存中）
const upload = multer({ storage: multer.memoryStorage() });

// Gemini AI 配置
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- 中间件 ---
app.use(cors()); // 允许跨域请求
app.use(express.json()); // 解析JSON请求体
// 注意：路径通常指向构建后的前端目录，例如 'dist' 或 'build'
// 如果你的前端文件就在 frontend 目录下，这个路径是正确的
app.use(express.static(path.join(__dirname, '..', 'frontend'))); 

// --- 辅助函数 ---
// 将 Buffer 转为 Gemini API 接受的格式
function fileToGenerativePart(buffer, mimeType) {
    return {
        inlineData: {
            data: buffer.toString('base64'),
            mimeType,
        },
    };
}

// --- API 路由 ---

// 核心聊天接口
app.post('/api/chat', upload.single('file'), async (req, res) => {
    try {
        // 1. 从请求体中获取 prompt, chatId, 以及前端传来的 model
        const { prompt, chatId } = req.body;
        const modelName = req.body.model; // 获取模型名称，若无则使用默认值

        console.log(`Using model: ${modelName} for chat: ${chatId || 'New Chat'}`);

        // 2. 使用动态的模型名称初始化 Gemini 模型
        const model = genAI.getGenerativeModel({ model: modelName });

        // 3. 根据 chatId 加载或创建聊天历史
        let history = [];
        if (chatId) {
            try {
                const historyPath = path.join(HISTORIES_DIR, `${chatId}.json`);
                const data = await fs.readFile(historyPath, 'utf-8');
                history = JSON.parse(data);
             } catch (e) {
                console.log(`History for ${chatId} not found. Starting a new chat.`);
             }
        }
        
        const chat = model.startChat({ history });

        // 4. 准备要发送给模型的内容（prompt 和 文件）
        const messageParts = [{ text: prompt }];
        if (req.file) {
            const filePart = fileToGenerativePart(req.file.buffer, req.file.mimetype);
            messageParts.push(filePart);
        }
        
        // 5. 发送请求并以流的形式获取结果
        const result = await chat.sendMessageStream(messageParts);

        // 6. 设置响应头以支持 SSE (Server-Sent Events)
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const newChatId = chatId || `${Date.now()}`; // 如果是新对话，生成一个基于时间戳的ID

        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            const responseData = {
                reply: chunkText,
                chatId: newChatId, 
            };
            res.write(`data: ${JSON.stringify(responseData)}\n\n`);
        }
        
        // 7. 对话结束后，获取完整的历史记录并保存到文件
        const updatedHistory = await chat.getHistory();
        const newFilePath = path.join(HISTORIES_DIR, `${newChatId}.json`);
        await fs.writeFile(newFilePath, JSON.stringify(updatedHistory, null, 2));

        res.end(); // 结束响应

    } catch (error) {
        console.error('Chat API Error:', error);
        // 如果出错，也通过 SSE 发送错误信息给前端
        res.status(500).write(`data: ${JSON.stringify({ error: `Server error: ${error.message}` })}\n\n`);
        res.end();
    }
});


// 获取最新对话
app.get('/api/chat/latest', async (req, res) => {
    try {
        const files = await fs.readdir(HISTORIES_DIR);
        const jsonFiles = files
            .filter(file => file.endsWith('.json'))
            .sort()
            .reverse();

        if (jsonFiles.length === 0) {
            return res.json({ chatId: null, messages: [] });
        }

        const latestFile = jsonFiles[0];
        const chatId = latestFile.replace('.json', '');
        const filePath = path.join(HISTORIES_DIR, latestFile);
        const data = await fs.readFile(filePath, 'utf-8');
        const messages = JSON.parse(data);
        res.json({ chatId, messages });

    } catch (error) {
        // 如果 histories 文件夹不存在，这是正常情况，返回空
        if (error.code === 'ENOENT') {
            return res.json({ chatId: null, messages: [] });
        }
        console.error('Error fetching latest chat:', error);
        res.status(500).json({ error: 'Failed to retrieve the latest chat.' });
    }
});

// 获取历史列表
app.get('/api/history', async (req, res) => {
    try {
        const files = await fs.readdir(HISTORIES_DIR);
        const jsonFiles = files.filter(file => file.endsWith('.json')).sort().reverse();
        const historyList = await Promise.all(
            jsonFiles.map(async (file) => {
                const filePath = path.join(HISTORIES_DIR, file);
                const data = await fs.readFile(filePath, 'utf-8');
                const history = JSON.parse(data);
                // 找到第一个 'user' 角色的消息作为标题
                const firstUserMessage = history.find(h => h.role === 'user');
                const title = firstUserMessage?.parts[0]?.text.substring(0, 50) || 'Untitled Chat';
                return {
                    chatId: file.replace('.json', ''),
                    title,
                };
            })
        );
        res.json(historyList);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return res.json([]); // histories 目录不存在，返回空列表
        }
        console.error('History list error:', error);
        res.status(500).json({ error: 'Failed to retrieve history.' });
    }
});

// 获取特定历史记录内容
app.get('/api/history/:chatId', async (req, res) => {
    try {
        const filePath = path.join(HISTORIES_DIR, `${req.params.chatId}.json`);
        const data = await fs.readFile(filePath, 'utf-8');
        res.json(JSON.parse(data));
    } catch (error) {
        res.status(404).json({ error: 'History not found.' });
    }
});

// 删除历史记录
app.delete('/api/history/:chatId', async (req, res) => {
    try {
        const filePath = path.join(HISTORIES_DIR, `${req.params.chatId}.json`);
        await fs.unlink(filePath);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete history error:', error);
        res.status(500).json({ error: 'Failed to delete history.' });
    }
});

// --- 启动服务器 ---
app.listen(port, host, () => {
    // 启动时确保 histories 文件夹存在
    fs.mkdir(HISTORIES_DIR, { recursive: true });
    console.log(`Server is running at http://${host}:${port}`);
});
