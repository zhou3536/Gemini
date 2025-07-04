document.addEventListener('DOMContentLoaded', () => {
    // DOM 元素
    const chatWindow = document.getElementById('chat-window');
    const promptInput = document.getElementById('prompt-input');
    const sendBtn = document.getElementById('send-btn');
    const newChatBtn = document.getElementById('new-chat-btn');
    const historyList = document.getElementById('history-list');
    const loadingIndicator = document.getElementById('loading-indicator');
    const fileInput = document.getElementById('file-input');
    const filePreviewContainer = document.getElementById('file-preview-container');

    // 应用状态
    let currentChatId = null;
    let currentFile = null;

    // --- 配置 marked.js 和 highlight.js ---
    if (typeof marked !== 'undefined' && typeof hljs !== 'undefined') {
        marked.setOptions({
            // 这里的 highlight 函数告诉 marked 如何高亮代码
            highlight: function(code, lang) {
                // 检查语言是否在 highlight.js 中注册，否则使用纯文本
                const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                return hljs.highlight(code, { language }).value;
            },
            // marked 生成的代码块的类前缀，以便 highlight.js 的 CSS 可以识别
            langPrefix: 'hljs language-', 
            gfm: true, // 启用 GitHub Flavored Markdown (表格、任务列表等)
            breaks: true // 允许 Markdown 中的换行符渲染为 <br>
        });
    }


    // --- 功能函数 ---

    // 渲染消息 (现在可以处理Markdown)
    function renderMessage(sender, text) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', `${sender}-message`);

        if (sender === 'gemini' && typeof marked !== 'undefined') {
            // 如果是Gemini的消息，并且 marked.js 已加载，则解析Markdown
            messageDiv.innerHTML = marked.parse(text);
        } else {
            // 对于用户消息或 marked.js 未加载的情况，依然使用textContent
            const p = document.createElement('p');
            // 注意：textContent 会自动转义 HTML 字符，防止XSS攻击
            // 如果用户输入中也包含需要解析的Markdown，这里也需要用 marked.parse，但通常不建议对用户输入直接使用 innerHTML
            p.textContent = text; 
            messageDiv.appendChild(p);
        }
        
        chatWindow.appendChild(messageDiv);
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }
    
    // 渲染整个消息历史 (保持不变，因为 renderMessage 会处理Markdown)
    function renderChatHistory(messages) {
        chatWindow.innerHTML = '';
        if (!messages || messages.length === 0) {
             renderMessage('gemini', '你好！新对话已开始。'); // 更改了欢迎语末尾的字符，防止误解
             return;
        }
        messages.forEach(msg => {
            const text = msg.parts.find(p => p.text)?.text || '';
            // 确保渲染历史时也正确处理Gemini的Markdown
            renderMessage(msg.role === 'user' ? 'user' : 'gemini', text);
        });
    }

    // ... (其他函数保持不变，例如 setLoading, fetchAndRenderHistory, loadChatHistory, sendMessage) ...
    
    // 设置加载状态
    function setLoading(isLoading) {
        sendBtn.disabled = isLoading;
        loadingIndicator.classList.toggle('hidden', !isLoading);
    }

    // 获取并渲染历史列表
    async function fetchAndRenderHistory() {
        try {
            const response = await fetch('/api/history');
            const histories = await response.json();
            historyList.innerHTML = '';
            histories.forEach(h => {
                const li = document.createElement('li');
                li.textContent = h.title;
                li.dataset.chatId = h.chatId;
                li.addEventListener('click', () => loadChatHistory(h.chatId));
                historyList.appendChild(li);
            });
        } catch (error) {
            console.error('Error fetching history:', error);
        }
    }

    // 加载指定的聊天记录
    async function loadChatHistory(chatId) {
        if (!chatId) return;
        try {
            const response = await fetch(`/api/history/${chatId}`);
            const messages = await response.json();
            renderChatHistory(messages);
            currentChatId = chatId;
        } catch (error) {
            console.error('Error loading chat history:', error);
        }
    }

    // 发送消息
    async function sendMessage() {
        const prompt = promptInput.value.trim();
        if (!prompt && !currentFile) return;

        setLoading(true);
        // 对于用户发送的消息，通常不需要进行Markdown解析，直接显示原文
        renderMessage('user', prompt || `已发送文件: ${currentFile.name}`); 
        promptInput.value = '';
        filePreviewContainer.innerHTML = '';

        const formData = new FormData();
        formData.append('prompt', prompt);
        if (currentChatId) {
            formData.append('chatId', currentChatId);
        }
        if (currentFile) {
            formData.append('file', currentFile);
            currentFile = null;
        }

        try {
            const response = await fetch('/api/chat', { method: 'POST', body: formData });
            if (!response.ok) throw new Error('Network response was not ok');

            const data = await response.json();
            // Gemini的回复里可能包含Markdown，由 renderMessage 处理
            renderMessage('gemini', data.reply);

            const chatJustCreated = !currentChatId;
            currentChatId = data.chatId;
            
            if (chatJustCreated) {
                fetchAndRenderHistory();
            }
        } catch (error) {
            console.error('Error sending message:', error);
            renderMessage('gemini', '抱歉，出错了，请稍后再试。');
        } finally {
            setLoading(false);
        }
    }
    
    // --- 事件监听 ---
    sendBtn.addEventListener('click', sendMessage);
    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { // Shift+Enter 换行，Enter 发送
            e.preventDefault();
            sendMessage();
        }
    });

    newChatBtn.addEventListener('click', () => {
        currentChatId = null;
        currentFile = null;
        filePreviewContainer.innerHTML = '';
        renderChatHistory([]); // 清空并显示欢迎语
    });

    fileInput.addEventListener('change', (e) => {
        currentFile = e.target.files[0];
        if (currentFile) {
            filePreviewContainer.innerHTML = `<span>${currentFile.name}</span>`;
        }
    });

    // --- 初始化 ---
    async function initializeApp() {
        await fetchAndRenderHistory();
        try {
            const response = await fetch('/api/chat/latest');
            const latestChat = await response.json();
            currentChatId = latestChat.chatId;
            renderChatHistory(latestChat.messages); // 渲染最新对话
        } catch (error) {
            console.error('Could not load latest chat:', error);
            renderChatHistory([]); // 出错时显示新对话的欢迎语
        }
    }

    initializeApp();
});

