// ============================================================
// 存储模块 - chrome.storage.local 封装
// 职责：读写缓存数据、历史记录管理、数据有效期校验
// ============================================================

const STORAGE_KEYS = {
  LATEST: 'tokenPlan_latest',       // 最新一次拉取数据
  HISTORY: 'tokenPlan_history',     // 历史记录数组（最近24小时）
  SETTINGS: 'tokenPlan_settings',   // 用户设置
};

const MAX_HISTORY_SIZE = 288;       // 最多保留 288 条（24h * 12次/h）
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 超过10分钟视为过期

// ---------- 写入最新数据 ----------
async function saveLatest(data) {
  const record = {
    ...data,
    cachedAt: Date.now(),
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.LATEST]: record });
  await appendHistory(record);
}

// ---------- 读取最新数据 ----------
async function loadLatest() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.LATEST);
  return result[STORAGE_KEYS.LATEST] || null;
}

// ---------- 追加历史记录（自动裁剪） ----------
async function appendHistory(record) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.HISTORY);
  let history = result[STORAGE_KEYS.HISTORY] || [];

  // 避免重复同一时间戳
  if (history.length > 0 && history[history.length - 1].cachedAt === record.cachedAt) {
    history[history.length - 1] = record;
  } else {
    history.push(record);
  }

  // 只保留最近 24 小时
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  history = history.filter(r => r.cachedAt >= cutoff);

  // 裁剪到最大长度
  if (history.length > MAX_HISTORY_SIZE) {
    history = history.slice(-MAX_HISTORY_SIZE);
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: history });
}

// ---------- 读取历史记录 ----------
async function loadHistory(hours = 24) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.HISTORY);
  const history = result[STORAGE_KEYS.HISTORY] || [];
  if (hours <= 0) return history;

  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return history.filter(r => r.cachedAt >= cutoff);
}

// ---------- 计算最近1小时用量 ----------
async function calcLastHourUsage() {
  const history = await loadHistory(1);
  if (history.length < 2) return 0;

  const oldest = history[0];
  const newest = history[history.length - 1];
  // 用已用量差值估算
  const used = (newest.usedTokens || 0) - (oldest.usedTokens || 0);
  return Math.max(0, used);
}

// ---------- 校验缓存是否过期 ----------
async function isStale() {
  const latest = await loadLatest();
  if (!latest) return true;
  return Date.now() - latest.cachedAt > STALE_THRESHOLD_MS;
}

// ---------- 清理全部数据 ----------
async function clearAll() {
  await chrome.storage.local.remove([
    STORAGE_KEYS.LATEST,
    STORAGE_KEYS.HISTORY,
    STORAGE_KEYS.SETTINGS,
  ]);
}

// ---------- 导出供 background.js 和 popup.js 使用 ----------
export {
  STORAGE_KEYS,
  saveLatest,
  loadLatest,
  loadHistory,
  calcLastHourUsage,
  isStale,
  clearAll,
};
