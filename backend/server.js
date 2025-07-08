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

// 延迟函数，用于重试
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- API 路由 ---

// 核心聊天接口
app.post('/api/chat', upload.single('file'), async (req, res) => {
    let isResponseSent = false;
    let fullResponseText = '';
    let history = [];
    let newChatId = null;
    
    // 设置响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // 安全发送响应的函数
    const safeSend = (data) => {
        if (!isResponseSent && !res.destroyed) {
            try {
                res.write(`data: ${JSON.stringify(data)}\n\n`);
                return true;
            } catch (error) {
                console.error('Error writing to response:', error);
                return false;
            }
        }
        return false;
    };

    // 安全结束响应的函数
    const safeEnd = () => {
        if (!isResponseSent && !res.destroyed) {
            try {
                res.end();
                isResponseSent = true;
            } catch (error) {
                console.error('Error ending response:', error);
            }
        }
    };

    // 处理客户端断开连接
    res.on('close', () => {
        isResponseSent = true;
        console.log('Client disconnected');
    });

    try {
        const { prompt, chatId, searchEnabled } = req.body;
        const modelName = req.body.model;

        // 将字符串转换为布尔值
        const isSearchEnabled = searchEnabled === 'true';

        console.log(`Using model: ${modelName} for chat: ${chatId || 'New Chat'}, Search: ${isSearchEnabled}`);

        // 根据搜索状态配置模型
        const modelConfig = { 
            model: modelName,
            generationConfig: {
                temperature: 0.7,
                topP: 0.8,
                topK: 40,
                maxOutputTokens: 8192,
            }
        };

        // 如果启用搜索，添加搜索工具
        if (isSearchEnabled) {
            modelConfig.tools = [{ google_search: {} }];
        }

        const model = genAI.getGenerativeModel(modelConfig);

        // 加载历史记录
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

        newChatId = chatId || `${Date.now()}`;

        // 重试机制的流式响应处理
        let maxRetries = 3;
        let currentRetry = 0;
        let success = false;

        while (currentRetry < maxRetries && !success && !isResponseSent) {
            try {
                console.log(`Attempting to send message (attempt ${currentRetry + 1}/${maxRetries})`);
                
                const result = await chat.sendMessageStream(messageParts);
                
                let chunkCount = 0;
                const startTime = Date.now();
                
                for await (const chunk of result.stream) {
                    if (isResponseSent) break;
                    
                    const chunkText = chunk.text();
                    if (!chunkText) continue;
                    
                    fullResponseText += chunkText;
                    chunkCount++;
                    
                    const responseData = {
                        reply: chunkText,
                        chatId: newChatId,
                        chunkIndex: chunkCount,
                        timestamp: Date.now()
                    };
                    
                    if (!safeSend(responseData)) {
                        console.log('Failed to send chunk, client may have disconnected');
                        break;
                    }
                    
                    // 添加少量延迟，避免过快的数据流
                    if (chunkCount % 10 === 0) {
                        await delay(10);
                    }
                }
                
                const endTime = Date.now();
                console.log(`Stream completed successfully in ${endTime - startTime}ms with ${chunkCount} chunks`);
                success = true;
                
            } catch (streamError) {
                currentRetry++;
                console.error(`Stream error (attempt ${currentRetry}/${maxRetries}):`, streamError);
                
                if (currentRetry < maxRetries) {
                    // 发送重试通知给客户端
                    safeSend({
                        retry: true,
                        attempt: currentRetry,
                        maxRetries: maxRetries,
                        chatId: newChatId
                    });
                    
                    // 等待一段时间再重试
                    await delay(1000 * currentRetry);
                } else {
                    // 所有重试都失败了
                    throw streamError;
                }
            }
        }

        if (!success) {
            throw new Error('Failed to get response after all retries');
        }

        // 保存历史记录
        if (fullResponseText.trim()) {
            const userMessage = {
                role: 'user',
                parts: messageParts
            };
            const modelResponse = {
                role: 'model',
                parts: [{ text: fullResponseText }]
            };
            const updatedHistory = [...history, userMessage, modelResponse];
            
            try {
                const newFilePath = path.join(HISTORIES_DIR, `${newChatId}.json`);
                await fs.writeFile(newFilePath, JSON.stringify(updatedHistory, null, 2));
                console.log(`History saved for chat ${newChatId}`);
            } catch (saveError) {
                console.error('Error saving history:', saveError);
                // 发送保存失败通知，但不中断响应
                safeSend({
                    warning: 'History save failed',
                    chatId: newChatId
                });
            }
        }

        // 发送完成信号
        safeSend({
            completed: true,
            chatId: newChatId,
            totalLength: fullResponseText.length
        });

    } catch (error) {
        console.error('Chat API Error:', error);
        
        // 根据错误类型提供不同的错误信息
        let errorMessage = 'Server error occurred';
        if (error.message?.includes('Failed to parse stream')) {
            errorMessage = 'Network connection unstable, please try again';
        } else if (error.message?.includes('quota')) {
            errorMessage = 'API quota exceeded, please try again later';
        } else if (error.message?.includes('timeout')) {
            errorMessage = 'Request timeout, please try again';
        } else {
            errorMessage = `Server error: ${error.message}`;
        }
        
        safeSend({ 
            error: errorMessage,
            chatId: newChatId || `error_${Date.now()}`,
            canRetry: !error.message?.includes('quota')
        });
    } finally {
        safeEnd();
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

// --- 删除历史记录接口 ---
app.delete('/api/history/delete-by-indices', async (req, res) => {
    try {
        const { indices } = req.body;
        const files = await fs.readdir(HISTORIES_DIR);
        const jsonFiles = files.filter(file => file.endsWith('.json')).sort().reverse();
        // 构建要删除的文件路径
        const filesToDelete = indices.map(index => path.join(HISTORIES_DIR, jsonFiles[index])).filter(filePath => filePath !== undefined); 
        // 删除文件
        for (const filePath of filesToDelete) {
            try {
                await fs.unlink(filePath);
                console.log(`Deleted history file: ${filePath}`);
            } catch (deleteError) {
                console.error(`Error deleting file ${filePath}:`, deleteError);
            }
        }
        res.status(204).send(); 
    } catch (error) {
        console.error('Error deleting history by indices:', error);
        res.status(500).json({ error: 'Failed to delete history.' });
    }
});
// --- 启动服务器 ---
app.listen(port, host, () => {
    fs.mkdir(HISTORIES_DIR, { recursive: true });
    console.log(`Server is running at http://${host}:${port}`);
});