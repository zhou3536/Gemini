let deferredPrompt; // 用于存储 beforeinstallprompt 事件

// 1. 注册 Service Worker
// 这部分代码运行在主线程，它会告诉浏览器去加载并运行 /service-worker.js
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then(registration => {
                console.log('Service Worker registered with scope:', registration.scope);
            })
            .catch(error => {
                console.error('Service Worker registration failed:', error);
            });
    });
}

// 2. 监听 beforeinstallprompt 事件
// 当浏览器认为你的网站可以被安装时，会触发此事件。
window.addEventListener('beforeinstallprompt', (event) => {
    // 阻止默认的安装提示（这样我们就可以手动触发）
    event.preventDefault();
    // 存储事件，以便稍后可以触发它
    deferredPrompt = event;
    // 显示安装按钮
    const installButton = document.getElementById('installButton');
    if (installButton) {
        installButton.style.display = 'block';
        console.log('beforeinstallprompt event fired. Install button shown.');
    }
});

// 3. 处理按钮点击事件
const installButton = document.getElementById('installButton');
if (installButton) {
    installButton.addEventListener('click', async () => {
        if (deferredPrompt) {
            // 隐藏按钮，因为它只能被使用一次
            installButton.style.display = 'none';

            // 显示安装提示
            deferredPrompt.prompt();

            // 等待用户选择
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`User response to the install prompt: ${outcome}`);

            // 清除存储的事件，因为已经使用过了
            deferredPrompt = null;

            if (outcome === 'accepted') {
                console.log('PWA was installed!');
                alert('应用已安装到桌面！');
            } else {
                console.log('PWA installation dismissed.');
                alert('安装已取消。');
            }
        }
    });
}

// 4. 监听 appinstalled 事件 (可选，用于确认安装成功)
window.addEventListener('appinstalled', () => {
    console.log('PWA was successfully installed!');
    // 可以在这里更新UI，比如隐藏安装按钮或显示已安装状态
    const installButton = document.getElementById('installButton');
    if (installButton) {
        installButton.style.display = 'none';
    }
});