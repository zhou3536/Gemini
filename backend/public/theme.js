//切换主题


const themeToggle = {
    themes: ['light', 'dark'],
    currentIndex: 0,

    themeinit() {
        // 根据系统主题设置初始主题
        const systemTheme = this.getSystemTheme();
        this.currentIndex = this.themes.indexOf(systemTheme); // 找到系统主题在themes数组中的索引

        if (this.currentIndex === -1) {
            // 如果系统主题不在预定义的 themes 中，默认使用 light
            this.currentIndex = 0;
        }

        this.updateTheme();
        this.updateUI();

        // 监听切换按钮
        document.getElementById('themeToggle').addEventListener('click', () => this.toggle());
    },

    getSystemTheme() {
        // 获取系统主题
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        } else {
            return 'light';
        }
    },

    toggle() {
        this.currentIndex = (this.currentIndex + 1) % this.themes.length;
        this.updateTheme();
        this.updateUI();
    },

    updateTheme() {
        const theme = this.themes[this.currentIndex];
        document.body.setAttribute('data-theme', theme);
    },

    updateUI() {
        const theme = this.themes[this.currentIndex];
        const icons = {
            light: '<svg width="20" height="20" viewBox="0 0 24 24" fill="#FFDA63" stroke="#FFDA63" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>',
            dark: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
        };
        document.getElementById('themeToggle').innerHTML = icons[theme];
    }
};

// 初始化
themeToggle.themeinit();