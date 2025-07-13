const http = require('http');
const https = require('https');
const url = require('url');

const proxyPort = 3100;
const targetHost = 'generativelanguage.googleapis.com';
const targetProtocol = 'https:'; 

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url);
  const options = {
    hostname: targetHost,
    port: 443, 
    path: parsedUrl.path,
    method: req.method,
    headers: {
      ...req.headers,
      host: targetHost,
    },
    //  rejectUnauthorized: true // 默认值，验证证书的有效性
  };

  // 删除一些可能导致问题的头部
  delete options.headers['proxy-connection'];
  delete options.headers['connection'];
  delete options.headers['transfer-encoding'];

  const proxyRequest = https.request(options, (proxyResponse) => {
    if (proxyResponse.statusCode === 404) {
      //返回 404，直接返回 404 给客户端
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    } else {
      //返回其他状态码，转发响应头和内容
      res.writeHead(proxyResponse.statusCode, proxyResponse.headers);
      proxyResponse.pipe(res); // 直接管道传输数据
    }
  });

  proxyRequest.on('error', (err) => {
    console.error('Proxy request error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  });

  // 将客户端请求的数据管道传输到generativelanguage.googleapis.com
  req.pipe(proxyRequest);
});

server.on('error', (err) => {
  console.error('Server error:', err);
});

server.listen(proxyPort, '127.0.0.1', () => {
  console.log(`Proxy server listening on http://127.0.0.1:${proxyPort}`);
});
