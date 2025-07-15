// 处理文件，点击/粘贴/拖拽上传
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
// --- 辅助函数：处理文件数组 ---
function processFiles(files) {
    let largeFilesDetected = false;
    const newFiles = Array.from(files);

    newFiles.forEach(file => {
        if (file.size > MAX_FILE_SIZE_BYTES) {
            largeFilesDetected = true;
            console.warn(`文件 "${file.name}" (大小: ${file.size} 字节) 超过了 5MB 的限制，将被忽略。`);
        } else {
            // 检查是否已存在同名且同大小的文件，避免重复添加
            const isDuplicate = selectedFiles.some(f => f.name === file.name && f.size === file.size);
            if (!isDuplicate) {
                selectedFiles.push(file);
            } else {
                console.log(`文件 "${file.name}" 已存在，跳过添加。`);
            }
        }
    });

    if (largeFilesDetected) {
        alert('请选择小于5MB的文件。');
    }
    renderFilePreviews();
}

// --- 点击添加文件按钮 ---
addFileBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (event) => {
    processFiles(event.target.files);
    fileInput.value = ''; // 清空input，以便可以再次选择同名文件
});

// --- 渲染文件预览 ---
function renderFilePreviews() {
    filePreviewArea.innerHTML = ''; // 清空现有预览
    if (selectedFiles.length > 0) {
        filePreviewArea.style.display = 'block'; // 有文件时显示
    } else {
        filePreviewArea.style.display = 'none'; // 无文件时隐藏
        return;
    }

    selectedFiles.forEach((file, index) => {
        const preview = document.createElement('div');
        preview.classList.add('file-preview-item');

        const fileName = document.createElement('span');
        fileName.textContent = file.name;
        fileName.title = file.name;
        preview.appendChild(fileName);

        const removeBtn = document.createElement('button');
        removeBtn.textContent = '×'; // 叉号
        removeBtn.title = `移除`; // 鼠标悬停提示
        removeBtn.addEventListener('click', () => {
            selectedFiles.splice(index, 1); // 从数组中移除文件
            renderFilePreviews(); // 重新渲染预览
        });
        preview.appendChild(removeBtn);
        filePreviewArea.appendChild(preview);
    });
}

// --- 拖放文件功能 ---
inputarea.addEventListener('dragover', (event) => {
    event.preventDefault(); // 阻止默认行为，允许拖放
    inputarea.classList.add('drag-over'); // 添加视觉反馈
});

inputarea.addEventListener('dragleave', (event) => {
    inputarea.classList.remove('drag-over'); // 移除视觉反馈
});

inputarea.addEventListener('drop', (event) => {
    event.preventDefault(); // 阻止默认行为（如在新标签页打开文件）
    inputarea.classList.remove('drag-over'); // 移除视觉反馈

    const files = event.dataTransfer.files;
    if (files.length > 0) {
        processFiles(files);
    }
});

// --- 粘贴文件功能 (CTRL+V) ---
promptInput.addEventListener('paste', (event) => {
    const items = (event.clipboardData || event.originalEvent.clipboardData).items;
    let filesPasted = false;

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
            const file = item.getAsFile();
            if (file) {
                // 对于粘贴的图片，file.name 可能为空或为 'image.png'。
                // 如果为空，则生成一个更具体的名称。
                if (!file.name) {
                    // 尝试根据类型生成名称，否则使用时间戳
                    let ext = file.type.split('/')[1] || 'bin';
                    file.name = `pasted_image_${Date.now()}.${ext}`;
                }
                processFiles([file]); // 以数组形式处理单个文件
                filesPasted = true;
            }
        }
    }

    // 如果有文件被粘贴，阻止默认的粘贴行为（避免文件内容被粘贴为文本）
    if (filesPasted) {
        event.preventDefault();
    }
    // 如果没有文件被粘贴（例如只粘贴了文本），则允许默认的文本粘贴行为
});

renderFilePreviews();

//对话导航
function generateUserMessageIndex() {
    const indexList = document.getElementById('list-dhdh');
    const userMessages = document.querySelectorAll('#chat-window .message.user-message');
    indexList.innerHTML = '';
    if (userMessages.length === 0) {
        const listTitle = document.createElement('h4');
        listTitle.textContent = '开始对话把！';
        indexList.appendChild(listTitle);
        return;
    }
    const listTitle = document.createElement('h4');
    listTitle.textContent = '对话导航';
    indexList.appendChild(listTitle);
    userMessages.forEach((messageDiv, index) => {
        const messageId = `user-msg-${index}`;
        messageDiv.id = messageId;
        let messageText = messageDiv.querySelector('p')?.textContent || messageDiv.textContent;
        messageText = messageText.trim();
        if (!messageText) return;
        const displayText = messageText.length > 25 ? messageText.substring(0, 22) + '...' : messageText;
        const listItem = document.createElement('li');
        listItem.textContent = displayText;
        listItem.title = messageText;
        listItem.addEventListener('click', (event) => {
            const targetMessage = document.getElementById(messageId);
            if (targetMessage) {
                targetMessage.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
        indexList.appendChild(listItem);
    });
}