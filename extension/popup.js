/**
 * ApiFix Bin - Popup Script
 * 点击图标时打开完整的API调试页面
 */

// 在新标签页中打开主界面
chrome.tabs.create({
  url: chrome.runtime.getURL('main.html')
});

// 关闭popup
window.close();
