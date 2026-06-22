# Token Plan 用量查询网页

一个简化版前端网页，参考 [cc-switch](https://github.com/farion1231/cc-switch) 中查询国产 Token Plan 额度（GLM / Kimi / MiniMax）的实现。

支持查询：

- **5 小时用量**
- **周用量**

支持供应商：

- 智谱 GLM（`open.bigmodel.cn` / `api.z.ai`）
- Kimi For Coding（`api.kimi.com/coding`）
- MiniMax 中国站（`api.minimaxi.com`）
- MiniMax 国际站（`api.minimax.io`）

## 文件说明

```
glm-query-web/
├── index.html            # 页面入口
├── style.css             # 样式
├── app.js                # 查询逻辑
├── server.mjs            # 本地代理服务
├── Dockerfile            # Docker 镜像构建
├── docker-compose.yml    # Docker Compose 配置
├── config.example.json   # 批量查询配置示例
├── config.json           # 真实配置文件（从示例复制，勿提交到 Git）
├── .gitignore            # Git 忽略规则
└── README.md             # 本说明
```

## 使用方法

### 方式一：直接打开 HTML（可能受跨域限制）

1. 用浏览器直接打开 `index.html`。
2. 选择「单个查询」标签页，选择供应商，填入 API Key，点击「查询用量」。
3. 如果浏览器控制台提示 CORS 错误，请使用方式二。

### 方式二：启动本地代理服务（推荐）

```bash
cd glm-query-web
node server.mjs
```

然后打开 http://localhost:3456 即可使用。

本地服务会根据前端请求的 `X-Target-Host` 头，把 API 请求转发到对应的官方域名（`api.z.ai`、`api.kimi.com`、`api.minimaxi.com`、`api.minimax.io`），从而绕过浏览器跨域限制。

### 方式三：Docker 运行

```bash
cd glm-query-web
cp config.example.json config.json
# 编辑 config.json 填入真实 API Key
docker-compose up -d
```

然后打开 http://localhost:3456。

`config.json` 通过 volume 挂载到容器，修改后无需重建镜像。停止服务：

```bash
docker-compose down
```

### API Key 检测

在「单个查询」标签页输入 API Key 后，点击「检测 API Key」按钮，页面会尝试调用对应供应商的模型列表接口：

- 如果 Key 有效，会显示可用模型列表（最多 20 个）。
- 如果 Key 无效或服务不匹配，会显示具体错误。

这可以帮助你快速判断：
- Key 本身是否能用
- 你的 Key 是不是对应供应商的通用 API Key（例如 Kimi 的 Key 应能调用 `api.moonshot.cn/v1/models`，但不一定能调用 `api.kimi.com/coding/v1/usages` 的 Token Plan 额度接口）

### 批量查询

复制 `config.example.json` 为 `config.json`，填入多个账号：

```json
{
  "accounts": [
    {
      "name": "GLM 主账号",
      "provider": "glm",
      "baseUrl": "https://open.bigmodel.cn",
      "apiKey": "your-api-key-1"
    },
    {
      "name": "Kimi For Coding",
      "provider": "kimi",
      "baseUrl": "https://api.kimi.com/coding",
      "apiKey": "your-api-key-2"
    }
  ]
}
```

页面启动时会自动尝试读取同目录下的 `config.json`。如果存在，会显示「已自动加载 config.json，共 X 个账号」，直接点击「批量查询」即可。

也可以在 URL 后追加 `?auto=1`，页面加载后会自动开始批量查询。

`provider` 字段说明：

- `glm`：智谱 GLM
- `kimi`：Kimi For Coding
- `minimax-cn`：MiniMax 中国站
- `minimax-en`：MiniMax 国际站

也兼容旧的配置：如果不填 `provider`，会根据 `baseUrl` 自动推断供应商。

### 高级模式

在 URL 后追加 `?advanced=1` 可显示「查询接口」输入框，方便调试或切换接口地址。

## 实现参考

参考 cc-switch 后端实现：`src-tauri/src/services/coding_plan.rs`

| 供应商 | 接口 | 鉴权 |
|--------|------|------|
| GLM | `https://api.z.ai/api/monitor/usage/quota/limit` | `Authorization: <api_key>` |
| Kimi | `https://api.kimi.com/coding/v1/usages` | `Authorization: Bearer <api_key>` |
| MiniMax | `https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains` | `Authorization: Bearer <api_key>` |

- GLM 解析 `data.limits[]`，`TOKENS_LIMIT` 为 5 小时额度，`WEEKLY_TOKENS_LIMIT` 为周额度。
- Kimi 解析 `limits[].detail` 为 5 小时额度，`usage` 为周额度。
- MiniMax 解析 `model_remains[0]` 中的 `current_interval_*` 为 5 小时额度，`current_weekly_*` 为周额度。

## 安全提示

- `config.json` 包含真实 API Key，目录下 `.gitignore` 已将其排除，**请勿将其提交到 Git**。
- API Key 仅在浏览器本地使用，不会发送到除官方 API 以外的服务器。使用本地代理时，密钥也仅通过你的本机转发。
