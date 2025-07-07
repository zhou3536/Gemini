// backend/server.js
console.log('Service is trying to start...');
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
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// --- 辅助函数 ---
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
        const { prompt, chatId } = req.body;
        const modelName = req.body.model; 

        console.log(`Using model: ${modelName} for chat: ${chatId || 'New Chat'}`);

        const model = genAI.getGenerativeModel({ model: modelName });

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

        const messageParts = [];
        if (prompt) {
            messageParts.push({ text: prompt });
        }
        if (req.file) {
            const filePart = fileToGenerativePart(req.file.buffer, req.file.mimetype);
            messageParts.push(filePart);
        }
        
        const result = await chat.sendMessageStream(messageParts);

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const newChatId = chatId || `${Date.now()}`;
        
        // ======================= 核心改动部分 (开始) =======================
        
        let fullResponseText = ''; // 1. 创建一个变量来累积模型的完整回复

        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            fullResponseText += chunkText; // 2. 在流式传输过程中，将每个文本块累加起来

            const responseData = {
                reply: chunkText, // 仍然是分块发送给前端，保证打字机效果
                chatId: newChatId, 
            };
            res.write(`data: ${JSON.stringify(responseData)}\n\n`);
        }
        
        // 3. 对话结束后，不再使用 chat.getHistory()，而是手动构建历史记录
        const userMessage = { 
            role: 'user', 
            parts: messageParts // messageParts 已经包含了文本和文件
        };
        const modelResponse = {
            role: 'model',
            parts: [{ text: fullResponseText }] // 4. 将累积的完整回复作为一个 part 保存
        };
        const updatedHistory = [...history, userMessage, modelResponse];
        const newFilePath = path.join(HISTORIES_DIR, `${newChatId}.json`);
        // 5. 保存这个我们手动构建的、干净的、完整的历史记录
        await fs.writeFile(newFilePath, JSON.stringify(updatedHistory, null, 2));
        res.end();
    } catch (error) {
        console.error('Chat API Error:', error);
        res.status(500).write(`data: ${JSON.stringify({ error: `Server error: ${error.message}` })}\n\n`);
        res.end();
    }
});


// 其他路由 (获取最新对话, 获取历史列表等) 保持不变...

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
                const firstUserMessage = history.find(h => h.role === 'user');
                const title = firstUserMessage?.parts.find(p => p.text)?.text.substring(0, 50) || 'Untitled Chat';
                return {
                    chatId: file.replace('.json', ''),
                    title,
                };
            })
        );
        res.json(historyList);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return res.json([]);
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
// app.delete('/api/history/:chatId', async (req, res) => {
//     try {
//         const filePath = path.join(HISTORIES_DIR, `${req.params.chatId}.json`);
//         await fs.unlink(filePath);
//         res.json({ success: true });
//     } catch (error) {
//         console.error('Delete history error:', error);
//         res.status(500).json({ error: 'Failed to delete history.' });
//     }
// });
app.get('/api/history/:chatId', async (req, res) => {
    try {
        const filePath = path.join(HISTORIES_DIR, `${req.params.chatId}.json`);
        const data = await fs.readFile(filePath, 'utf-8');
        res.json(JSON.parse(data));
    } catch (error) {
        res.status(404).json({ error: 'History not found.' });
    }
});

// --- 启动服务器 ---
app.listen(port, host, () => {
    fs.mkdir(HISTORIES_DIR, { recursive: true });
    console.log(`Server is running at http://${host}:${port}`);
});

