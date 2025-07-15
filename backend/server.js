// backend/server.js
console.log('Service is trying to start...');
// --- 模块导入 (统一使用 ES Modules) ---
import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';

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

// 检查错误是否是不可重试的配置/API错误
function isNonRetryableError(error) {
    const errorMessage = error.message.toLowerCase();
    const nonRetryableKeywords = ['api key', 'quota', 'permission denied', 'model not found', 'invalid argument'];
    return nonRetryableKeywords.some(keyword => errorMessage.includes(keyword));
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

// 核心聊天接口
app.post('/api/chat', upload.array('files'), async (req, res) => {
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
        const isSearchEnabled = searchEnabled === true || searchEnabled === 'true';

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

        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const generativePart = await fileToGenerativePart(file);
                messageParts.push(generativePart);
                await fs.unlink(file.path); // Clean up the uploaded file
            }
        }

        newChatId = chatId || `${Date.now()}`;

        // 立即发送"思考中"信号，让前端可以更新UI
        if (!safeSend({ status: 'THINKING', chatId: newChatId })) {
            return safeEnd();
        }

        // 将实际的、耗时的Gemini调用放在一个异步函数中
        const executeChat = async () => {
            // 重试机制的流式响应处理
            let maxRetries = 3;
            let currentRetry = 0;
            let success = false;

            while (currentRetry < maxRetries && !success && !isResponseSent) {
                try {
                    console.log(`Attempting to send message (attempt ${currentRetry + 1}/${maxRetries})`);

                    // 在每次重试前重置 fullResponseText
                    if (currentRetry > 0) {
                        fullResponseText = '';
                    }

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
                    console.error(`Stream error (attempt ${currentRetry + 1}/${maxRetries}):`, streamError);

                    // 如果是不可重试的错误，直接抛出以终止循环
                    if (isNonRetryableError(streamError)) {
                        throw streamError;
                    }

                    currentRetry++;
                    if (currentRetry < maxRetries) {
                        // 发送重试通知给客户端
                        safeSend({
                            retry: true,
                            attempt: currentRetry,
                            maxRetries: maxRetries,
                            chatId: newChatId
                        });
                        await delay(1000 * currentRetry);
                    } else {
                        // 所有重试都失败了
                        throw new Error('All retry attempts failed after multiple connection issues.');
                    }
                }
            }

            if (!success && !isResponseSent) {
                throw new Error('Failed to get response after all retries.');
            }

            // 保存历史记录
            if (success && fullResponseText && fullResponseText.trim()) {
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
        };

        // 启动异步执行
        executeChat().catch(error => {
            console.error('Chat API Error in executeChat:', error);

            const canRetry = !isNonRetryableError(error);
            let errorMessage = `Server error: ${error.message}`;

            // 为特定错误提供更友好的前端提示
            if (error.message.toLowerCase().includes('api key')) {
                errorMessage = 'API key is invalid or missing. Please check your configuration.';
            } else if (error.message.toLowerCase().includes('quota')) {
                errorMessage = 'API quota exceeded. Please try again later.';
            } else if (error.message.toLowerCase().includes('model not found')) {
                errorMessage = 'The requested model is not available. Please select another model.';
            }

            safeSend({
                error: errorMessage,
                chatId: newChatId || `error_${Date.now()}`,
                canRetry: canRetry
            });
        }).finally(() => {
            safeEnd();
        });

    } catch (error) {
        // 这个最外层的catch现在只处理准备阶段的同步错误
        console.error('Initial Chat Setup Error:', error);
        safeSend({
            error: `Server setup error: ${error.message}`,
            chatId: newChatId || `error_${Date.now()}`,
            canRetry: false
        });
        safeEnd();
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
    console.log(`Server is listening on port : ${port}, Listening address : ${host}`);
});

console.log('Service started successfully!');
