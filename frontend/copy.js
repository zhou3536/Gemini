function copycode() {
    // 获取所有class为message的元素
    const messageElements = document.querySelectorAll('.message');
  
    messageElements.forEach(messageElement => {
      // 获取每个message元素下的pre元素
      const preElements = messageElement.querySelectorAll('pre');
  
      preElements.forEach(preElement => {
        // 创建复制按钮
        const copyButton = document.createElement('button');
        // copyButton.textContent = 'Copy';
        copyButton.classList.add('copy-button'); // 添加一个类，方便您自定义样式
  
        // 添加点击事件监听器
        copyButton.addEventListener('click', () => {
          // 获取pre元素内的所有文本，去除 HTML 标签
          const textToCopy = preElement.textContent;
          // 调用复制到剪贴板函数
          copyToClipboard(textToCopy);
        });
  
        // 将按钮添加到pre元素之后
        // preElement.parentNode.insertBefore(copyButton, preElement.nextSibling);  // 在pre元素之后插入
        // preElement.appendChild(copyButton);
        preElement.parentNode.insertBefore(copyButton, preElement);
      });
    });
  
    // 复制到剪贴板的函数
    function copyToClipboard(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        // 现代浏览器推荐使用 Clipboard API
        navigator.clipboard.writeText(text)
          .then(() => {
            console.log('Text copied to clipboard'); // 可选的成功日志
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
  
  // 在页面加载完成后调用该函数
//   window.addEventListener('load', addCopyButtonToMessages);
  