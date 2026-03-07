# arxiv_agent

一个面向 **建筑学 / 体育空间 / VR 环境 / 行为轨迹** 研究的 **多源文献自动检索与 AI 结构化分析工具**。

它会从多个学术来源抓取最近的新论文，自动完成中文摘要与结构化信息提取，并输出为日报文件；同时支持 SQLite 缓存、相关性阈值过滤与 Brevo 邮件推送，适合做日常文献监测。

---

# 一、当前版本已经实现的功能

## 1. 多源抓取文献
当前支持以下来源：
- arXiv
- OpenAlex
- Crossref
- Semantic Scholar

## 2. 建筑 / 空间行为专用分析
程序会调用 OpenAI，对每篇论文生成适合空间研究者使用的结构化结果，包括：
- 中文摘要
- 研究主题
- 空间/场景类型
- 研究场景
- 自变量
- 因变量
- 行为指标
- 生理/感知指标
- 研究方法
- 数据/样本
- 主要结论
- 与建筑/体育空间研究相关性
- 相关性分数（0-100）
- 可借鉴启发

## 3. 英文原文摘要保留
系统会同时保存：
- 英文原始摘要
- 中文摘要
- 中文结构化分析

## 4. SQLite 缓存与历史数据库
程序会使用 `papers.db`：
- 缓存已分析论文
- 避免重复调用模型
- 形成自己的历史文献库
- 记录论文是否已被正式日报/邮件上报

## 5. 相关性阈值过滤 + 待展示池 + 已上报去重
支持在 `.env` 中设置：

```env
MIN_RELEVANCE_SCORE=70
PENDING_POOL_DAYS=7
EMPTY_REPORT_EMAIL=true
```

说明：
- 抓到并分析过的论文都会进入数据库
- 只有 **相关性分数 >= 阈值** 的论文才有资格进入正式结果集
- 当天新增达标论文会优先进入正式结果集
- 如果当天新增不足展示容量，会从最近 N 天的待展示池中按分数降序补位
- 已经正式报过的论文，默认不会重复进入下一次日报/邮件
- 如果当天为空，可发送一封简短空日报

## 6. 自动输出日报
每次运行后默认输出：
- `output/arxiv_daily_YYYY-MM-DD.xlsx`
- `output/arxiv_daily_YYYY-MM-DD.md`
- `output/arxiv_daily_YYYY-MM-DD_stats.json`

## 7. Brevo 邮件推送
配置好 SMTP 后，可以自动发送日报邮件：
- 邮件正文：TOP N 论文摘要
- 邮件附件：Markdown / Excel / stats.json

---

# 二、目录结构

典型目录如下：

```bash
arxiv_agent/
├── arxiv_agent.py
├── config.yaml
├── requirements.txt
├── .env.example
├── .env                # 你自己创建
├── README.md
├── papers.db           # 运行后生成
└── output/             # 运行后生成
```

> 注意：`.env` 需要与 `arxiv_agent.py` 放在同一级目录。

---

# 三、从零开始运行流程（Debian / Ubuntu VPS）

## 第 1 步：安装系统基础环境

```bash
apt update && apt install -y python3 python3-pip python3-venv
```

## 第 2 步：进入项目目录

```bash
cd ~/arxiv_agent
```

## 第 3 步：创建虚拟环境

```bash
python3 -m venv openai_env
source openai_env/bin/activate
```

## 第 4 步：安装 Python 依赖

```bash
pip install -r requirements.txt
```

如果你还没有 `requirements.txt`，也可以手动安装：

```bash
pip install arxiv pandas pyyaml python-dotenv openai openpyxl requests
```

## 第 5 步：创建 `.env`

先复制示例文件：

```bash
cp .env.example .env
```

然后编辑：

```bash
nano .env
```

或：

```bash
vim .env
```

## 第 6 步：填写 `.env`

示例：

```env
# OpenAI / OpenAI-compatible provider
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_BASE_URL=
OPENAI_MODEL=gpt-4.1-mini

# Runtime fetch controls
DAYS_BACK=2
MAX_RESULTS_PER_QUERY=30
MIN_RELEVANCE_SCORE=70
FORCE_REFRESH=false

# Brevo email push
EMAIL_ENABLED=false
EMAIL_SMTP_HOST=smtp-relay.brevo.com
EMAIL_SMTP_PORT=587
EMAIL_USERNAME=your_brevo_smtp_username
EMAIL_PASSWORD=your_brevo_smtp_password
EMAIL_FROM=you@example.com
EMAIL_TO=you@example.com
EMAIL_USE_TLS=true
REPORT_TOP_N=10
EMAIL_TOP_N=5
```

## 第 7 步：运行程序

```bash
python arxiv_agent.py
```

运行成功后，会在 `output/` 下生成日报文件。

## 第 8 步（可选）：单独测试邮箱
如果你只是想确认 Brevo SMTP 是否正常，不想重跑整套抓取流程，可以直接运行：

```bash
python test_email.py
```

---

# 四、配置说明

## 1. `.env`：运行时参数
这些是你平时最常改的参数：

- `OPENAI_API_KEY`：OpenAI Key 或兼容提供商 Key
- `OPENAI_BASE_URL`：兼容提供商的 API Base URL（如果用官方 OpenAI，可留空）
- `OPENAI_MODEL`：模型名
- `DAYS_BACK`：抓最近几天论文
- `MAX_RESULTS_PER_QUERY`：每个 query 每个源最多抓多少条
- `MIN_RELEVANCE_SCORE`：最低相关性分数阈值
- `FORCE_REFRESH`：是否忽略缓存强制重跑
- `REPORT_TOP_N`：Markdown 简报里展示多少条重点论文
- `EMAIL_TOP_N`：邮件正文里展示多少条重点论文
- `ENABLE_FALLBACK_UNREPORTED`：当天没有新增时，是否补发最近 N 天里未报过的旧论文
- `FALLBACK_UNREPORTED_DAYS`：补发窗口天数
  - `false`：优先复用数据库里的历史分析结果（更快、更省 token）
  - `true`：忽略缓存，重新分析已抓到的论文（适合刚改 prompt、评分逻辑、字段结构后测试）

邮件相关：
- `EMAIL_ENABLED`
- `EMAIL_SMTP_HOST`
- `EMAIL_SMTP_PORT`
- `EMAIL_USERNAME`
- `EMAIL_PASSWORD`
- `EMAIL_FROM`
- `EMAIL_TO`
- `EMAIL_USE_TLS`
- `EMAIL_TOP_N`

## 2. `config.yaml`：项目配置
这里放相对稳定的配置：

- `queries`：arXiv 专用检索式（保留 `cat:` 语法）
- `generic_queries`：通用文献源检索式（自然语言版）
- `sources`：启用哪些文献源
- `exclude_keywords`：排噪关键词
- `must_have_keywords`：必须命中关键词
- `db_path`：数据库路径
- `analysis_retries`：分析失败重试次数
- `retry_delay_seconds`：重试间隔秒数

---

# 五、当前检索逻辑

## arXiv
使用 `queries` 中的原版检索式，保留 `cat:` 分类语法。

## OpenAlex / Crossref / Semantic Scholar
使用 `generic_queries` 中的自然语言检索式，不使用 `cat:`。

这样做的目的是：
- 保持原版 arXiv 搜索逻辑不变
- 同时让通用文献源使用更合适的关键词形式
- 对通用文献源做“温和收敛”，减少纯泛 mobility / perception / behavior 带来的噪音
- 但仍保留 VR / HCI / 行为 / 生理测量等跨学科入口

---

# 六、输出结果说明

## 1. Excel 文件
适合做：
- 排序
- 筛选
- 人工复核
- 后续综述整理

## 2. Markdown 文件
适合快速阅读与汇报，包含：
- 今日统计
- TOP 5
- 分组详情
- 中文摘要 + 英文摘要
- 结构化分析结果

## 3. stats.json
用于记录运行统计，例如：
- 抓取了多少条
- 过滤了多少条
- 缓存命中了多少条
- 实际调用 AI 分析了多少条
- AI 分析成功多少条
- AI 分析失败多少条
- 因低于最低相关性阈值被剔除了多少条
- 因已上报而跳过了多少条
- 最终保留多少条

---

# 七、Brevo 邮件推送

如果要启用，把 `.env` 中改成：

```env
EMAIL_ENABLED=true
```

并补全这些参数：

```env
EMAIL_SMTP_HOST=smtp-relay.brevo.com
EMAIL_SMTP_PORT=587
EMAIL_USERNAME=your_brevo_smtp_username
EMAIL_PASSWORD=your_brevo_smtp_password
EMAIL_FROM=you@example.com
EMAIL_TO=you@example.com
EMAIL_USE_TLS=true
EMAIL_TOP_N=5
```

程序跑完后会自动发：
- 邮件正文：TOP N 论文摘要
- 附件：Markdown / Excel / stats.json

## OpenAI 兼容提供商说明

如果你使用的不是官方 OpenAI，而是 OpenAI 兼容提供商，请在 `.env` 中填写：

```env
OPENAI_BASE_URL=https://your-provider.example.com/v1
OPENAI_MODEL=your-provider-model-name
```

说明：
- `OPENAI_BASE_URL` 留空时，默认走官方 OpenAI
- 如果你走兼容提供商，通常必须填写 `OPENAI_BASE_URL`
- 模型名是否可用，取决于你的提供商，不一定与官方 OpenAI 完全一致

---

# 八、常见问题

## 1. 报错：`ModuleNotFoundError: No module named 'arxiv'`
说明依赖没装，执行：

```bash
pip install -r requirements.txt
```

## 2. 程序卡在 arXiv 抓取阶段
常见原因：
- query 太宽
- VPS 到 arXiv 网络较慢
- 抓取数量太大

建议先把 `.env` 改小：

```env
DAYS_BACK=1
MAX_RESULTS_PER_QUERY=3
MIN_RELEVANCE_SCORE=70
```

## 3. 邮件发送失败
优先检查：
- Brevo SMTP 用户名/密码
- 发件邮箱是否配置正确
- 服务器是否允许出站 SMTP

---

# 九、建议的默认配置

如果你想先跑通，再逐步放大，我建议先用：

```env
OPENAI_MODEL=gpt-4.1-mini
DAYS_BACK=1
MAX_RESULTS_PER_QUERY=5
MIN_RELEVANCE_SCORE=70
FORCE_REFRESH=false
EMAIL_ENABLED=false
```

---

# 十、一句话总结

这是一个适合 **建筑学 / 体育空间 / VR / 行为轨迹** 研究者使用的 **多源文献监测与结构化分析工具**，已经可以直接跑，并且支持：
- 双语摘要
- 相关性过滤
- 缓存数据库
- 邮件推送
- 多源检索

如果你后面继续扩展，下一步最值得做的是：
1. PDF 全文二级分析
2. Telegram 推送
3. 人工复核工作流
