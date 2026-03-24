# RouteLab（中文说明）

> 面向新手的 RouteLab 项目中文文档。本文专注“从 0 到能跑”。

## 目录

- [1. 项目是什么](#1-项目是什么)
- [2. 你会得到什么](#2-你会得到什么)
- [3. 项目结构速览](#3-项目结构速览)
- [4. 本地跑通（小程序）](#4-本地跑通小程序)
- [5. 本地跑通（后端 API）](#5-本地跑通后端-api)
- [6. 本地跑通（Web 管理端）](#6-本地跑通web-管理端)
- [7. 关键配置说明](#7-关键配置说明)
- [8. 上传与同步链路（重点）](#8-上传与同步链路重点)
- [9. 部署前检查清单](#9-部署前检查清单)
- [10. 常见报错排查](#10-常见报错排查)
- [11. 下一步优化建议](#11-下一步优化建议)

---

## 1. 项目是什么

RouteLab 是一个微信小程序项目，核心能力是：

- 记录运动轨迹（步行/跑步/骑行）
- 基于定位与传感器做活动识别
- 轨迹正式保存以云端成功为准，本地仅作失败兜底暂存
- 提供后台管理端做审核、导出与统计

---

## 2. 你会得到什么

跑通后，你会有三部分：

1. **小程序端**：用户记录轨迹、看历史、上传图片
2. **后端 API**：登录鉴权、轨迹存储、天气与地理编码代理
3. **Web 管理端**：管理用户和轨迹数据

---

## 3. 项目结构速览

```text
routelab/
├── app.js / app.json            # 小程序入口
├── pages/                       # 小程序页面
├── services/                    # 核心业务逻辑
├── utils/                       # 工具函数
├── config/                      # 小程序配置
├── cloud/
│   ├── server/                  # Express + PostgreSQL
│   ├── web/                     # React + Vite 管理后台
│   ├── nginx/                   # 反向代理配置
│   ├── scripts/                 # init.sql
│   └── docker-compose.yml       # 一键启动
├── README.md                    # 中英双语总文档
└── README_zh.md                 # 本文档（纯中文）
```

---

## 4. 本地跑通（小程序）

### 步骤 1：克隆仓库

```bash
git clone git@github.com:wannaqueen66-create/routelab.git
cd routelab
```

### 步骤 2：用微信开发者工具导入项目

- 选择仓库根目录
- 等待依赖与项目索引完成

### 步骤 3：检查配置

打开 `config/saaa-config.js`，重点看：

- `api.baseUrl`：后端接口地址
- `api.uploadEndpoint`：应为 `/upload`（最终请求会是 `/api/upload`）
- `api.staticBase`：上传文件访问前缀

### 步骤 4：编译运行

- 先在模拟器跑通
- 再进行真机调试（真机要注意合法域名与 HTTPS）

---

## 5. 本地跑通（后端 API）

### 步骤 1：进入后端目录

```bash
cd cloud/server
```

### 步骤 2：准备环境变量

```bash
cp .env.example .env
```

至少要配：

- `DATABASE_URL`
- `JWT_SECRET`
- `WECHAT_APPID`
- `WECHAT_SECRET`

### 步骤 3：安装并启动

```bash
npm install
npm run dev
```

### 步骤 4：健康检查

```text
GET /api/ping
```

返回 `{"status":"ok"...}` 说明后端已启动。

---

## 6. 本地跑通（Web 管理端）

### 步骤 1：进入目录

```bash
cd cloud/web
```

### 步骤 2：准备环境变量

```bash
cp .env.example .env
```

### 步骤 3：启动

```bash
npm install
npm run dev
```

默认 Vite 地址一般是 `http://localhost:5173`。

---

## 7. 关键配置说明

### 小程序端（`config/saaa-config.js`）

- `api.baseUrl`：统一 API 根地址
- `api.uploadEndpoint`：推荐固定 `/upload`
- `api.retries`：请求重试次数

小程序端本地配置建议收敛为**最小公开配置**，不要把任何敏感信息放进前端：

```bash
cp config/saaa-config.local.example.js config/saaa-config.local.js
```

最小示例：

```js
module.exports = {
  apiBaseUrl: 'https://routelab.qzz.io/api',
  api: {
    baseUrl: 'https://routelab.qzz.io/api',
    staticBase: 'https://routelab.qzz.io/static/uploads',
  },
};
```

说明：
- 小程序端只保留公开 URL。
- `JWT_SECRET`、数据库密码、微信 Secret、管理员密码等私密信息必须只放在云端。
- 可选公共配置下发接口：`GET /api/public/config`

### 云端（`cloud/.env`）

- `POSTGRES_PASSWORD`：数据库密码
- `JWT_SECRET`：token 签名密钥
- `STORAGE_BASE_URL`：上传资源公开访问前缀
- `ADMIN_USER` / `ADMIN_PASSWORD(_HASH)`：后台登录

---

## 8. 上传与同步链路（重点）

### 上传链路

- 小程序 `services/media.js` 调用上传
- 上传 endpoint 配置为 `/upload`
- 通过 URL 组装后最终请求 `/api/upload`

即：

```text
https://your-domain.example/api/upload
```

### 同步链路

- 轨迹正式保存以云端写入成功为准
- 如果云端写入失败，小程序会把轨迹仅作为本地暂存保留，并标记为待后续同步
- 下行同步通过 `/api/routes/sync` 拉取变更
- 对已删除/缺失远端记录进行本地墓碑处理，避免重复上传
- 本地缓存（天气、地理编码、页面状态、主题偏好等）不作为云端主数据同步，避免增加系统负担

---

## 9. 部署前检查清单

上线前逐项确认：

- [ ] 域名与 HTTPS 正常
- [ ] `JWT_SECRET` 已替换强随机值
- [ ] PostgreSQL 已初始化并连通
- [ ] `STORAGE_BASE_URL` 指向真实可访问地址
- [ ] 微信 AppID/Secret 已正确配置
- [ ] 上传链路已确认走 `/api/upload`
- [ ] 管理员账号已设置强密码/哈希
- [ ] 地图/天气 key 不再硬编码，已通过环境变量注入

---

## 10. 常见报错排查

### 1）上传失败

优先检查：

- endpoint 是否正确（应到 `/api/upload`）
- token 是否存在且未过期
- 小程序合法域名是否配置
- `STORAGE_BASE_URL` 是否正确

### 2）真机能登录但拉不到数据

- 检查后端日志
- 检查 DB 连接
- 检查 `/api/routes` 的鉴权头是否带上

### 3）页面显示乱码

- 检查数据库编码与连接编码是否为 UTF-8
- 检查接口响应 `Content-Type` 是否为 `application/json; charset=utf-8`

---

## 11. 开发检查流程（提交前）

建议每次提交前在仓库根目录执行：

```bash
npm run check
```

当前会执行：

- JS 语法 lint 检查
- 后端 smoke test（含 `/api/ping`、`/api/routes` 鉴权、`/api/upload`、`/api/routes/sync`）
- Web 工具函数测试（`gcj02ToWgs84`）

CI 已接入 GitHub Actions，配置文件：

```text
.github/workflows/ci.yml
```

当你 push 或提 PR 到 `main` 时，会自动跑同一套检查。

## 12. 许可证（禁止商用）

本项目采用 **PolyForm Noncommercial 1.0.0** 许可证，默认禁止商用。

- 允许：学习、研究、个人非商业使用
- 禁止：未授权商业部署、对外收费服务、商业再分发
- 商用授权：需联系版权方取得书面许可

详见仓库根目录 `LICENSE`。

## 13. 下一步优化建议

建议按优先级推进：

1. **P1（持续）**：继续补关键 API 测试覆盖（尤其 sync 链路）
2. **P2（下周）**：增加 lint/type-check，完善前端构建门禁
3. **长期**：配置分层（dev/staging/prod）+ 监控告警

---

如果你是刚接手这个项目，建议先按本文跑通三个端（小程序、API、Web），再开始改功能。
