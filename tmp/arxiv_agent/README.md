# arxiv_agent

一个面向 **建筑学 / 体育空间 / VR 环境 / 行为轨迹** 研究的**多源文献自动检索与 AI 结构化分析工具**。

它会从多个学术来源抓取最近的新论文，自动完成中文摘要与结构化信息提取，并输出为日报文件；同时支持 SQLite 缓存与 Brevo 邮件推送，适合做日常文献监测。

---

## 这个项目现在能做什么

### 1. 多源抓取文献
当前支持以下来源：
- arXiv
- OpenAlex
- Crossref
- Semantic Scholar

你可以通过 `config.yaml` 中的 `sources` 配置来控制启用哪些来源。

### 2. 自动生成中文结构化分析
程序会调用 OpenAI，对每篇论文输出适合空间研究者使用的结构化信息，包括：

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

### 3. 保留英文原文摘要
除中文摘要外，系统会同时保留英文摘要，方便快速浏览与回溯原文信息。

### 4. 缓存与历史数据库
程序使用 SQLite 数据库 `papers.db` 作为缓存与历史库：
- 避免重复分析同一篇论文
- 节省 token 成本
- 逐步积累自己的文献库

### 5. 自动输出日报
每次运行后，默认会生成：
- `output/arxiv_daily_YYYY-MM-DD.xlsx`
- `output/arxiv_daily_YYYY-MM-DD.md`
- `output/arxiv_daily_YYYY-MM-DD_stats.json`

### 6. 支持 Brevo 邮件推送
如果配置了 Brevo SMTP，程序运行后可以自动把日报发到邮箱：
- 邮件正文：TOP N 论文摘要
- 邮件附件：Markdown / Excel / stats.json

---

## 目录结构

典型目录如下：

```bash
arxiv_agent/
├── arxiv_agent.py
├── config.yaml
├── requirements.txt
├── .env.example
├── .env                # 你自己创建
├── README.md
└── output/
```

> 注意：`.env` 需要与 `arxiv_agent.py` 放在同一级目录。

---

## 安装方式

建议使用 Python 3.10+。

### 1. 创建虚拟环境（可选但推荐）
```bash
python3 -m venv openai_env
source openai_env/bin/activate
```

### 2. 安装依赖
```bash
pip install -r requirements.txt
```

如果你不想用 requirements，也可以手动安装：

```bash
pip install arxiv pandas pyyaml python-dotenv openai openpyxl requests
```

---

## 环境变量配置

先复制示例文件：

```bash
cp .env.example .env
```

然后编辑 `.env`：

```env
# OpenAI
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4.1-mini

# Runtime fetch controls
DAYS_BACK=2
MAX_RESULTS_PER_QUERY=30
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
EMAIL_TOP_N=5
```

### 说明
这些运行时参数都放在 `.env` 里，方便你直接改：

- `OPENAI_MODEL`：使用的模型
- `DAYS_BACK`：抓最近几天的论文
- `MAX_RESULTS_PER_QUERY`：每个 query 每个源最多抓多少条
- `FORCE_REFRESH`：是否忽略缓存重新分析

---

## config.yaml 配置说明

`config.yaml` 用于放相对稳定的项目配置，例如：

- `queries`：arXiv 专用检索式（保留 `cat:` 分类语法）
- `generic_queries`：通用文献源检索式（供 OpenAlex / Crossref / Semantic Scholar 使用）
- `sources`：文献源列表
- `exclude_keywords`：排噪词
- `must_have_keywords`：必须命中词
- `db_path`：SQLite 数据库路径
- `analysis_retries`：分析失败重试次数
- `retry_delay_seconds`：重试间隔

### 当前 sources 示例
```yaml
sources:
  - arxiv
  - openalex
  - crossref
  - semantic_scholar
```

### 当前检索逻辑
- **arXiv**：使用 `queries` 中的原版检索式（保留 `cat:` 分类语法）
- **OpenAlex / Crossref / Semantic Scholar**：使用 `generic_queries` 中的自然语言检索式（不使用 `cat:`）

这样可以保持原版 arXiv 搜索词不变，同时让通用文献源使用更合适的关键词组合。

---

## 运行方式

在项目目录执行：

```bash
python arxiv_agent.py
```

运行成功后，会在 `output/` 下生成日报文件。

---

## 输出结果说明

### 1. Excel 文件
适合筛选、排序、人工复核。

### 2. Markdown 文件
适合快速阅读和汇报，包含：
- 今日统计
- TOP 5
- 分组详情
- 中文摘要 + 英文摘要
- 结构化分析结果

### 3. stats.json
记录运行统计，例如：
- 抓了多少条
- 过滤掉多少条
- 缓存命中多少条
- 实际分析多少条

---

## Brevo 邮件推送

如果要开启邮件推送，把 `.env` 中的：

```env
EMAIL_ENABLED=true
```

并正确填写以下参数：

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

程序运行完成后会自动发送：
- 邮件正文：TOP N 论文摘要
- 附件：Markdown / Excel / stats.json

---

## 常见问题

### 1. 报错：`ModuleNotFoundError: No module named 'arxiv'`
说明依赖还没装，执行：

```bash
pip install -r requirements.txt
```

### 2. 报错：没有读取到 `OPENAI_API_KEY`
说明 `.env` 没创建，或者没填 key。

### 3. 邮件发送失败
优先检查：
- Brevo SMTP 用户名/密码是否正确
- 发件邮箱是否是已配置发件人
- 服务器是否允许出站 SMTP

---

## 当前版本已经完成的优化

- 建筑/空间行为研究专用 prompt
- 增加空间类型 / 研究场景 / 行为指标 / 生理指标字段
- SQLite 缓存与历史数据库
- 自动重试
- 多文献源支持
- 中文摘要输出 + 英文原文保留
- Brevo 邮件推送
- 运行时参数改由 `.env` 控制

---

## 后续还值得继续做的增强

1. PDF 全文二级分析
2. Telegram 推送
3. 人工复核字段
4. 研究标签系统
5. 长期知识库视图

---

## 一句话总结

这是一个适合 **建筑学 / 体育空间 / VR / 行为轨迹** 研究者使用的**多源文献监测与结构化分析工具原型**，已经可以直接跑，并适合继续扩展成长期使用的研究工作流工具。
