# Xiaomi Token Plan Monitor

一个 Chrome 浏览器扩展，实时监控 [Xiaomi MiMo API Open Platform](https://platform.xiaomimimo.com/) 的 Token Plan 用量。支持自动轮询、用量告警、到期提醒和历史数据缓存。

## 功能特性

- **实时数据面板**：弹窗展示已用/总量/剩余/百分比/最近1小时增量
- **套餐信息**：套餐名称、到期倒计时
- **定时轮询**：每 5 分钟后台自动拉取最新用量（可配置）
- **智能告警**：剩余 < 5% 或即将到期时弹出浏览器通知
- **缓存降级**：API 请求失败时自动回退到本地缓存
- **自动登录**：登录态失效时自动打开登录页面
- **历史追踪**：本地存储 24 小时内用量变化，计算 1 小时增量

## 安装

1. 下载或克隆本项目
2. 打开 Chrome，地址栏输入 `chrome://extensions`
3. 开启右上角 **「开发者模式」**
4. 点击 **「加载已解压的扩展程序」**
5. 选择项目文件夹，确认

加载后工具栏会出现蓝色 **T** 图标。

> **前提**：需先在浏览器中登录 [platform.xiaomimimo.com](https://platform.xiaomimimo.com/)。扩展通过浏览器 Cookie 自动鉴权。

## 使用方法

| 操作 | 说明 |
|------|------|
| 查看用量 | 点击工具栏蓝色 **T** 图标 |
| 手动刷新 | 弹窗内点击「立即刷新」按钮 |
| 自动轮询 | 后台每 5 分钟自动拉取，无需操作 |

### 弹窗界面

- **蓝色圆环**：已用 Token 数量 + 百分比进度
- **四宫格卡片**：总配额 / 剩余可用 / 最近1小时用量 / 套餐剩余时间
- **线性进度条**：>75% 变橙色，>90% 变红色
- **状态指示灯**：🟢 在线 / 🟡 缓存 / 🔴 离线
- **缓存标记**：API 失败时显示「缓存数据」徽章

## 目录结构

```
├── manifest.json     # 扩展清单 (Manifest V3)
├── background.js     # Service Worker：定时轮询 / 通知 / 告警
├── api.js            # API 模块：请求 usage + detail 接口，合并解析
├── storage.js        # 存储模块：chrome.storage.local 封装，历史记录管理
├── content.js        # Content Script：页面 DOM 数据提取（备用源）
├── popup.html        # 弹窗结构
├── popup.css         # 弹窗样式
├── popup.js          # 弹窗逻辑：读取存储 → 渲染 → 交互
└── icons/            # 扩展图标 (SVG)
```

## 架构

```
       ┌─────────────────┐
       │   usage API      │──→ 已用 / 总量 / 百分比
       │   detail API     │──→ 套餐名 / 到期时间
       └────────┬────────┘
                │ (每5分钟)
                ▼
       ┌────────────────┐
       │  background.js │──→ chrome.storage.local
       │  pollAndSave() │──→ chrome.notifications (告警)
       └───────┬────────┘
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
  popup.js  content.js   自动登录
  (用户可见) (页面采集)   (401时打开登录页)
```

### 数据流

1. `background.js` 每 5 分钟通过 `api.js` 并行调用 `usage` 和 `detail` 两个接口
2. `parseResponse()` 合并两接口结果为标准格式
3. 成功 → 写入 `chrome.storage.local`（latest + history），触发告警检查
4. 失败 → 读取本地缓存，标记 `_fromCache`
5. 401/403 → 自动打开登录页面
6. 用户打开弹窗 → `popup.js` 读存储 → 渲染 UI

## 可配置项

编辑 `background.js`：

```js
POLL_INTERVAL_MIN = 5;        // 轮询间隔（分钟）
EXHAUSTED_THRESHOLD = 0.05;   // 剩余低于 5% 告警
EXPIRY_WARN_DAYS = 3;         // 距到期 ≤ 3 天告警
EXPIRY_CRITICAL_DAYS = 1;     // 距到期 ≤ 1 天告警
```

编辑 `api.js`：

```js
const USAGE_URL  = '...';     // usage 接口地址
const DETAIL_URL = '...';     // detail 接口地址
REQUEST_TIMEOUT_MS = 15000;   // 请求超时（毫秒）
MAX_RETRIES = 3;              // 最大重试次数
```

## 技术栈

- Chrome Extension Manifest V3
- Service Worker (ES Module)
- chrome.storage.local
- chrome.alarms (定时任务)
- chrome.notifications (系统通知)
- chrome.tabs (登录页跳转)
- Vanilla JavaScript (无框架依赖)

## License

MIT
