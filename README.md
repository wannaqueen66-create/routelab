# RouteLab / 路迹实验室

> A WeChat Mini Program for campus route tracking, activity analysis, social interaction, and cloud synchronization.  
> 一个用于校园轨迹记录、运动分析、社交互动与云端同步的微信小程序。

## Table of Contents / 目录

- [1. Project Overview / 项目简介](#1-project-overview--项目简介)
- [2. Core Features / 核心功能](#2-core-features--核心功能)
- [3. Architecture / 技术架构](#3-architecture--技术架构)
- [4. Repository Structure / 仓库结构](#4-repository-structure--仓库结构)
- [5. Quick Start / 快速开始](#5-quick-start--快速开始)
- [6. Environment Configuration / 环境配置](#6-environment-configuration--环境配置)
- [7. Deployment / 部署说明](#7-deployment--部署说明)
- [8. Development Workflow / 开发流程](#8-development-workflow--开发流程)
- [9. API and Sync Notes / 接口与同步说明](#9-api-and-sync-notes--接口与同步说明)
- [10. Current Risks and TODOs / 当前风险与待优化项](#10-current-risks-and-todos--当前风险与待优化项)
- [11. FAQ / 常见问题](#11-faq--常见问题)
- [12. License / 许可](#12-license--许可)

## 1. Project Overview / 项目简介

**RouteLab** is a WeChat Mini Program focused on route recording and activity analytics in campus or outdoor scenarios. It combines location data, motion sensing, cloud APIs, and an admin dashboard to provide a full workflow from collection to review and management.

**RouteLab** 是一个面向校园/户外场景的微信小程序，核心能力包括轨迹记录、运动分析、云端同步与后台管理。项目把定位、传感器、服务端接口和 Web 管理后台串起来，形成一套完整的数据采集与管理链路。

### Typical scenarios / 典型场景

- Running / walking / riding route recording  
  跑步、步行、骑行轨迹记录
- Activity type inference and statistics  
  运动类型识别与统计
- Offline-first local storage with cloud sync  
  先本地存储，后云端同步
- Public route sharing, likes, comments, and admin review  
  公开轨迹分享、点赞评论、后台审核管理

## 2. Core Features / 核心功能

### Mini Program / 小程序端

- Background location tracking / 后台持续定位
- Motion-sensor-based activity inference / 基于传感器的运动识别
- Route history, detail view, and privacy control / 历史轨迹、详情页与隐私控制
- Weather snapshot and reverse geocoding / 天气快照与逆地理编码
- Photo upload and route attachment / 轨迹照片上传
- Offline cache + retry + cloud sync / 离线缓存、重试与云同步

### Cloud API / 云端接口

- WeChat login and token-based auth / 微信登录与 token 鉴权
- Route CRUD and incremental sync / 轨迹增删改查与增量同步
- Comments, likes, public route feed / 评论、点赞、公开路线
- Weather and geocode proxy / 天气与地理编码代理
- Admin dashboard data services / 管理后台数据接口

### Admin Dashboard / 管理后台

- User list and route management / 用户列表与路线管理
- Analytics summary / 数据分析汇总
- Backup utilities / 备份工具
- Export CSV / Excel / 导出 CSV 与 Excel

## 3. Architecture / 技术架构

```text
WeChat Mini Program
  ├─ pages/                 UI pages
  ├─ components/            reusable UI components
  ├─ services/              business logic and cloud API wrappers
  ├─ utils/                 storage, format, geo, permission helpers
  └─ config/                runtime configuration

Cloud Stack
  ├─ cloud/server/          Express + PostgreSQL API service
  ├─ cloud/web/             React + Vite admin dashboard
  ├─ cloud/nginx/           reverse proxy and static hosting
  └─ cloud/scripts/         database initialization SQL
```

### Main flow / 主链路

1. User starts tracking in the mini program  
   用户在小程序开始记录轨迹
2. Location + motion data are filtered and aggregated locally  
   定位与传感器数据先在本地进行过滤与聚合
3. Route data are stored locally and marked for sync  
   轨迹先写入本地并标记待同步
4. Cloud API receives route data and persists them to PostgreSQL  
   云端 API 接收并写入 PostgreSQL
5. Admin dashboard reads and manages the same dataset  
   管理后台读取并管理同一份数据

## 4. Repository Structure / 仓库结构

```text
routelab/
├── app.js                         # Mini program entry
├── app.json                       # Mini program global config
├── pages/                         # Mini program pages
├── components/                    # Shared components
├── services/                      # Core service layer
├── utils/                         # Utility functions
├── config/                        # Mini program config
├── constants/                     # Constant definitions
├── cloud/
│   ├── server/                    # Express backend
│   ├── web/                       # React admin dashboard
│   ├── nginx/                     # Nginx config
│   ├── scripts/                   # SQL bootstrap scripts
│   ├── docker-compose.yml         # Full cloud stack compose file
│   └── DEPLOYMENT.md              # Cloud deployment guide
└── README_zh.md                   # Chinese-only beginner guide
```

## 5. Quick Start / 快速开始

### 5.1 Prerequisites / 环境准备

Before you start, prepare the following:

在开始之前，请先准备：

- WeChat DevTools / 微信开发者工具
- Node.js 18+ for cloud services / 云端建议 Node.js 18+
- Docker + Docker Compose plugin (for server deployment) / 服务器部署建议 Docker + Compose
- PostgreSQL 16 (if not using Docker compose bundle) / 如不用 Docker 套件，需单独准备 PostgreSQL 16

### 5.2 Run the mini program locally / 本地运行小程序

1. Clone the repository:

   ```bash
   git clone git@github.com:wannaqueen66-create/routelab.git
   cd routelab
   ```

2. Open the project root in WeChat DevTools.  
   用微信开发者工具导入仓库根目录。

3. Check `config/saaa-config.js` and confirm the API base URL.  
   检查 `config/saaa-config.js` 中的小程序接口地址。

4. Compile and preview. For development-only debugging, you may temporarily disable domain validation in DevTools.  
   编译预览；如果是开发环境调试，可以临时关闭合法域名校验。

### 5.3 Run the cloud backend locally / 本地运行云端后端

1. Enter the backend directory:

   ```bash
   cd cloud/server
   ```

2. Create env file:

   ```bash
   cp .env.example .env
   ```

3. Fill in database and JWT settings.  
   补齐数据库与 JWT 配置。

4. Install dependencies and run:

   ```bash
   npm install
   npm run dev
   ```

5. The health endpoint is:

   ```text
   GET /api/ping
   ```

### 5.4 Run the admin dashboard locally / 本地运行管理后台

1. Enter the dashboard directory:

   ```bash
   cd cloud/web
   ```

2. Create env file:

   ```bash
   cp .env.example .env
   ```

3. Install dependencies and run:

   ```bash
   npm install
   npm run dev
   ```

## 6. Environment Configuration / 环境配置

### Mini program config / 小程序配置

Important file: `config/saaa-config.js`

Key fields / 关键字段：

- `api.baseUrl`: cloud API base URL / 云端 API 地址
- `api.uploadEndpoint`: **use `/upload`** so the final request becomes `/api/upload`  
  使用 `/upload`，由统一请求构造函数拼成 `/api/upload`
- `api.staticBase`: public base URL for uploaded files / 上传文件访问前缀
- `map.amapWebKey`: AMap Web Service key / 高德 Web Service Key
- `config/saaa-config.local.js`: local override file for secrets (not committed) / 本地私有覆盖配置（不入库）

You can create the local file from:

```bash
cp config/saaa-config.local.example.js config/saaa-config.local.js
```

### Cloud env / 云端环境变量

Important templates / 模板文件：

- `cloud/.env.example`
- `cloud/server/.env.example`
- `cloud/web/.env.example`

Recommended production items / 生产环境重点项：

- `JWT_SECRET`
- `POSTGRES_PASSWORD`
- `WECHAT_APPID`
- `WECHAT_SECRET`
- `STORAGE_BASE_URL`
- `AMAP_WEB_KEY`
- `API_HOST` / `API_KEY` (if QWeather is used)

## 7. Deployment / 部署说明

For full-server deployment, see:

完整云主机部署请看：

- `cloud/DEPLOYMENT.md`

### Pre-deployment checklist / 部署前检查清单

Before deploying to production, verify the following:

上线前请逐项确认：

- [ ] Domain name is ready and HTTPS works / 域名已配置且 HTTPS 正常
- [ ] `JWT_SECRET` is replaced with a strong secret / 已替换强随机 JWT 密钥
- [ ] PostgreSQL is reachable and initialized / PostgreSQL 已初始化并可访问
- [ ] `STORAGE_BASE_URL` points to the real public upload path / 上传资源地址已指向真实公开路径
- [ ] WeChat AppID and Secret are correct / 微信小程序 AppID 和 Secret 正确
- [ ] Upload endpoint path is `/api/upload` through config composition / 上传链路最终落到 `/api/upload`
- [ ] Admin account is configured securely / 管理员账户已安全配置
- [ ] Map and weather provider keys are injected from environment / 地图与天气服务 key 已通过环境变量配置

## 8. Development Workflow / 开发流程

### Suggested workflow / 建议流程

1. Update or add service logic in `services/` first  
   先改 `services/` 中的核心逻辑
2. Keep page logic thin and UI-focused  
   `pages/` 保持轻量，专注展示与交互
3. Update docs together with feature changes  
   功能变更时同步更新文档
4. Validate cloud endpoints before testing on a real device  
   真机前先验证云端接口

### Development check flow / 开发检查流程

Before pushing code, run:

提交前建议执行：

```bash
npm run check
```

What it does / 它会做什么：

- Run JS syntax lint checks / 执行 JS 语法 lint 检查
- Run server smoke tests / 执行后端 smoke test
- Run web utility tests / 执行 web 工具函数测试
- Provide a single CI-friendly entry / 提供统一的 CI 入口

GitHub Actions workflow is available at:

GitHub Actions 工作流位置：

```text
.github/workflows/ci.yml
```

### Current repo status / 当前仓库状态

- Basic feature set is already usable / 基础功能已可用
- Cloud stack and dashboard are present / 云端与后台已具备雏形
- Baseline tests and CI have been added / 已补上基础测试与 CI

## 9. API and Sync Notes / 接口与同步说明

### Important endpoints / 关键接口

- `POST /api/login/wechat`
- `GET /api/ping`
- `GET /api/routes`
- `GET /api/routes/:id`
- `POST /api/routes`
- `PUT /api/routes/:id`
- `DELETE /api/routes/:id`
- `POST /api/routes/sync`
- `POST /api/upload`
- `GET /api/weather`
- `GET /api/geocode/reverse`

### Upload path note / 上传路径说明

The mini program should use `uploadEndpoint: '/upload'`, and the shared URL builder will combine it with the API base URL so the actual request becomes:

小程序端应配置 `uploadEndpoint: '/upload'`，再由统一 URL 构造器拼接为实际请求地址：

```text
https://your-domain.example/api/upload
```

This avoids mismatches between `/photos` and `/api/upload`.

这样可以避免 `/photos` 与 `/api/upload` 不一致导致的上传失败。

## 10. Current Risks and TODOs / 当前风险与待优化项

### Already improved in this round / 本轮已处理

- [x] Upload endpoint unified to `/upload` / 上传端点已统一为 `/upload`
- [x] Noisy debug logs in `services/media.js` reduced / `services/media.js` 调试噪音已清理
- [x] README upgraded to bilingual format / README 已升级为双语结构
- [x] Added standalone Chinese doc / 已补充独立中文文档

### Still recommended next / 下一步建议继续做

- [ ] Move hard-coded production config out of source files  
      把源码中的生产环境硬编码配置继续外移
- [ ] Add automated tests for `/api/ping`, `/api/upload`, `/api/routes/sync`  
      给关键接口补自动化测试
- [ ] Add GitHub Actions for lint / test / build  
      增加 GitHub Actions 质量门禁
- [ ] Add environment separation for dev/staging/prod  
      建立 dev/staging/prod 配置分层

## 11. FAQ / 常见问题

### Q1. Why does photo upload fail? / 为什么图片上传会失败？

Common causes / 常见原因：

- The client is still pointing to the wrong endpoint  
  客户端仍然指向错误上传路径
- `STORAGE_BASE_URL` is incorrect  
  上传资源公开地址配置不对
- Login token is missing or expired  
  登录 token 缺失或过期
- WeChat domain whitelist is not configured  
  微信合法域名未配置

### Q2. Why can the mini program run locally but not on a device? / 为什么本地能跑，真机不行？

Usually because the device enforces real domain, TLS, and permission checks.  
通常是因为真机会严格校验域名、HTTPS 和权限。

### Q3. Is `cloud/` bundled into the mini program package? / `cloud/` 会打进小程序包吗？

No. It is deployed separately as a server-side stack.  
不会，`cloud/` 是独立部署的服务端。

## 12. License / 许可

This project is licensed under **PolyForm Noncommercial 1.0.0**. Commercial use is prohibited unless separately authorized by the copyright holder.  
本项目采用 **PolyForm Noncommercial 1.0.0** 许可证，默认**禁止商用**；如需商用，需另行获得版权方书面授权。

See: `LICENSE`
