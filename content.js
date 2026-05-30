// ============================================================
// Content Script - 在 plan-manage 页面自动提取 DOM 数据
// 职责：页面加载后从 DOM 提取用量，发送给 background
// ============================================================

console.log('[Content] 已注入页面，开始监听数据...');

// 去掉数字中的逗号
function parseNum(str) {
  return parseInt(str.replace(/,/g, '').trim(), 10) || 0;
}

// 从 DOM 提取数据
function extractData() {
  const data = {
    usedTokens: 0,
    totalTokens: 0,
    remainingTokens: 0,
    planEndTime: null,
    planName: 'Token Plan',
    usedPercent: null,
    timestamp: Date.now(),
    source: 'dom',
  };

  // 1) 用量数据：查找包含 "数字 / 数字" 的 usageFigure 元素
  const usageEl = document.querySelector('[class*="usageFigure"]');
  if (usageEl) {
    const title = usageEl.getAttribute('title') || usageEl.textContent || '';
    const parts = title.split('/');
    if (parts.length === 2) {
      data.usedTokens = parseNum(parts[0]);
      data.totalTokens = parseNum(parts[1]);
      data.remainingTokens = data.totalTokens - data.usedTokens;
    }
  }

  // 2) 百分比
  const percentEl = document.querySelector('[class*="percentLabel"]');
  if (percentEl) {
    const match = percentEl.textContent.match(/([\d.]+)\s*%/);
    if (match) data.usedPercent = parseFloat(match[1]);
  }

  // 3) 到期时间：查找包含"有效期至"的元素
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    const text = el.textContent || '';
    const expiryMatch = text.match(/有效期至\s*(\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2})/);
    if (expiryMatch) {
      const d = new Date(expiryMatch[1]);
      if (!isNaN(d.getTime())) {
        data.planEndTime = d.toISOString();
        break;
      }
    }
  }

  // 4) 套餐名称：尝试获取页面标题或 heading
  const h1 = document.querySelector('h1, h2');
  if (h1) {
    const text = h1.textContent.trim();
    if (text && text.length < 50) data.planName = text;
  }

  return data;
}

// 发送数据到 background
function sendToBackground(data) {
  if (data.totalTokens === 0) {
    console.warn('[Content] 未提取到有效数据，可能页面尚未渲染完成');
    return;
  }

  console.log('[Content] 提取到数据:', data);
  chrome.runtime.sendMessage({
    action: 'dataFromPage',
    data: data,
  }).catch(err => console.warn('[Content] 发送失败:', err));
}

// 策略1：页面加载完成后立即提取
if (document.readyState === 'complete') {
  setTimeout(() => sendToBackground(extractData()), 3000);
} else {
  window.addEventListener('load', () => {
    setTimeout(() => sendToBackground(extractData()), 3000);
  });
}

// 策略2：监听 DOM 变化，当数据出现时自动提取
let observer = null;
let extractAttempts = 0;

function startObserver() {
  observer = new MutationObserver(() => {
    const el = document.querySelector('[class*="usageFigure"]');
    if (el) {
      sendToBackground(extractData());
      observer.disconnect();
      observer = null;
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

// 如果页面还没渲染完，启动 MutationObserver
if (!document.querySelector('[class*="usageFigure"]')) {
  startObserver();
}

// 定期检查（最多 10 次，每次间隔 2 秒）
const intervalId = setInterval(() => {
  extractAttempts++;
  const el = document.querySelector('[class*="usageFigure"]');
  if (el) {
    sendToBackground(extractData());
    clearInterval(intervalId);
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  } else if (extractAttempts >= 10) {
    console.warn('[Content] 超时未找到用量数据');
    clearInterval(intervalId);
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }
}, 2000);
