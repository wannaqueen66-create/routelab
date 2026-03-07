# arxiv_agent

一个面向**建筑学 / 体育空间 / VR环境 / 行为轨迹**研究的多源文献自动检索与 AI 结构化分析脚本。

## 当前版本已完成的关键优化

### 1. 建筑/空间行为研究专用 prompt
分析 prompt 已针对以下方向优化：
- 建筑学
- 体育空间
- VR环境
- 行为轨迹
- 空间感知 / 生理指标 / 行为指标

### 2. 增加专用结构化字段
输出字段包括：
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

### 3. 缓存 + 失败重试
- SQLite 缓存：`papers.db`
- 已分析过的论文直接复用
- LLM 分析失败自动重试

### 4. 历史数据库
数据库中会保留：
- 来源
- 标题
- 英文摘要
- 中文摘要
- 日期
- 作者
- 分类
- 分析结果
- 相关性分数

### 5. 多文献源支持
当前支持：
- arXiv
- OpenAlex
- Crossref
- Semantic Scholar

### 6. 中文摘要输出 + 英文原文保留
- `english_abstract` 字段保留英文摘要
- `中文摘要` 字段保存模型生成的中文摘要
- Markdown / Excel 会同时输出这两部分

---

## 依赖安装

建议 Python 3.10+

```bash
pip install arxiv pandas pyyaml python-dotenv openai openpyxl requests
```

---

## 环境变量

在项目目录创建 `.env`：

```env
OPENAI_API_KEY=your_key_here
```

---

## 运行方式

```bash
python arxiv_agent.py
```

---

## 配置说明

在 `config.yaml` 中可调：
- `queries`：检索式
- `sources`：数据源列表
- `days_back`：抓取最近几天
- `max_results_per_query`：每个 query 每个源最多抓多少条
- `exclude_keywords`：排噪词
- `must_have_keywords`：必须命中词
- `analysis_retries`：分析失败重试次数
- `force_refresh`：是否忽略缓存

---

## 输出文件

默认输出到 `output/`：

- `arxiv_daily_YYYY-MM-DD.xlsx`
- `arxiv_daily_YYYY-MM-DD.md`
- `arxiv_daily_YYYY-MM-DD_stats.json`

缓存数据库：
- `papers.db`

---

## 下一步还值得做的增强

1. PDF 全文二级分析
2. Telegram / 邮件推送
3. 人工复核字段
4. 研究标签系统
5. 长期知识库视图
