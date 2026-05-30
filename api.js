// ============================================================
// API 模块 - 调用 xiaomimimotokenplan 真实 API
// 职责：请求两个 JSON 接口 → 合并 → 重试/超时/降级
// ============================================================

const USAGE_URL  = 'https://platform.xiaomimimo.com/api/v1/tokenPlan/usage';
const DETAIL_URL = 'https://platform.xiaomimimo.com/api/v1/tokenPlan/detail';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 带重试的 API 请求（并行调用 usage + detail）
 */
async function fetchTokenPlanUsage() {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const [usageRes, detailRes] = await Promise.all([
        fetchWithTimeout(USAGE_URL, REQUEST_TIMEOUT_MS),
        fetchWithTimeout(DETAIL_URL, REQUEST_TIMEOUT_MS),
      ]);

      if (!usageRes.ok || !detailRes.ok) {
        const bad = !usageRes.ok ? usageRes : detailRes;
        if (bad.status === 401 || bad.status === 403) {
          const err = new Error('登录态已失效');
          err.needAuth = true;
          throw err;
        }
        throw new Error(`HTTP ${bad.status}: ${bad.statusText}`);
      }

      const [usageJson, detailJson] = await Promise.all([
        usageRes.json(),
        detailRes.json(),
      ]);

      const data = parseResponse(usageJson, detailJson);
      if (!data.totalTokens || data.totalTokens === 0) {
        throw new Error('API 返回数据无效：未找到用量字段');
      }

      return { success: true, data };

    } catch (err) {
      lastError = err;
      console.warn(`[API] 第 ${attempt}/${MAX_RETRIES} 次尝试失败:`, err.message);
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }

  // 如果所有重试都因认证失败，标记 needAuth
  if (lastError && lastError.needAuth) {
    return { success: false, error: lastError.message, needAuth: true };
  }
  return { success: false, error: lastError.message };
}

/**
 * 合并 usage + detail 两个接口为标准格式
 */
function parseResponse(usageJson, detailJson) {
  // --- usage 接口：用量数字 ---
  const usageData = usageJson.data || usageJson;
  const usage = usageData.usage || {};
  const items = usage.items || [];
  const planItem = items.find(i => i.name === 'plan_total_token') || items[0] || {};

  const total   = planItem.limit || 0;
  const used    = planItem.used  || 0;
  const percent = planItem.percent ?? usage.percent ?? null;

  // --- detail 接口：套餐名称 & 到期时间 ---
  const detailData = detailJson.data || detailJson;
  const planName = detailData.planName || 'Token Plan';
  let planEndTime = null;
  if (detailData.currentPeriodEnd) {
    const d = new Date(detailData.currentPeriodEnd);
    if (!isNaN(d.getTime())) planEndTime = d.toISOString();
  }

  console.log('[API] 解析成功:', { planName, total, used, percent, planEndTime });

  return {
    totalTokens: total,
    usedTokens: used,
    remainingTokens: total - used,
    planEndTime,
    planStartTime: null,
    planName,
    lastHourUsage: 0,
    usedPercent: percent != null ? percent * 100 : null,
    timestamp: Date.now(),
  };
}

export { fetchTokenPlanUsage, USAGE_URL, DETAIL_URL };
