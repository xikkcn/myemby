// preload.js
window.addEventListener('DOMContentLoaded', () => {
  console.log('DOM 已完全加载和解析');
  
  // 检查是否存在 root 元素
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    console.error('找不到 root 元素');
  } else {
    console.log('找到 root 元素');
  }

  // 全局错误处理
  window.addEventListener('error', (event) => {
    console.error('捕获到全局错误:', event.error);
  });

  // 设置全局变量，以便在渲染进程中使用
  window.electronAPI = {
    isElectron: true,
    platform: process.platform
  };
}); 