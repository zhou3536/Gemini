# Gemini
### 用Google免费的Gemini api搭建一个自己的对话网页，可以实现免翻墙使用Gemini  
### 可以在海外服务器搭建，也可以在本地电脑搭建(不能访问谷歌地区需要修改一下api服务器地址，请看后面)
### 网页UI示例[点击跳转](https://geminitest.855655.xyz)
仅为示例网页，功能不可用

- 基本功能：文字对话，上传文件对话(对话上下文为当前对话全部)，新建对话，保留历史纪录，历史可以继续对话。
- 网页代码很少，响应很快，布局适配桌面+移动设备，支持夜间配色。

## 使用方法  
#### 支持主流平台Windows，Linux，MacOS，及其他能安装node.js的平台
### 1，安装node.js，方法很简单，自己搜索
### 2，下载本仓库
- 在backend目录找到`.env--示例`文件，修改文件名为`.env`，打开输入你的api
### 3，安装及运行
- 在backend目录下运行命令
- 初始化项目
```
npm init -y

npm install express multer @google/generative-ai dotenv cors
```
- 启动程序服务
```
node server.js
```
- 如果没报错的话
- 浏览器可以打开http + 你的IP + 端口，就能访问了
### 4，其他事项
- #### 在公网服务器强烈建议反代，加上https反代并设置访问密码
- #### 不能访问谷歌的地区
- 初始化项目后有一个node_modules目录，找到/@google/generative-ai/dist/index.js和index.mjs两个文件，打开文件找到这个地址`https://generativelanguage.googleapis.com`  
替换为代理地址，可以在cloudflare worker上免费自建  
个人测试地址`https://d1lfw6t6n44mws.cloudfront.net`不长期维护，浏览器打开能显示404就说明还可以用