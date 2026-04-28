document.getElementById('openBtn')?.addEventListener('click', () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('main.html')
  });
  window.close();
});
