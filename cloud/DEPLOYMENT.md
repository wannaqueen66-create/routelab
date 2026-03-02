# RouteLab 云主机部署指南（Ubuntu 22.04 + Nginx + Cloudflare）

本文档说明如何在一台全新的 Ubuntu 22.04 云主机上部署 `cloud` 目录下的整套服务（PostgreSQL + API + Nginx + Web 管理端），并通过 Cloudflare 做 HTTPS 反向代理和加速。

> 目录结构说明（本机）  
> `cloud/`：本文件夹整体拷贝到云主机后直接部署  
> `cloud/server/`：Node.js API 服务（提供 `/api/...` 接口，含 `/api/routes/sync`）  
> `cloud/web/`：管理后台 React 单页应用（由 Nginx 静态托管）  
> `cloud/nginx/`：Nginx 反向代理和静态站点配置  
> `cloud/scripts/`：数据库初始化脚本（由 API 自动加载）  
> `cloud/docker-compose.yml`：一键启动 db + api + nginx

---

## 1. 云主机基础环境准备（Ubuntu 22.04）

1. 更新系统并安装 Docker 与 Compose 插件：

   ```bash
   sudo apt update && sudo apt upgrade -y

   # 安装 docker
   sudo apt install -y ca-certificates curl gnupg lsb-release
   curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker.gpg
   echo \
     "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker.gpg] \
     https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
     sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
   sudo apt update
   sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

   # 允许当前用户使用 docker（可选）
   sudo usermod -aG docker $USER
   # 重新登录终端后生效
   ```

2. 开启防火墙并放行 HTTP/HTTPS（如果使用 ufw）：

   ```bash
   sudo ufw allow 22/tcp
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw enable
   ```

3. 选择部署路径（建议）：

   ```bash
   sudo mkdir -p /opt/routelab
   sudo chown $USER:$USER /opt/routelab
   ```

---

## 2. 上传代码并准备配置

1. 将本地项目中的 `cloud/` 目录上传到云主机，例如：

   ```bash
   # 在本地仓库根目录
   scp -r cloud/ user@your-server:/opt/routelab/
   ```

   在服务器上目录结构应类似：

   ```text
   /opt/routelab/cloud
     ├─ docker-compose.yml
     ├─ .env.example
     ├─ nginx/
     ├─ server/
     ├─ web/
     └─ scripts/
   ```

2. 在服务器上复制 `.env`：

   ```bash
   cd /opt/routelab/cloud
   cp .env.example .env
   ```

3. 编辑 `.env`（**必须修改的项**）：

   ```bash
   nano .env
   ```

   关键配置说明：

   - 数据库：
     - `POSTGRES_PASSWORD`：为 Postgres 设置强密码
   - 安全：
     - `JWT_SECRET`：使用随机 64 字节十六进制字符串，保证 API token 安全
   - 端口：
     - `API_PORT`：容器内 API 端口（默认 8080）
     - `NGINX_PORT_HTTP` / `NGINX_PORT_HTTPS`：宿主机对外暴露的 80/443 端口（一般保持默认）
   - 对外 URL：
     - `STORAGE_BASE_URL`：访问上传图片的完整 URL，例如 `https://your-domain.com/static/uploads`
   - WeChat 小程序：
     - `WECHAT_APPID` / `WECHAT_SECRET`：微信小程序的真实 AppID 和 Secret，用于 `/api/login/wechat`
   - 管理后台账号：
     - `ADMIN_USER`：后台用户名，例如 `admin`
     - `ADMIN_PASSWORD` 或 `ADMIN_PASSWORD_HASH`：二选一，生产环境推荐只配置 `ADMIN_PASSWORD_HASH`

4. （可选）如需单独配置 API 容器环境，可同步参考 `cloud/server/.env.example`，但在 `docker-compose` 场景下一般只需维护根目录的 `.env`。

---

## 3. Cloudflare 配置（域名 + 源站证书）

> 假设你的域名为 `routelab.example.com`，以下步骤以该域名为例。

1. 在 Cloudflare 添加站点并接入域名（按照 Cloudflare 指引修改 NS）。
2. 在 Cloudflare「DNS」页：
   - 新建 A 记录：`routelab.example.com` → 指向你的服务器公网 IP
   - 代理状态保持「Proxied」（小橙云），让请求经过 Cloudflare
3. 在 Cloudflare「SSL/TLS → Overview」：
   - 建议模式选择 `Full (strict)`
4. 在 Cloudflare「SSL/TLS → Origin Server」页面：
   - 点击「Create Certificate」生成 **Origin Server Certificate**
   - 证书类型选「Let Cloudflare generate a private key and a CSR」
   - 有效期可选择较长（例如 15 年）
   - 下载得到两个文件：
     - `origin.pem`（证书）
     - `origin.key`（私钥）

5. 将证书上传到服务器 `/opt/certs`（与 `docker-compose.yml` 中 Nginx 挂载保持一致）：

   ```bash
   sudo mkdir -p /opt/certs
   sudo chown root:root /opt/certs
   sudo chmod 700 /opt/certs

   # 将 origin.pem 上传为 cf-origin.pem，将 origin.key 上传为 cf-origin.key
   # 例如：
   # scp origin.pem root@your-server:/opt/certs/cf-origin.pem
   # scp origin.key root@your-server:/opt/certs/cf-origin.key

   sudo chmod 600 /opt/certs/cf-origin.pem /opt/certs/cf-origin.key
   ```

6. Nginx 配置中已经预置了证书路径（`cloud/nginx/site.conf`）：

   ```nginx
   ssl_certificate     /etc/ssl/origin/cf-origin.pem;
   ssl_certificate_key /etc/ssl/origin/cf-origin.key;
   ```

   `docker-compose.yml` 已将宿主机 `/opt/certs` 挂载为容器内 `/etc/ssl/origin`。

---

## 4. 使用 Docker Compose 启动服务

1. 在云主机上进入 `cloud` 目录：

   ```bash
   cd /opt/routelab/cloud
   ```

2. 启动所有服务（后台运行）：

   ```bash
   docker compose up -d
   ```

   - `db`：PostgreSQL 16，使用 `scripts/init.sql` 自动初始化表结构
   - `api`：Node.js API 服务（端口 8080，内部暴露为 `api` 服务）
   - `nginx`：对外暴露 80/443，负责静态文件和 `/api` 反向代理

3. 检查容器状态：

   ```bash
   docker compose ps
   ```

4. 查看 Nginx 健康检查：

   ```bash
   curl http://127.0.0.1/healthz
   # 期望返回：ok
   ```

5. 在浏览器访问：

   - 管理后台：`https://routelab.example.com/`（React Dashboard）
   - API 基础路径：`https://routelab.example.com/api`
     - 示例：`GET https://routelab.example.com/api/ping`
     - 小程序使用：`https://routelab.example.com/api/routes`, `/api/routes/sync` 等

---

## 5. 小程序端配置对接云端

1. 修改小程序 `config/saaa-config.js`：

   ```js
   module.exports = {
     apiBaseUrl: 'https://routelab.example.com/api',
     api: {
       baseUrl: 'https://routelab.example.com/api',
       timeout: 15000,
       retries: 1,
       token: '',
       uploadEndpoint: '/upload',
       staticBase: 'https://routelab.example.com/static/uploads',
     },
     // 其它配置按需调整
   };
   ```

2. 小程序云端接口说明（与后端保持一一对应）：

   - 登录：`POST /api/login/wechat`
   - 路径上传/更新：
     - `POST /api/routes`（对应小程序 `api.createRoute()`）
     - `PUT /api/routes/:id`（对应 `api.upsertRoute()`）
   - 路径删除：`DELETE /api/routes/:id`
   - 增量同步：`POST /api/routes/sync`（对应 `api.syncRoutes()`）
   - 单条查询：`GET /api/routes/:id`
   - 列表查询：`GET /api/routes`
   - 评论 / 点赞等接口与 `services/api.js` 中的路径保持一致

3. 小程序端同步逻辑与云端数据的对应关系（核心）：

   - 本地存储：`utils/storage.js` 使用 `wx.setStorageSync` 持久化所有路线记录
   - 本地元数据：`services/route-store.js`
     - `synced: true/false`：是否已成功与云端对齐
     - `pendingUpload: true`：待上传队列
     - `remoteId`：云端主键 ID（等于 `routes.id`）
     - `deleted: true`：本地标记为已删除（软删除墓碑，不再参与上传）
   - 上行同步（小程序 → 云端）：
     - 新记录：`storeRoute()` 先写入本地缓存，标记 `pendingUpload: true`
     - 立即调用 `syncRouteToCloud()` → `api.createRoute()` 或 `api.upsertRoute()`
     - 批量同步：`syncRoutesToCloud()` 遍历本地 `pendingUpload` 记录逐条上传
   - 下行同步（云端 → 小程序）：
     - `syncRoutesFromCloud()` 调用 `api.syncRoutes()` → `POST /api/routes/sync`
     - 请求体包含：`lastSyncAt`、`knownRemoteIds` 等
     - 响应：
       - `items`：云端有变动的路线列表（含新增、修改、软删除）
       - `deletedIds`：云端标记为删除的 ID（软删除）
       - `missingRemoteIds`：云端已不存在的 ID（如管理员在 Web 端硬删除）
     - 合并逻辑：`mergeRoutes()`
       - 对 `deletedIds` / `missingRemoteIds` 生成本地墓碑记录（`deleted: true`）
       - 对 `items` 中 `deletedAt` 不为空的记录，同样视为已删除
       - 最终写入本地缓存并按照时间排序
   - 展示优先级：
     - 首页/历史：优先展示云端最新数据（由 `syncRoutesFromCloud` 更新本地）
     - 未同步记录在 UI 中显示「待同步」标识（`syncPending`）

4. Web 管理端数据与小程序数据结构一致：

   - 管理端通过 `cloud/web/src/api/client.js` 调用：
     - `/api/admin/routes`、`/api/admin/users` 等管理接口
     - `/api/routes`、`/api/routes/:id` 与小程序共用同一 `routes` 表结构
   - 管理员在 Web 后台删除不合规记录：
     - 若通过普通用户接口删除 → `routes.deleted_at` 设置为非空（软删除）
     - 若通过某些维护操作硬删除 → 行直接从 `routes` 表中移除
   - 小程序通过 `/api/routes/sync` 返回的 `deletedIds` + `missingRemoteIds` 保证本地缓存与云端严格一致，不再重复上传被判定为违规或不合规的轨迹。

---

## 6. 日常运维与更新

1. 查看日志：

   ```bash
   cd /opt/routelab/cloud
   docker compose logs -f api
   docker compose logs -f nginx
   docker compose logs -f db
   ```

2. 更新版本：

   ```bash
   # 在本地更新代码后重新上传 cloud/ 目录，或直接在服务器上 git pull
   cd /opt/routelab/cloud
   docker compose pull        # 若使用远程镜像
   docker compose build       # 若修改了 server/web 代码
   docker compose up -d
   ```

3. 备份数据：

   - 数据库数据存放在 Docker volume `db_data` 中，可使用 `pg_dump` 或挂载 volume 做定期备份
   - API 内置维护接口（如 `POST /api/admin/maintenance/backup`）可配合 `BACKUP_STORAGE_PATH` 保存快照

---

完成以上步骤后：

- 小程序端通过 `https://<你的域名>/api` 与云端主机双向同步数据（含 `/api/routes/sync` 增量同步）。  
- Web 管理端可对 `routes` 表进行审核与删除，不合规数据会通过 `deletedIds` 与 `missingRemoteIds` 下发到小程序端，避免重复上传。  
- Nginx + Cloudflare 提供完整的 HTTPS 入口与静态资源加速，保证整体链路安全可控。

