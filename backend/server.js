// backend/server.js
console.log('Service is trying to start...');
import express from 'express';
import multer from 'multer';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
// --- [后端改造] --- 导入 axios
import axios from 'axios';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3001;
const host = '127.0.0.1';
const HISTORIES_DIR = path.join(__dirname, 'histories');
const upload = multer({ storage: multer.memoryStorage() });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(cors());
app.use(express.json());
// 注意: multer中间件应该只用于特定路由，而不是全局使用
// app.use(upload.single('file')); // 从这里移除
app.use(express.static(path.join(__dirname, '..', 'frontend')));

function fileToGenerativePart(buffer, mimeType) {
    return { inlineData: { data: buffer.toString('base64'), mimeType } };
}

// --- [后端改造] --- 定义联网搜索工具 ---
const webSearchTool = {
    functionDeclarations: [{
        name: "web_search",
        description: "Searches the web for information on a given query. Use this for recent events, specific facts, or topics beyond general knowledge.",
        parameters: {
            type: "OBJECT",
            properties: {
                query: { type: "STRING", description: "The search query to use." }
            },
            required: ["query"]
        },
    }],
};

// --- [后端改造] --- 实现联网搜索工具的执行函数 ---
async function executeWebSearch(query) {
    console.log(`Executing web search for: "${query}"`);
    try {
        const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
        const cx = process.env.GOOGLE_SEARCH_CX;
        if (!apiKey || !cx) {
            throw new Error("Google Search API Key or CX is not configured in .env file.");
        }
        const url = `https://www.googleapis.com/customsearch/v1`;
        const params = { key: apiKey, cx, q: query, num: 5 }; // 获取前5条结果

        const response = await axios.get(url, { params });
        const items = response.data.items || [];
        
        // 提取关键信息，避免发送过多数据给LLM
        const results = items.map(item => ({
            title: item.title,
            link: item.link,
            snippet: item.snippet,
        }));

        console.log(`Search results count: ${results.length}`);
        return { success: true, results };
    } catch (error) {
        console.error("Web search API error:", error.response ? error.response.data : error.message);
        return { success: false, error: "Failed to perform web search." };
    }
}


// --- [后端改造] --- 重写核心聊天接口以支持工具调用 ---
app.post('/api/chat', upload.single('file'), async (req, res) => {
    try {
        // 'true'/'false' 字符串转为布尔值
        const enableSearch = req.body.enableSearch === 'true'; 
        const { prompt, chatId, model: modelName } = req.body;

        console.log(`Chat request: model=${modelName}, searchEnabled=${enableSearch}, chatId=${chatId || 'New'}`);

        const modelConfig = { model: modelName };
        if (enableSearch) {
            // 只有当开关打开时，才给模型装备工具
            modelConfig.tools = [webSearchTool];
            console.log("Web search tool is enabled for this request.");
        }

        const model = genAI.getGenerativeModel(modelConfig);

        let history = [];
        if (chatId) {
            try {
                const historyPath = path.join(HISTORIES_DIR, `${chatId}.json`);
                history = JSON.parse(await fs.readFile(historyPath, 'utf-8'));
            } catch (e) { console.log(`History for ${chatId} not found. Starting new chat.`); }
        }
        
        const chat = model.startChat({ history });

        const messageParts = [];
        if (prompt) messageParts.push({ text: prompt });
        if (req.file) messageParts.push(fileToGenerativePart(req.file.buffer, req.file.mimetype));
        
        const result = await chat.sendMessageStream(messageParts);

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        const newChatId = chatId || `${Date.now()}`;
        
        for await (const chunk of result.stream) {
            const functionCalls = chunk.functionCalls();
            if (functionCalls) {
                // 模型请求调用工具
                for (const call of functionCalls) {
                    if (call.name === 'web_search') {
                        const query = call.args.query;
                        // 1. 通知前端正在搜索
                        res.write(`data: ${JSON.stringify({ chatId: newChatId, status: 'searching', query })}\n\n`);

                        // 2. 执行搜索
                        const searchResult = await executeWebSearch(query);

                        // 3. 将搜索结果作为工具响应发送回模型
                        const toolResponse = {
                            functionResponse: { name: 'web_search', response: { searchResult } },
                        };
                        const responseAfterTool = await chat.sendMessageStream([toolResponse]);
                        
                        // 4. 继续处理模型基于搜索结果的回复
                        for await (const secondChunk of responseAfterTool.stream) {
                            if (secondChunk.text()) {
                                res.write(`data: ${JSON.stringify({ reply: secondChunk.text() })}\n\n`);
                            }
                        }
                    }
                }
            } else if (chunk.text()) {
                // 正常的文本回复
                res.write(`data: ${JSON.stringify({ reply: chunk.text(), chatId: newChatId })}\n\n`);
            }
        }
        
        // 使用 getHistory() 来获取包含工具调用在内的完整、准确的历史记录
        const updatedHistory = await chat.getHistory();
        const newFilePath = path.join(HISTORIES_DIR, `${newChatId}.json`);
        await fs.writeFile(newFilePath, JSON.stringify(updatedHistory, null, 2));
        
        res.end();
    } catch (error) {
        console.error('Chat API Error:', error);
        res.status(500).write(`data: ${JSON.stringify({ error: `Server error: ${error.message}` })}\n\n`);
        res.end();
    }
});


// 其他路由 (获取历史列表, 获取特定历史记录等) 保持不变...
// 注意：历史记录现在会包含工具调用信息，前端渲染时需要能处理或忽略它们
// (我们在前端的 renderChatHistory 中已经处理了这一点)
app.get('/api/history', async (req, res) => {
    try {
        const files = await fs.readdir(HISTORIES_DIR);
        const jsonFiles = files.filter(file => file.endsWith('.json')).sort().reverse();
        const historyList = await Promise.all(
            jsonFiles.map(async (file) => {
                const filePath = path.join(HISTORIES_DIR, file);
                const data = await fs.readFile(filePath, 'utf-8');
                const history = JSON.parse(data);
                // 寻找第一个 role 为 'user' 且有 text 的 part
                const firstUserMessage = history.find(h => h.role === 'user' && h.parts.some(p => p.text));
                const title = firstUserMessage?.parts.find(p => p.text)?.text.substring(0, 50) || 'Untitled Chat';
                return {
                    chatId: file.replace('.json', ''),
                    title,
                };
            })
        );
        res.json(historyList);
    } catch (error) {
        if (error.code === 'ENOENT') return res.json([]);
        console.error('History list error:', error);
        res.status(500).json({ error: 'Failed to retrieve history.' });
    }
});

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
