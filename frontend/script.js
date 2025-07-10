function copycode() {
    //移除，避免重复添加
    const allExistingCopyButtons = document.querySelectorAll('.copy-button');
    allExistingCopyButtons.forEach(button => { button.remove(); });

    const messageElements = document.querySelectorAll('.message');
    messageElements.forEach(messageElement => {
        const preElements = messageElement.querySelectorAll('pre');
        preElements.forEach(preElement => {
            const copyButton = document.createElement('button');
            // copyButton.textContent = 'Copy';
            copyButton.classList.add('copy-button');
            copyButton.addEventListener('click', () => {
                // 获取pre元素内的所有文本，去除 HTML 标签
                const textToCopy = preElement.textContent;
                // 调用复制到剪贴板函数
                copyToClipboard(textToCopy);
            });
            // preElement.parentNode.insertBefore(copyButton, preElement.nextSibling);  // 在pre元素之后插入
            // preElement.appendChild(copyButton);   // 在pre元素里插入
            preElement.parentNode.insertBefore(copyButton, preElement);  // 在pre元素之前插入
        });
    });
    // 复制到剪贴板的函数
    function copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            // 现代浏览器推荐使用 Clipboard API
            navigator.clipboard.writeText(text)
                .then(() => {
                    console.log('已复制');
                })
                .catch(err => {
                    console.error('Failed to copy text: ', err);
                    // 如果 Clipboard API 失败，则使用 fallback 方法
                    fallbackCopyToClipboard(text);
                });
        } else {
            // 较旧的浏览器使用 fallback 方法
            fallbackCopyToClipboard(text);
        }
    }
    // Clipboard API 的 Fallback 实现
    function fallbackCopyToClipboard(text) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        // 避免页面滚动
        textArea.style.top = "0";
        textArea.style.left = "0";
        textArea.style.position = "fixed";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            const successful = document.execCommand('copy');
            const msg = successful ? 'successful' : 'unsuccessful';
            console.log('Fallback: Copying text command was ' + msg);
        } catch (err) {
            console.error('Fallback: Oops, unable to copy', err);
        }
        document.body.removeChild(textArea);
    }
}
//打开关闭历史列表
function openlist() {
    const a = document.getElementById('history-list');
    a.style.width = '300px';
    a.style.border = '1px solid #e0e0e0';
    a.style.transition = 'all 0.3s ease';
}
function closelist() {
    const a = document.getElementById('history-list');
    a.style.width = '0';
    a.style.border = 'none';
    a.style.transition = 'none';
}
//缓存选择
const modelSelect = document.getElementById('gemini-v');
modelSelect.addEventListener('change', function () {
    localStorage.setItem('selectedModel', this.value);
});
const savedValue = localStorage.getItem('selectedModel');
if (savedValue) {
    modelSelect.value = savedValue;
}

let SearchOn = false
function Sch() {
    const aaa = document.getElementById('Search');
    if (SearchOn) {
        aaa.classList.remove('SearchON')
        SearchOn = false
    } else if (!SearchOn) {
        aaa.classList.add('SearchON')
        SearchOn = true
    }
}
//手机打开对话导航
let dhdh = false;
function opendhdh() {
    const listdhdh = document.getElementById('list-dhdh')
    if (dhdh) {
        listdhdh.style.width = '0';
        listdhdh.style.borderWidth = '0';
        dhdh = false;
    } else if (!dhdh) {
        listdhdh.style.width = '200px';
        listdhdh.style.borderWidth = '1px';
        dhdh = true;
    }
}

//手机端键盘弹窗优化
// document.addEventListener('DOMContentLoaded', (event) => {
//     const promptInput = document.getElementById('prompt-input');
//     const searchButton = document.getElementById('Search');
//     promptInput.addEventListener('click', closelist);
//     searchButton.addEventListener('touchstart', (e) => {
//         e.preventDefault();
//         Sch();
//         setTimeout(() => { promptInput.focus(); }, 50);
//     });
//     searchButton.addEventListener('click', (e) => {Sch()});
// });
// let isPromptInputFocused = false;
// function isPromptInput() {
//     const promptInput = document.getElementById('prompt-input');
//     promptInput.addEventListener('focus', () => {
//         isPromptInputFocused = true;
//     });
//     promptInput.addEventListener('blur', () => {
//         blurTimeoutId = setTimeout(() => {
//             isPromptInputFocused = false;
//         }, 1000);
//     });
// }
// isPromptInput();