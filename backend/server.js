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
const host = '127.0.0.1';

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
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

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
        // 1. 设置SSE响应头
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders(); 
        let history = [];
        let chatId = existingChatId;
        // 2. 提前处理 chatId 和 history
        if (chatId) {
            const historyPath = path.join(HISTORIES_DIR, `${chatId}.json`);
            try {
                const historyData = await fs.readFile(historyPath);
                history = JSON.parse(historyData);
            } catch (error) {
                console.log(`History file for ${chatId} not found. Starting new chat.`);
                chatId = Date.now().toString();
            }
        } else {
            chatId = Date.now().toString();
        }
        const userParts = [{ text: prompt }];
        if (file) {
            userParts.unshift(fileToGenerativePart(file.buffer, file.mimetype));
        }
        const chat = model.startChat({ history });
        const result = await chat.sendMessageStream(userParts);
        // --- 关键改动在这里 ---
        // 3. 创建一个变量来手动聚合所有AI响应的文本块
        let fullResponseText = '';
        // 4. 迭代流，既发送数据块给前端，也聚合文本到我们自己的变量中
        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            fullResponseText += chunkText; // <-- 手动聚合
            const payload = {
                reply: chunkText,
                chatId: chatId
            };
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
        }
        // 5. 流结束后，手动构建要保存的完整历史记录
        //    a. 添加用户的提问到历史中
        history.push({
            role: 'user',
            parts: userParts
        });
        //    b. 添加AI完整的、聚合后的回答到历史中
        history.push({
            role: 'model',
            parts: [{ text: fullResponseText }] // <-- 使用我们自己聚合的完整文本
        });
        // 6. 将构建好的、格式正确的完整历史记录写入文件
        const historyPath = path.join(HISTORIES_DIR, `${chatId}.json`);
        // `history` 现在是一个包含所有对话轮次的、格式正确的数组
        await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
        // 7. 结束响应流
        res.end();
    } catch (error) {
        console.error('Chat API error:', error);
        const errorPayload = { error: 'Failed to get response from Gemini.' };
        if (!res.headersSent) {
            res.status(500).json(errorPayload);
        } else {
            res.write(`data: ${JSON.stringify(errorPayload)}\n\n`);
            res.end();
        }
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
app.listen(port, host, () => {
    fs.mkdir(HISTORIES_DIR, { recursive: true });
    console.log(`正在监听：http://${host}:${port}`);
});