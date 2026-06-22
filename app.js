/**
 * Token Plan 用量查询（GLM / Kimi / MiniMax）
 *
 * 参考 cc-switch 的 coding_plan.rs 实现：
 * - GLM：api.z.ai/api/monitor/usage/quota/limit，Authorization 直接传 Key
 * - Kimi：api.kimi.com/coding/v1/usages，Authorization: Bearer <key>
 * - MiniMax：{api.minimaxi.com|api.minimax.io}/v1/api/openplatform/coding_plan/remains，Authorization: Bearer <key>
 */

const TIER_LABELS = {
  five_hour: "5 小时用量",
  weekly_limit: "周用量",
};

const PROVIDERS = {
  glm: {
    id: "glm",
    name: "智谱 GLM",
    website: "https://open.bigmodel.cn",
    endpoint: "https://api.z.ai/api/monitor/usage/quota/limit",
    testEndpoint: "https://api.z.ai/api/monitor/usage/quota/limit",
    proxyHost: "api.z.ai",
    authPrefix: "",
    defaultHeaders: {
      "Accept-Language": "en-US,en",
      Accept: "application/json",
    },
  },
  kimi: {
    id: "kimi",
    name: "Kimi For Coding",
    website: "https://api.kimi.com/coding",
    endpoint: "https://api.kimi.com/coding/v1/usages",
    testEndpoint: "https://api.moonshot.cn/v1/models",
    proxyHost: "api.kimi.com",
    authPrefix: "Bearer ",
    defaultHeaders: {
      Accept: "application/json",
    },
  },
  "minimax-cn": {
    id: "minimax-cn",
    name: "MiniMax 中国站",
    website: "https://api.minimaxi.com",
    endpoint: "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains",
    testEndpoint: "https://api.minimaxi.com/v1/models",
    proxyHost: "api.minimaxi.com",
    authPrefix: "Bearer ",
    defaultHeaders: {
      "Content-Type": "application/json",
    },
  },
  "minimax-en": {
    id: "minimax-en",
    name: "MiniMax 国际站",
    website: "https://api.minimax.io",
    endpoint: "https://api.minimax.io/v1/api/openplatform/coding_plan/remains",
    testEndpoint: "https://api.minimax.io/v1/models",
    proxyHost: "api.minimax.io",
    authPrefix: "Bearer ",
    defaultHeaders: {
      "Content-Type": "application/json",
    },
  },
};

// 判断当前是否通过本地代理服务访问
const IS_LOCAL_SERVER =
  location.hostname === "localhost" || location.hostname === "127.0.0.1";

// ── 通用工具 ───────────────────────────────────────────────

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function utilizationLevel(value) {
  if (value >= 90) return "high";
  if (value >= 70) return "medium";
  return "low";
}

function formatResetTime(isoString) {
  if (!isoString) return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;

  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return "即将重置";

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days} 天 ${hours % 24} 小时后重置`;
  }
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分钟后重置`;
  }
  return `${minutes} 分钟后重置`;
}

function millisToIso8601(ms) {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function extractResetTime(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value;
    return millisToIso8601(ms);
  }
  return null;
}

function mapTierName(limitType) {
  const type = String(limitType).toUpperCase();
  if (type === "TOKENS_LIMIT") return "five_hour";
  if (type === "WEEKLY_TOKENS_LIMIT" || type === "WEEK_TOKENS_LIMIT") return "weekly_limit";
  return null;
}

function makeTier(name, utilization, resetsAt, counts) {
  return {
    name,
    label: TIER_LABELS[name] || name,
    utilization: Math.max(0, Math.min(100, utilization)),
    resetsAt,
    counts,
  };
}

// ── 各供应商响应解析 ───────────────────────────────────────

function parseGlmQuota(body) {
  console.log("[GLM Response]", JSON.stringify(body, null, 2));

  if (body?.success === false) {
    throw new Error(body?.msg || "API 返回业务错误");
  }

  const data = body?.data;
  if (!data) throw new Error("响应中缺少 data 字段");

  const limits = data.limits;
  if (!Array.isArray(limits)) throw new Error("响应中缺少 limits 数组");

  const tiers = [];
  for (const item of limits) {
    const name = mapTierName(item.type);
    if (!name) continue;
    const utilization = typeof item.percentage === "number" ? item.percentage : 0;
    const resetsAt = extractResetTime(item.nextResetTime);
    tiers.push(makeTier(name, utilization, resetsAt));
  }

  if (tiers.length === 0) throw new Error("未识别到可用额度信息");
  return { tiers, level: data.level };
}

function parseKimiQuota(body) {
  console.log("[Kimi Response]", JSON.stringify(body, null, 2));

  const tiers = [];

  if (Array.isArray(body.limits)) {
    for (const limitItem of body.limits) {
      const detail = limitItem?.detail;
      if (!detail) continue;

      const limit = parseNumber(detail.limit) ?? 1;
      const remaining = parseNumber(detail.remaining) ?? 0;
      const used = Math.max(0, limit - remaining);
      const utilization = limit > 0 ? (used / limit) * 100 : 0;
      const resetsAt = extractResetTime(detail.resetTime);

      tiers.push(makeTier("five_hour", utilization, resetsAt, { limit, used, remaining }));
    }
  }

  if (body.usage && typeof body.usage === "object") {
    const usage = body.usage;
    const limit = parseNumber(usage.limit) ?? 1;
    const usedRaw = parseNumber(usage.used);
    const remaining = parseNumber(usage.remaining) ?? 0;
    const used = usedRaw ?? Math.max(0, limit - remaining);
    const utilization = limit > 0 ? (used / limit) * 100 : 0;
    const resetsAt = extractResetTime(usage.resetTime);

    tiers.push(makeTier("weekly_limit", utilization, resetsAt, { limit, used, remaining }));
  }

  if (tiers.length === 0) throw new Error("未识别到可用额度信息");
  return { tiers, level: undefined };
}

function parseMinimaxQuota(body) {
  console.log("[MiniMax Response]", JSON.stringify(body, null, 2));

  if (body?.base_resp) {
    const statusCode = body.base_resp.status_code ?? body.base_resp.status ?? -1;
    if (statusCode !== 0) {
      throw new Error(body.base_resp.status_msg || `MiniMax 错误码 ${statusCode}`);
    }
  }

  const modelRemains = body?.model_remains;
  if (!Array.isArray(modelRemains) || modelRemains.length === 0) {
    const keys = body && typeof body === "object" ? Object.keys(body) : [];
    throw new Error(
      `响应中缺少 model_remains 数组。实际返回的顶层字段：${keys.join(", ") || "(空)"}`
    );
  }

  const item = modelRemains[0];
  const tiers = [];
  const modelName = item.model_name ? ` (${item.model_name})` : "";

  const intervalTotal = parseNumber(item.current_interval_total_count) ?? 0;
  const intervalRemainingCount = parseNumber(item.current_interval_usage_count) ?? 0;
  const intervalRemainingPercent = parseNumber(item.current_interval_remaining_percent);

  // 计算重置时间：优先用 end_time；如果 end_time 已过期且提供了 remains_time，则用当前时间 + remains_time
  function computeResetTime(endTime, remainsTime) {
    const end = extractResetTime(endTime);
    if (end) {
      const endMs = new Date(end).getTime();
      if (!Number.isNaN(endMs) && endMs > Date.now()) return end;
    }
    const remainsMs = parseNumber(remainsTime);
    if (remainsMs != null && remainsMs > 0) {
      return new Date(Date.now() + remainsMs).toISOString();
    }
    return end;
  }

  let intervalUtilization = null;
  let intervalCounts = null;
  if (intervalTotal > 0) {
    const intervalUsed = Math.max(0, intervalTotal - intervalRemainingCount);
    intervalUtilization = (intervalUsed / intervalTotal) * 100;
    intervalCounts = { limit: intervalTotal, used: intervalUsed, remaining: intervalRemainingCount };
  } else if (intervalRemainingPercent != null) {
    // total_count 为 0 时，用剩余百分比反推已用百分比
    intervalUtilization = Math.max(0, 100 - intervalRemainingPercent);
  }
  if (intervalUtilization != null) {
    tiers.push(makeTier(
      "five_hour",
      intervalUtilization,
      computeResetTime(item.end_time, item.remains_time),
      intervalCounts,
    ));
  }

  const weeklyTotal = parseNumber(item.current_weekly_total_count) ?? 0;
  const weeklyRemainingCount = parseNumber(item.current_weekly_usage_count) ?? 0;
  const weeklyRemainingPercent = parseNumber(item.current_weekly_remaining_percent);

  let weeklyUtilization = null;
  let weeklyCounts = null;
  if (weeklyTotal > 0) {
    const weeklyUsed = Math.max(0, weeklyTotal - weeklyRemainingCount);
    weeklyUtilization = (weeklyUsed / weeklyTotal) * 100;
    weeklyCounts = { limit: weeklyTotal, used: weeklyUsed, remaining: weeklyRemainingCount };
  } else if (weeklyRemainingPercent != null) {
    weeklyUtilization = Math.max(0, 100 - weeklyRemainingPercent);
  }
  if (weeklyUtilization != null) {
    tiers.push(makeTier(
      "weekly_limit",
      weeklyUtilization,
      computeResetTime(item.weekly_end_time, item.weekly_remains_time),
      weeklyCounts,
    ));
  }

  if (tiers.length === 0) throw new Error("未识别到可用额度信息");
  return { tiers, level: undefined, modelName };
}

function parseQuota(providerId, body) {
  switch (providerId) {
    case "glm":
      return parseGlmQuota(body);
    case "kimi":
      return parseKimiQuota(body);
    case "minimax-cn":
    case "minimax-en":
      return parseMinimaxQuota(body);
    default:
      throw new Error(`不支持的供应商：${providerId}`);
  }
}

// ── 网络请求 ───────────────────────────────────────────────

function resolveProviderId(providerOrUrl) {
  const value = String(providerOrUrl || "").toLowerCase();
  if (PROVIDERS[value]) return value;
  if (value.includes("kimi")) return "kimi";
  if (value.includes("minimaxi.com")) return "minimax-cn";
  if (value.includes("minimax.io")) return "minimax-en";
  if (value.includes("bigmodel.cn") || value.includes("z.ai")) return "glm";
  return null;
}

function getProvider(accountOrProviderId) {
  const id =
    typeof accountOrProviderId === "string"
      ? accountOrProviderId
      : resolveProviderId(accountOrProviderId?.provider || accountOrProviderId?.baseUrl);
  const provider = PROVIDERS[id];
  if (!provider) throw new Error("无法识别供应商");
  return provider;
}

async function apiRequest(account, endpointOverride) {
  const provider = getProvider(account);
  const apiKey = String(account.apiKey || "").trim();
  if (!apiKey) throw new Error("缺少 API Key");

  const endpoint = endpointOverride || account.endpoint || provider.endpoint;
  const authHeader = provider.authPrefix + apiKey;

  let url;
  let headers = {
    Authorization: authHeader,
    ...provider.defaultHeaders,
  };

  if (IS_LOCAL_SERVER) {
    // 走本地代理，保留路径并告知目标 Host
    const parsed = new URL(endpoint);
    url = parsed.pathname + parsed.search;
    headers["X-Target-Host"] = parsed.hostname;
  } else {
    // 直接请求（可能受浏览器 CORS 限制）
    url = endpoint;
  }

  console.log("[API Request]", {
    endpoint,
    url,
    targetHost: headers["X-Target-Host"] || new URL(endpoint).hostname,
    headers: {
      ...headers,
      Authorization: headers.Authorization.slice(0, 20) + "...",
    },
  });

  const response = await fetch(url, {
    method: "GET",
    headers,
  });

  const text = await response.text();

  if (!response.ok) {
    // 尝试从响应体中提取业务错误信息
    let msg = `HTTP ${response.status}`;
    try {
      const body = text ? JSON.parse(text) : {};
      msg = body?.msg || body?.message || body?.error?.message || body?.base_resp?.status_msg || msg;
    } catch {
      // 响应不是 JSON，保留 HTTP 状态码
      msg = `HTTP ${response.status}`;
    }

    if (response.status === 404) {
      msg += "（接口不存在，可能是 API Key 所属服务不正确，或账号无权限访问此接口）";
    } else if (response.status === 401 || response.status === 403) {
      msg += "（请检查 API Key 是否正确）";
    }

    throw new Error(`请求失败：${msg}`);
  }

  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`无法解析响应：${text.slice(0, 200)}`);
  }

  // 某些接口 HTTP 200 但业务码表示失败（如 Kimi 返回 code: 401）
  const businessError = extractBusinessError(body);
  if (businessError) {
    throw new Error(`请求失败：${businessError}`);
  }

  return body;
}

function extractBusinessError(body) {
  if (!body || typeof body !== "object") return null;

  // GLM 风格
  if (body.success === false && body.msg) {
    return body.msg;
  }

  // Kimi / 通用风格
  if (typeof body.code === "number" && body.code !== 0 && body.code !== 200) {
    return body.msg || `业务错误码 ${body.code}`;
  }

  // OpenAI 风格
  if (body.error) {
    return body.error.message || JSON.stringify(body.error);
  }

  // MiniMax base_resp 风格
  if (body.base_resp) {
    const statusCode = body.base_resp.status_code ?? body.base_resp.status ?? -1;
    if (statusCode !== 0) {
      return body.base_resp.status_msg || `MiniMax 错误码 ${statusCode}`;
    }
  }

  return null;
}

async function queryQuota(account) {
  const provider = getProvider(account);
  const body = await apiRequest(account);
  return parseQuota(provider.id, body);
}

async function testApiKey(account) {
  const provider = getProvider(account);
  const endpoint = account.testEndpoint || provider.testEndpoint;
  const body = await apiRequest(account, endpoint);

  const models = Array.isArray(body.data)
    ? body.data.map((m) => m.id).filter(Boolean)
    : Array.isArray(body.models)
      ? body.models.map((m) => m.id).filter(Boolean)
      : [];

  return { models, endpoint };
}

// ── 渲染 ───────────────────────────────────────────────────

function renderTiers(container, quota) {
  container.innerHTML = "";

  if (quota.modelName) {
    const modelNote = document.createElement("div");
    modelNote.className = "tier-meta";
    modelNote.style.marginBottom = "8px";
    modelNote.textContent = `模型：${quota.modelName}`;
    container.appendChild(modelNote);
  }

  for (const tier of quota.tiers) {
    const level = utilizationLevel(tier.utilization);
    const resetText = formatResetTime(tier.resetsAt);
    const counts = tier.counts;

    let countText = "";
    if (counts && typeof counts.limit === "number") {
      countText = ` · 额度 ${counts.limit}`;
      if (typeof counts.used === "number") {
        countText += ` / 已用 ${counts.used}`;
      }
      if (typeof counts.remaining === "number") {
        countText += ` / 剩余 ${counts.remaining}`;
      }
    }

    const card = document.createElement("div");
    card.className = "tier-card";
    card.innerHTML = `
      <div class="tier-header">
        <span class="tier-name">${escapeHtml(tier.label)}</span>
        <span class="tier-value ${level}">${Math.round(tier.utilization)}%</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill ${level}" style="width: ${Math.min(tier.utilization, 100)}%"></div>
      </div>
      <div class="tier-meta">
        已用 ${Math.round(tier.utilization)}% · 剩余 ${Math.round(Math.max(0, 100 - tier.utilization))}%
        ${countText}
        ${resetText ? `· ${escapeHtml(resetText)}` : ""}
      </div>
    `;
    container.appendChild(card);
  }

  if (quota.level) {
    const levelCard = document.createElement("div");
    levelCard.className = "tier-card";
    levelCard.style.opacity = "0.85";
    levelCard.innerHTML = `
      <div class="tier-header">
        <span class="tier-name">套餐等级</span>
        <span class="tier-value low">${escapeHtml(quota.level)}</span>
      </div>
      <div class="tier-meta">当前账号套餐等级</div>
    `;
    container.appendChild(levelCard);
  }
}

// ── 单个查询 ───────────────────────────────────────────────

const singleForm = document.getElementById("query-form");
const submitBtn = document.getElementById("submit-btn");
const singleBtnText = submitBtn.querySelector(".btn-text");
const singleSpinner = submitBtn.querySelector(".spinner");
const resultArea = document.getElementById("result-area");
const tierList = document.getElementById("tier-list");
const queryTime = document.getElementById("query-time");
const errorArea = document.getElementById("error-area");

function setSingleLoading(loading) {
  submitBtn.disabled = loading;
  singleBtnText.textContent = loading ? "查询中…" : "查询用量";
  singleSpinner.classList.toggle("hidden", !loading);
}

function hideSingleError() {
  resultArea.classList.add("hidden");
  errorArea.classList.add("hidden");
  errorArea.textContent = "";
}

function showError(message, detail = "") {
  errorArea.classList.remove("hidden");
  errorArea.innerHTML = `<strong>${escapeHtml(message)}</strong>${
    detail ? `<pre>${escapeHtml(detail)}</pre>` : ""
  }`;
}

const testKeyBtn = document.getElementById("test-key-btn");
const testKeyBtnText = testKeyBtn.querySelector(".btn-text");
const testKeySpinner = testKeyBtn.querySelector(".spinner");
const keyTestResult = document.getElementById("key-test-result");
const keyTestStatus = document.getElementById("key-test-status");
const keyTestDetail = document.getElementById("key-test-detail");

function setTestKeyLoading(loading) {
  testKeyBtn.disabled = loading;
  testKeyBtnText.textContent = loading ? "检测中…" : "检测 API Key";
  testKeySpinner.classList.toggle("hidden", !loading);
}

function showKeyTestResult(success, title, detailHtml) {
  keyTestResult.classList.remove("hidden", "success", "error");
  keyTestResult.classList.add(success ? "success" : "error");
  keyTestStatus.textContent = title;
  keyTestStatus.className = `key-test-status ${success ? "success" : "error"}`;
  keyTestDetail.innerHTML = detailHtml;
}

function hideKeyTestResult() {
  keyTestResult.classList.add("hidden");
  keyTestResult.classList.remove("success", "error");
  keyTestStatus.textContent = "";
  keyTestDetail.innerHTML = "";
}

testKeyBtn.addEventListener("click", async () => {
  hideKeyTestResult();

  const formData = new FormData(singleForm);
  const providerId = String(formData.get("provider") || "").trim();
  const testEndpoint = String(formData.get("endpoint") || "").trim();
  const apiKey = String(formData.get("apiKey") || "").trim();

  if (!apiKey) {
    showKeyTestResult(false, "检测失败", "请先输入 API Key");
    return;
  }

  setTestKeyLoading(true);

  try {
    const account = {
      provider: providerId,
      testEndpoint: testEndpoint || undefined,
      apiKey,
    };
    const { models, endpoint } = await testApiKey(account);

    if (models.length === 0) {
      showKeyTestResult(
        true,
        "Key 有效",
        `接口可连通，但未返回模型列表。<br><span class="test-endpoint">${escapeHtml(endpoint)}</span>`,
      );
      return;
    }

    const modelTags = models
      .slice(0, 20)
      .map((id) => `<span class="model-tag">${escapeHtml(id)}</span>`)
      .join("");
    const more = models.length > 20 ? `<span class="model-tag">+${models.length - 20}</span>` : "";

    showKeyTestResult(
      true,
      "Key 有效",
      `共 ${models.length} 个可用模型：<div class="model-list">${modelTags}${more}</div><span class="test-endpoint">${escapeHtml(endpoint)}</span>`,
    );
  } catch (error) {
    console.error("[Key Test]", error);
    showKeyTestResult(
      false,
      "检测失败",
      escapeHtml(error instanceof Error ? error.message : String(error)),
    );
  } finally {
    setTestKeyLoading(false);
  }
});

const providerSelect = document.getElementById("provider");
const endpointInput = document.getElementById("endpoint");
const batchEndpointInput = document.getElementById("batch-endpoint");

function syncEndpointInputs(providerId) {
  const provider = PROVIDERS[providerId];
  if (!provider) return;
  if (endpointInput) endpointInput.value = provider.endpoint;
  if (batchEndpointInput) batchEndpointInput.value = provider.endpoint;
}

providerSelect.addEventListener("change", () => {
  syncEndpointInputs(providerSelect.value);
});

// 初始化 endpoint 输入为当前选中供应商的默认接口
syncEndpointInputs(providerSelect.value);

singleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideSingleError();
  hideKeyTestResult();

  const formData = new FormData(singleForm);
  const providerId = String(formData.get("provider") || "").trim();
  const endpoint = String(formData.get("endpoint") || "").trim();
  const apiKey = String(formData.get("apiKey") || "").trim();

  if (!apiKey) {
    showError("请输入 API Key");
    return;
  }

  setSingleLoading(true);

  try {
    const account = { provider: providerId, endpoint: endpoint || undefined, apiKey };
    const quota = await queryQuota(account);
    renderTiers(tierList, quota);
    queryTime.textContent = `查询时间：${new Date().toLocaleString("zh-CN")}`;
    resultArea.classList.remove("hidden");
  } catch (error) {
    console.error("[Token Plan Query]", error);
    showError(
      error instanceof Error ? error.message : "查询失败",
      error instanceof Error && error.stack ? error.stack : "",
    );
  } finally {
    setSingleLoading(false);
  }
});

// ── 批量查询 ───────────────────────────────────────────────

const batchForm = document.getElementById("batch-form");
const batchSubmitBtn = document.getElementById("batch-submit-btn");
const batchBtnText = batchSubmitBtn.querySelector(".btn-text");
const batchSpinner = batchSubmitBtn.querySelector(".spinner");
const batchResultArea = document.getElementById("batch-result-area");
const batchResultList = document.getElementById("batch-result-list");
const batchQueryTime = document.getElementById("batch-query-time");
const configFileInput = document.getElementById("config-file");
const configFileName = document.getElementById("config-file-name");

configFileInput.addEventListener("change", () => {
  const file = configFileInput.files?.[0];
  if (file) {
    configFileName.textContent = file.name;
    configFileName.classList.add("has-file");
  } else {
    configFileName.textContent = "未选择文件";
    configFileName.classList.remove("has-file");
  }
});

function setBatchLoading(loading) {
  batchSubmitBtn.disabled = loading;
  batchBtnText.textContent = loading ? "查询中…" : "批量查询";
  batchSpinner.classList.toggle("hidden", !loading);
}

function hideBatchError() {
  batchResultArea.classList.add("hidden");
  errorArea.classList.add("hidden");
  errorArea.textContent = "";
}

const autoConfigStatus = document.getElementById("auto-config-status");
let autoLoadedAccounts = null;

function setAutoConfigStatus(type, message) {
  if (!autoConfigStatus) return;
  autoConfigStatus.classList.remove("hidden", "loaded", "error", "info");
  autoConfigStatus.classList.add(type);
  autoConfigStatus.textContent = message;
}

async function loadAutoConfig() {
  try {
    const response = await fetch("./config.json");
    if (!response.ok) {
      if (response.status === 404) {
        setAutoConfigStatus(
          "info",
          "未找到 config.json，可手动选择配置文件或创建该文件",
        );
      } else {
        setAutoConfigStatus("error", `读取 config.json 失败：HTTP ${response.status}`);
      }
      return;
    }

    const text = await response.text();
    const config = JSON.parse(text);
    if (!config || !Array.isArray(config.accounts)) {
      setAutoConfigStatus("error", "config.json 格式错误：缺少 accounts 数组");
      return;
    }

    autoLoadedAccounts = config.accounts;
    setAutoConfigStatus(
      "loaded",
      `已自动加载 config.json，共 ${autoLoadedAccounts.length} 个账号`,
    );

    // 可选：URL 带 ?auto=1 时自动开始批量查询
    if (new URLSearchParams(location.search).has("auto")) {
      batchSubmitBtn.click();
    }
  } catch (error) {
    console.error("[Auto Config]", error);
    setAutoConfigStatus(
      "info",
      "无法自动加载 config.json，可手动选择配置文件",
    );
  }
}

async function loadConfigFile(file) {
  const text = await file.text();
  const config = JSON.parse(text);
  if (!config || !Array.isArray(config.accounts)) {
    throw new Error("配置文件格式错误：缺少 accounts 数组");
  }
  return config.accounts;
}

function normalizeAccount(account) {
  const providerId = resolveProviderId(account.provider || account.baseUrl);
  if (!providerId) {
    throw new Error(`账号 "${account.name || "未命名"}" 无法识别供应商`);
  }
  return { ...account, provider: providerId };
}

async function queryAccount(account) {
  try {
    const normalized = normalizeAccount(account);
    const quota = await queryQuota(normalized);
    return { ok: true, quota, account: normalized };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      account,
    };
  }
}

function renderBatchResults(results) {
  batchResultList.innerHTML = "";

  for (const result of results) {
    const provider = getProvider(result.account);
    const card = document.createElement("div");
    card.className = `batch-account ${result.ok ? "" : "error"}`;

    const header = document.createElement("div");
    header.className = "batch-account-header";

    const name = document.createElement("span");
    name.className = "batch-account-name";
    name.textContent = result.account.name || "未命名账号";

    const meta = document.createElement("span");
    meta.className = "batch-account-status";
    meta.textContent = result.ok ? provider.name : `查询失败：${result.error}`;
    meta.classList.add(result.ok ? "success" : "error");

    header.appendChild(name);
    header.appendChild(meta);
    card.appendChild(header);

    if (result.ok) {
      const tiersContainer = document.createElement("div");
      tiersContainer.className = "tier-list";
      renderTiers(tiersContainer, result.quota);
      card.appendChild(tiersContainer);
    }

    batchResultList.appendChild(card);
  }
}

batchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideBatchError();

  let accounts;
  const file = configFileInput.files?.[0];

  if (file) {
    try {
      accounts = await loadConfigFile(file);
    } catch (error) {
      showError("配置文件读取失败", error instanceof Error ? error.message : String(error));
      return;
    }
  } else if (autoLoadedAccounts) {
    accounts = autoLoadedAccounts;
  } else {
    showError("请选择配置文件，或在目录下创建 config.json");
    return;
  }

  if (accounts.length === 0) {
    showError("配置文件中没有账号");
    return;
  }

  setBatchLoading(true);

  try {
    const results = await Promise.all(accounts.map((account) => queryAccount(account)));
    renderBatchResults(results);
    batchQueryTime.textContent = `查询时间：${new Date().toLocaleString("zh-CN")}`;
    batchResultArea.classList.remove("hidden");
  } catch (error) {
    console.error("[Token Plan Batch Query]", error);
    showError("批量查询失败", error instanceof Error ? error.message : String(error));
  } finally {
    setBatchLoading(false);
  }
});

// ── 标签页切换 ─────────────────────────────────────────────

const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".tab-panel");

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;

    tabs.forEach((t) => {
      t.classList.toggle("active", t === tab);
      t.setAttribute("aria-selected", String(t === tab));
    });

    panels.forEach((panel) => {
      panel.classList.toggle("active", panel.id === `${target}-panel`);
    });

    errorArea.classList.add("hidden");
    errorArea.textContent = "";
  });
});

// ── 高级模式 ───────────────────────────────────────────────

if (new URLSearchParams(location.search).has("advanced")) {
  document.body.classList.add("advanced-mode");
}

// ── 自动加载 config.json ───────────────────────────────────

loadAutoConfig();
