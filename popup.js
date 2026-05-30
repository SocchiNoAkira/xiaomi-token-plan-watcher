// ============================================================
// Popup 脚本 - 弹窗 UI 逻辑
// 职责：读取存储数据 → 渲染UI → 交互刷新
// ============================================================

const CIRCUMFERENCE = 2 * Math.PI * 60; // r=60 → 约 377

// ---------- 存储读取（内联，避免模块加载问题） ----------
const STORAGE_KEY = 'tokenPlan_latest';
const STALE_MS = 10 * 60 * 1000;

async function loadLatest() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || null;
}

async function isStale() {
  const latest = await loadLatest();
  if (!latest) return true;
  return Date.now() - latest.cachedAt > STALE_MS;
}

// ---------- 格式化数字（K/M/B缩写） ----------
function formatNumber(n) {
  if (n == null || isNaN(n)) return '--';
  n = Number(n);
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toFixed(2);
}

// ---------- 格式化剩余时间 ----------
function formatRemaining(planEndTime) {
  if (!planEndTime) return '--';

  const now = Date.now();
  const end = new Date(planEndTime).getTime();
  const diffMs = end - now;

  if (diffMs <= 0) return '已到期';

  const days = Math.floor(diffMs / (24 * 3600 * 1000));
  const hours = Math.floor((diffMs % (24 * 3600 * 1000)) / (3600 * 1000));

  if (days > 30) {
    const months = Math.floor(days / 30);
    return `${months} 月 ${days % 30} 天`;
  }
  if (days > 0) return `${days} 天 ${hours} 时`;
  return `${hours} 小时`;
}

// ---------- 更新时间文本 ----------
function formatUpdateTime(timestamp) {
  if (!timestamp) return '--';
  const d = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ---------- 渲染UI ----------
function render(data, isFromCache) {
  const {
    totalTokens,
    usedTokens,
    remainingTokens,
    lastHourUsage,
    planEndTime,
    planName,
    timestamp,
  } = data || {};

  // 套餐名称
  byId('planName').textContent = planName || '--';

  // 数字
  byId('totalTokens').textContent     = formatNumber(totalTokens);
  byId('remainingTokens').textContent = formatNumber(remainingTokens);
  byId('lastHourUsage').textContent   = formatNumber(lastHourUsage);
  byId('planRemaining').textContent   = formatRemaining(planEndTime);
  byId('usedTokens').textContent      = formatNumber(usedTokens);

  // 进度条 & 圆环
  const pct = totalTokens > 0 ? Math.min((usedTokens / totalTokens) * 100, 100) : 0;
  byId('usagePercent').textContent = pct.toFixed(1) + '%';
  byId('usageBarFill').style.width = pct + '%';

  const offset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;
  const fillEl = byId('progressFill');
  fillEl.style.strokeDashoffset = offset;

  // 用量告警变色
  if (pct >= 90) {
    fillEl.style.stroke = '#ef4444';
    byId('usageBarFill').style.background = 'linear-gradient(90deg, #ef4444, #dc2626)';
  } else if (pct >= 75) {
    fillEl.style.stroke = '#f59e0b';
    byId('usageBarFill').style.background = 'linear-gradient(90deg, #f59e0b, #d97706)';
  } else {
    fillEl.style.stroke = '#3b82f6';
    byId('usageBarFill').style.background = 'linear-gradient(90deg, #3b82f6, #2563eb)';
  }

  // 更新时间
  byId('updateTime').textContent = '更新于 ' + formatUpdateTime(timestamp);

  // 缓存标记
  const badge = byId('cacheBadge');
  badge.style.display = isFromCache ? 'inline' : 'none';

  // 状态指示灯
  const dot = byId('statusDot');
  dot.className = 'status-dot';
  if (!data) {
    dot.classList.add('offline');
  } else if (isFromCache) {
    dot.classList.add('stale');
  } else {
    dot.classList.add('online');
  }

  // 隐藏错误
  byId('errorMsg').style.display = 'none';
}

// ---------- 显示错误 ----------
function showError(msg) {
  const el = byId('errorMsg');
  el.style.display = 'block';
  el.textContent = msg;
  byId('statusDot').className = 'status-dot offline';
}

// ---------- 核心：读取并渲染 ----------
async function loadAndRender() {
  const latest = await loadLatest();
  const stale = await isStale();

  if (!latest) {
    // 无任何数据
    render(null, false);
    showError('暂无数据，请稍后刷新');
    return;
  }

  const isFromCache = latest._fromCache || false;
  render(latest, isFromCache);

  if (isFromCache) {
    showError('页面抓取失败，当前显示为缓存数据');
  }
}

// ---------- 强制刷新 ----------
async function forceRefresh() {
  const btn = byId('refreshBtn');
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    const res = await chrome.runtime.sendMessage({ action: 'forceRefresh' });
    if (!res.success) {
      console.warn('强制刷新失败:', res.error);
    }
    // 等一小会确保 storage 已写入
    await sleep(300);
    await loadAndRender();
  } catch (e) {
    showError('刷新失败: ' + e.message);
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function byId(id) { return document.getElementById(id); }

// ---------- 入口 ----------
document.addEventListener('DOMContentLoaded', () => {
  loadAndRender();

  byId('refreshBtn').addEventListener('click', forceRefresh);
});

// 切回 popup 可见时刷新
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loadAndRender();
  }
});
