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
                copyButton.classList.add('copy-button-OK');
                setTimeout(() => { copyButton.classList.remove('copy-button-OK'); }, 1500);
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
//给<table>套div
function wrapTablesInGeminiMessages() {
    const geminiMessages = document.querySelectorAll('div.gemini-message');

    geminiMessages.forEach(message => {
        const tables = message.querySelectorAll('table');

        tables.forEach(table => {
            if (table.dataset.wrapped) {
                return;
            }
            const tableBox = document.createElement('div');
            tableBox.classList.add('table-box');
            table.parentNode.replaceChild(tableBox, table);
            tableBox.appendChild(table);
            table.dataset.wrapped = 'true';
        });
    });
}
function md() {
    wrapTablesInGeminiMessages();
    copycode()
}
//打开关闭历史列表
let historylistdsiplay = false;
document.addEventListener('DOMContentLoaded', function () {
    const a = document.getElementById("history-list");
    const opbtn = document.getElementById("history-b");
    opbtn.addEventListener("click", function () {
        if (!historylistdsiplay) {
            a.style.width = '300px';
            a.style.borderWidth = '1px';
            a.style.transition = 'all 0.3s ease';
            historylistdsiplay = true;
        } else if (historylistdsiplay) {
            a.style.width = '0';
            a.style.borderWidth = '0';
            historylistdsiplay = false;
        }
    });
    document.addEventListener('click', (event) => {
        const ListOpen = a.style.width !== '0';
        const isClickOnOpenButton = opbtn.contains(event.target);
        if (ListOpen && !isClickOnOpenButton) {
            a.style.width = '0';
            a.style.borderWidth = '0';
            a.style.transition = 'none';
            historylistdsiplay = false;
        }
    });
});
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

//切换主题
document.addEventListener('DOMContentLoaded', function () {
    const selectElement = document.getElementById('lightdark');

    // 函数：设置主题
    function setTheme(theme) {
        if (theme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
            localStorage.setItem('theme', 'dark'); // 保存到 localStorage
        } else if (theme === 'light') {
            document.documentElement.setAttribute('data-theme', 'light');
            localStorage.setItem('theme', 'light'); // 保存到 localStorage
        } else {
            document.documentElement.removeAttribute('data-theme'); // 移除 data-theme 属性，使用默认颜色
            localStorage.removeItem('theme'); // 移除 localStorage 中的 theme
        }
    }

    // 监听选择框的 change 事件
    selectElement.addEventListener('change', function () {
        const selectedValue = selectElement.value;
        setTheme(selectedValue);
    });

    // 页面加载时，从 localStorage 中读取主题设置
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        setTheme(savedTheme);
        selectElement.value = savedTheme; // 更新选择框的选中值
    } else {
        // 如果 localStorage 中没有保存的主题，则使用自动模式
        selectElement.value = 'auto';
    }

    //自动模式判断
    function autoTheme() {
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (prefersDark) {
            setTheme('dark');
            selectElement.value = 'auto';
        } else {
            setTheme('light');
            selectElement.value = 'auto';
        }
    }

    // 监听系统主题变化（仅在选择“自动”时生效）
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
        if (selectElement.value === 'auto') {
            autoTheme();
        }
    });

    // 初始加载时，如果是自动模式，则判断系统主题
    if (selectElement.value === 'auto') {
        autoTheme();
    }
});
