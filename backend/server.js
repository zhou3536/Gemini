console.log('Service is trying to start...');

import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

// --- 配置 ---
dotenv.config();

// __dirname 在 ES Module 中不可用，需要手动创建
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3001;
const host = process.env.HOST || '127.0.0.1';
const HISTORIES_DIR = path.join(__dirname, 'histories');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Gemini AI 配置
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- 任务管理 ---
const jobs = new Map();
const chatEvents = new EventEmitter();
chatEvents.setMaxListeners(0); // 无限监听器以避免警告

// --- 中间件 ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

const upload = multer({ dest: UPLOADS_DIR });

// 延迟函数，用于重试
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fileToGenerativePart(file) {
    const fileBuffer = await fs.readFile(file.path);
    const base64EncodedData = fileBuffer.toString('base64');
    return {
        inlineData: {
            data: base64EncodedData,
            mimeType: file.mimetype,
        },
    };
}

// 核心聊天接口 - 步骤1: 接收请求，创建任务
app.post('/api/chat', upload.array('files'), async (req, res) => {
    try {
        const { prompt, chatId, searchEnabled, model: modelName } = req.body;
        const isSearchEnabled = searchEnabled === 'true';
        const jobId = uuidv4();
        const newChatId = chatId || `${Date.now()}`;

        console.log(`Job ${jobId} created for chat: ${newChatId}, Model: ${modelName}, Search: ${isSearchEnabled}`);

        let history = [];
        if (chatId) {
            try {
                const historyPath = path.join(HISTORIES_DIR, `${chatId}.json`);
                history = JSON.parse(await fs.readFile(historyPath, 'utf-8'));
            } catch (e) {
                console.log(`History for ${chatId} not found. Starting new chat.`);
            }
        }

        const messageParts = [];
        if (prompt) messageParts.push({ text: prompt });

        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                messageParts.push(await fileToGenerativePart(file));
                await fs.unlink(file.path); // 清理上传的文件
            }
        }

        // 存储任务所需的所有信息
        jobs.set(jobId, {
            status: 'pending',
            chatId: newChatId,
            history,
            messageParts,
            modelName,
            isSearchEnabled,
            fullResponseText: '',
            error: null,
        });

        // 立即响应，告知客户端任务已创建
        res.status(202).json({ jobId, chatId: newChatId });

        // 异步执行实际的聊天逻辑
        executeChat(jobId);

    } catch (error) {
        console.error('Initial Chat Setup Error:', error);
        res.status(500).json({ error: `Server setup error: ${error.message}` });
    }
});

// 核心聊天接口 - 步骤2: 通过SSE流式传输结果
app.get('/api/chat/stream/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = jobs.get(jobId);

    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (data) => {
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify(data)}

`);
        }
    };

    const listener = (data) => {
        sendEvent(data);
        if (data.completed || data.error) {
            res.end();
        }
    };

    chatEvents.on(jobId, listener);

    // 如果任务已经完成或失败，立即发送最终状态
    if (job.status === 'completed' || job.status === 'failed') {
        sendEvent({
            [job.status === 'completed' ? 'completed' : 'error']: job.status === 'completed' ? true : job.error,
            chatId: job.chatId,
            totalLength: job.fullResponseText.length,
            finalReply: job.fullResponseText // 发送完整回复以防万一
        });
        res.end();
        return;
    }


    req.on('close', () => {
        chatEvents.removeListener(jobId, listener);
        console.log(`Client disconnected from job ${jobId}`);
    });
});


// 核心聊天接口 - 步骤3: 后台执行Gemini请求和历史保存
async function executeChat(jobId) {
    const job = jobs.get(jobId);
    if (!job) {
        console.error(`Job ${jobId} not found for execution.`);
        return;
    }

    const emit = (data) => chatEvents.emit(jobId, data);

    try {
        job.status = 'processing';
        const { history, messageParts, modelName, isSearchEnabled, chatId } = job;

        const modelConfig = {
            model: modelName,
            generationConfig: { temperature: 0.7, topP: 0.8, topK: 40, maxOutputTokens: 8192 }
        };
        if (isSearchEnabled) {
            modelConfig.tools = [{ google_search: {} }];
        }
        const model = genAI.getGenerativeModel(modelConfig);
        const chat = model.startChat({ history });

        let maxRetries = 3;
        let currentRetry = 0;
        let success = false;

        while (currentRetry < maxRetries && !success) {
            try {
                console.log(`Job ${jobId}: Attempting to send message (attempt ${currentRetry + 1}/${maxRetries})`);
                if (currentRetry > 0) job.fullResponseText = '';

                const result = await chat.sendMessageStream(messageParts);

                for await (const chunk of result.stream) {
                    const chunkText = chunk.text();
                    if (!chunkText) continue;
                    job.fullResponseText += chunkText;
                    emit({ reply: chunkText, chatId });
                }
                success = true;
                console.log(`Job ${jobId}: Stream completed successfully.`);

            } catch (streamError) {
                console.error(`Job ${jobId}: Stream error (attempt ${currentRetry + 1}/${maxRetries}):`, streamError);
                
                // Google AI SDK 错误通常包含 status code，或者嵌套在 response 对象里
                const statusCode = streamError.status || (streamError.response && streamError.response.status);

                // 如果是 4xx (客户端错误) 或 5xx (服务端错误)，则不应重试，立即抛出错误
                // 这会捕获 API Key 无效、请求格式错误、模型不可用等问题
                if (statusCode && statusCode >= 400 && statusCode < 600) {
                    const apiError = new Error(streamError.message);
                    apiError.statusCode = statusCode; // 将状态码附加到错误对象上
                    throw apiError; // 抛到外层的 catch 块处理
                }

                // 对于其他错误 (如网络连接超时)，执行重试逻辑
                currentRetry++;
                if (currentRetry < maxRetries) {
                    emit({ retry: true, attempt: currentRetry, maxRetries, chatId });
                    await delay(1000 * currentRetry);
                } else {
                    // 重试耗尽，抛出最终错误
                    throw new Error('All retry attempts failed after multiple connection issues.');
                }
            }
        }

        if (!success) {
            throw new Error('Failed to get response after all retries.');
        }

        job.status = 'completed';
        if (job.fullResponseText.trim()) {
            const userMessage = { role: 'user', parts: messageParts };
            const modelResponse = { role: 'model', parts: [{ text: job.fullResponseText }] };
            const updatedHistory = [...history, userMessage, modelResponse];

            try {
                const newFilePath = path.join(HISTORIES_DIR, `${chatId}.json`);
                await fs.writeFile(newFilePath, JSON.stringify(updatedHistory, null, 2));
                console.log(`Job ${jobId}: History saved for chat ${chatId}`);
            } catch (saveError) {
                console.error(`Job ${jobId}: Error saving history:`, saveError);
                emit({ warning: 'History save failed', chatId });
            }
        }

        emit({ completed: true, chatId, totalLength: job.fullResponseText.length });

    } catch (error) {
        console.error(`Job ${jobId}: Chat execution failed:`, error);
        job.status = 'failed';
        job.error = error.message;

        const errorMessage = `Server error: ${error.message}`;

        // 将包含状态码的结构化错误发送给前端
        emit({ 
            error: errorMessage, 
            statusCode: error.statusCode || 'N/A', // 如果有状态码，一并发送
            chatId: job.chatId 
        });
    } finally {
        // Clean up the job from memory after some time to prevent memory leaks
        setTimeout(() => {
            jobs.delete(jobId);
            console.log(`Job ${jobId} cleaned up from memory.`);
        }, 5 * 60 * 1000); // 5 minutes
    }
}

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
app.delete('/api/history/:chatId', async (req, res) => {
    const chatId = req.params.chatId;
    const filePath = path.join(HISTORIES_DIR, `${chatId}.json`);

    try {
        await fs.unlink(filePath);
        console.log(`History ${chatId} deleted.`);
        res.status(200).json({ message: `History ${chatId} deleted successfully.` });
    } catch (error) {
        console.error(`Error deleting history ${chatId}:`, error);
        res.status(500).json({ error: `Failed to delete history ${chatId}.` });
    }
});

// --- 启动服务器 ---
app.listen(port, host, () => {
    fs.mkdir(HISTORIES_DIR, { recursive: true });
    fs.mkdir(UPLOADS_DIR, { recursive: true });
    console.log(`Start HTTP server @ ${host}:${port}`);
});

console.log('Service started successfully!');


// --- 优雅关闭 ---
process.on('SIGINT', () => {
    console.log('Received SIGINT. Shutting down gracefully...');
    process.exit(0);
});
""