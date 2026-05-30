// ============================================================
// 后台 Service Worker - 定时轮询 & 通知
// 职责：
//  1. 每 5 分钟自动拉取 API 数据
//  2. 失败时回退到本地缓存
//  3. 触发告警通知（用量耗尽 / 即将到期）
// ============================================================

import { fetchTokenPlanUsage } from './api.js';
import {
  saveLatest,
  loadLatest,
  calcLastHourUsage,
  isStale,
} from './storage.js';

// ----- 可配置常量 -----
const POLL_INTERVAL_MIN = 5;            // 轮询间隔（分钟）
const ALARM_NAME = 'tokenPlanPoll';

const EXHAUSTED_THRESHOLD = 0.05;       // 剩余低于 5% 告警
const EXPIRY_WARN_DAYS = 3;             // 距到期 <= 3 天告警
const EXPIRY_CRITICAL_DAYS = 1;         // 距到期 <= 1 天告警

// ----- 安装 / 启动 -----
chrome.runtime.onInstalled.addListener(() => {
  console.log('[BG] 插件已安装，启动定时轮询');
  startPolling();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[BG] 浏览器启动，恢复轮询');
  startPolling();
});

// ----- 定时轮询 -----
function startPolling() {
  // 先立即执行一次
  pollAndSave();

  // 创建定时 Alarm
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_INTERVAL_MIN });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    pollAndSave();
  }
});

// ----- 核心：API 拉取 → 存储 → 告警 -----
let _loginTabOpened = false;  // 防止重复打开登录页

async function pollAndSave() {
  console.log('[BG] 开始轮询...');

  const result = await fetchTokenPlanUsage();

  if (result.success) {
    _loginTabOpened = false;  // 成功则重置
    const data = result.data;
    data.lastHourUsage = await calcLastHourUsage();
    await saveLatest(data);
    console.log('[BG] API 拉取成功', data);
    await checkAndNotify(data);
  } else {
    console.warn('[BG] API 拉取失败:', result.error);

    // 登录态失效 → 打开登录页（一次失败周期只开一次）
    if (result.needAuth && !_loginTabOpened) {
      _loginTabOpened = true;
      chrome.tabs.create({ url: 'https://platform.xiaomimimo.com/' });
      console.log('[BG] 已自动打开登录页面');
    }

    const cached = await loadLatest();
    if (cached) {
      console.log('[BG] 使用缓存数据（', new Date(cached.cachedAt).toLocaleTimeString(), '）');
      cached._fromCache = true;
      await saveLatest(cached);
    } else {
      console.warn('[BG] 无缓存可用');
    }
  }
}

// ----- 告警判定 -----
async function checkAndNotify(data) {
  const { remainingTokens, totalTokens, planEndTime, planName } = data;
  const now = Date.now();

  // --- 1. 用量耗尽告警 ---
  const ratio = totalTokens > 0 ? remainingTokens / totalTokens : 1;
  if (ratio <= EXHAUSTED_THRESHOLD) {
    chrome.notifications.create('exhausted', {
      type: 'basic',
      iconUrl: 'icons/icon128.svg',
      title: 'Token 配额即将耗尽',
      message: `${planName} 剩余 ${remainingTokens.toLocaleString()} / ${totalTokens.toLocaleString()} (${(ratio * 100).toFixed(1)}%)`,
      priority: 2,
    });
  }

  // --- 2. 套餐到期告警 ---
  if (planEndTime) {
    const remainingMs = new Date(planEndTime).getTime() - now;
    const remainingDays = remainingMs / (1000 * 60 * 60 * 24);

    if (remainingDays <= EXPIRY_CRITICAL_DAYS && remainingDays > 0) {
      chrome.notifications.create('expiry-critical', {
        type: 'basic',
        iconUrl: 'icons/icon128.svg',
        title: '套餐即将到期',
        message: `${planName} 还剩 ${remainingDays.toFixed(1)} 天到期`,
        priority: 2,
      });
    } else if (remainingDays <= EXPIRY_WARN_DAYS && remainingDays > 0) {
      chrome.notifications.create('expiry-warn', {
        type: 'basic',
        iconUrl: 'icons/icon128.svg',
        title: '套餐即将到期提醒',
        message: `${planName} 还剩 ${remainingDays.toFixed(1)} 天到期`,
        priority: 1,
      });
    }
  }
}

// ----- 监听消息（popup + content script） -----
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'forceRefresh') {
    pollAndSave().then(() => {
      sendResponse({ success: true });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (request.action === 'dataFromPage') {
    const data = request.data;
    console.log('[BG] 收到 content script 数据:', data);
    (async () => {
      data.lastHourUsage = await calcLastHourUsage();
      await saveLatest(data);
      await checkAndNotify(data);
    })();
    // 不需要 sendResponse（content script 不等待回应）
  }
});
