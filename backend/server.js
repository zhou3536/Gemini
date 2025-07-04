// backend/server.js

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
const app = express();
const port = process.env.PORT || 3001;

// __dirname 在 ES Module 中不可用，需要手动创建
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HISTORIES_DIR = path.join(__dirname, 'histories');

// --- 中间件 ---
app.use(cors()); // 允许跨域请求
app.use(express.json()); // 解析JSON请求体
app.use(express.static(path.join(__dirname, '../frontend'))); // 托管前端静态文件

// Multer 配置，用于处理文件上传（保存在内存中）
const upload = multer({ storage: multer.memoryStorage() });

// --- Gemini AI 配置 ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

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
        const { prompt, chatId: existingChatId } = req.body;
        const file = req.file;

        let history = [];
        let chatId = existingChatId;

        if (chatId) {
            // 继续现有对话
            const historyPath = path.join(HISTORIES_DIR, `${chatId}.json`);
            try {
                const historyData = await fs.readFile(historyPath);
                history = JSON.parse(historyData);
            } catch (error) {
                // 如果找不到历史文件，就当作新对话处理
                console.log(`History file for ${chatId} not found. Starting new chat.`);
                chatId = null;
            }
        }

        // 如果没有 chatId (无论是本来就没有还是历史文件找不到)，开启新对话
        if (!chatId) {
            chatId = Date.now().toString();
        }

        const userParts = [{ text: prompt }];
        if (file) {
            userParts.unshift(fileToGenerativePart(file.buffer, file.mimetype));
        }

        const chat = model.startChat({ history });
        const result = await chat.sendMessage(userParts);
        const response = result.response;
        const text = response.text();

        // 更新历史记录
        history.push({ role: 'user', parts: userParts });
        history.push({ role: 'model', parts: [{ text }] });

        // 实时保存
        const historyPath = path.join(HISTORIES_DIR, `${chatId}.json`);
        await fs.writeFile(historyPath, JSON.stringify(history, null, 2));

        res.json({ reply: text, chatId });
    } catch (error) {
        console.error('Chat API error:', error);
        res.status(500).json({ error: 'Failed to get response from Gemini.' });
    }
});

app.get('/api/chat/latest', async (req, res) => {
    try {
        const files = await fs.readdir(HISTORIES_DIR);
        const jsonFiles = files
            .filter(file => file.endsWith('.json'))
            .sort() // 按时间戳（文件名）升序排序
            .reverse(); // 反转，最新的在最前面

        if (jsonFiles.length === 0) {
            // 如果没有任何历史记录，返回空状态
            return res.json({ chatId: null, messages: [] });
        }

        const latestFile = jsonFiles[0];
        const chatId = latestFile.replace('.json', '');
        const filePath = path.join(HISTORIES_DIR, latestFile);

        const data = await fs.readFile(filePath, 'utf-8');
        const messages = JSON.parse(data);

        // 返回最新对话的ID和全部内容
        res.json({ chatId, messages });

    } catch (error) {
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
                const firstUserPart = history[0]?.parts.find(part => part.text);
                const title = firstUserPart?.text.substring(0, 50) || 'Untitled Chat';
                return {
                    chatId: file.replace('.json', ''),
                    title,
                };
            })
        );
        res.json(historyList);
    } catch (error) {
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
app.listen(port, () => {
    // 确保 histories 目录存在
    fs.mkdir(HISTORIES_DIR, { recursive: true });
    console.log(`Server is running on http://localhost:${port}`);
});