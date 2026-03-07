# arxiv_agent

一个面向**建筑学 / 体育空间 / VR环境 / 行为轨迹**研究的 arXiv 自动检索与 AI 结构化分析脚本。

## 现在这版做了什么优化

相较原始版本，已补上：

1. **SQLite 历史库 / 缓存**
   - 文件：`papers.db`
   - 已分析过的论文会直接复用，减少重复调用模型。

2. **更贴空间研究的结构化字段**
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

3. **重试机制**
   - LLM 分析失败时自动重试。

4. **更好的 Markdown 日报**
   - 有 TOP 5
   - 有分组输出
   - 有相关性排序

5. **运行统计**
   - 输出 `*_stats.json`
   - 记录抓取数、过滤数、缓存命中数、实际分析数

---

## 依赖安装

建议 Python 3.10+

```bash
pip install arxiv pandas pyyaml python-dotenv openai openpyxl
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

## 输出文件

默认输出到 `output/`：

- `arxiv_daily_YYYY-MM-DD.xlsx`
- `arxiv_daily_YYYY-MM-DD.md`
- `arxiv_daily_YYYY-MM-DD_stats.json`

数据库缓存文件：

- `papers.db`

---

## 推荐下一步继续优化

1. 增加 PDF 全文二级分析模式
2. 接入更多文献源（OpenAlex / Semantic Scholar / Crossref）
3. 增加 Telegram 或邮件推送
4. 增加人工复核字段
5. 增加研究标签与长期知识库视图
