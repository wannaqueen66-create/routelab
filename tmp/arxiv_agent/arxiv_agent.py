import json
import os
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import arxiv
import pandas as pd
import yaml
from dotenv import load_dotenv
from openai import OpenAI


DB_PATH = "papers.db"


def load_config(config_path: str = "config.yaml") -> dict:
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_env() -> OpenAI:
    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("没有读取到 OPENAI_API_KEY，请检查 .env 文件。")
    return OpenAI(api_key=api_key)


def ensure_output_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def truncate_text(text: str, max_chars: int) -> str:
    if not text:
        return ""
    return text[:max_chars]


def contains_excluded_keyword(text: str, exclude_keywords: list[str]) -> bool:
    text_lower = text.lower()
    return any(k.lower() in text_lower for k in exclude_keywords)


def contains_must_have_keyword(text: str, must_have_keywords: list[str]) -> bool:
    if not must_have_keywords:
        return True
    text_lower = text.lower()
    return any(k.lower() in text_lower for k in must_have_keywords)


def init_db(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS papers (
            url TEXT PRIMARY KEY,
            title TEXT,
            published_date TEXT,
            query_name TEXT,
            authors TEXT,
            primary_category TEXT,
            categories TEXT,
            summary TEXT,
            analysis_json TEXT,
            related_score INTEGER,
            created_at TEXT,
            updated_at TEXT
        )
        """
    )
    conn.commit()
    return conn


def get_cached_analysis(conn: sqlite3.Connection, url: str) -> dict | None:
    row = conn.execute(
        "SELECT analysis_json FROM papers WHERE url = ?", (url,)
    ).fetchone()
    if not row or not row[0]:
        return None
    try:
        return json.loads(row[0])
    except Exception:
        return None


def upsert_paper(
    conn: sqlite3.Connection,
    url: str,
    title: str,
    published_date: str,
    query_name: str,
    authors: list[str],
    primary_category: str,
    categories: list[str],
    summary: str,
    analysis: dict,
):
    now = datetime.now().isoformat(timespec="seconds")
    conn.execute(
        """
        INSERT INTO papers (
            url, title, published_date, query_name, authors, primary_category,
            categories, summary, analysis_json, related_score, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET
            title=excluded.title,
            published_date=excluded.published_date,
            query_name=excluded.query_name,
            authors=excluded.authors,
            primary_category=excluded.primary_category,
            categories=excluded.categories,
            summary=excluded.summary,
            analysis_json=excluded.analysis_json,
            related_score=excluded.related_score,
            updated_at=excluded.updated_at
        """,
        (
            url,
            title,
            published_date,
            query_name,
            "; ".join(authors),
            primary_category,
            "; ".join(categories),
            summary,
            json.dumps(analysis, ensure_ascii=False),
            analysis.get("相关性分数", 0),
            now,
            now,
        ),
    )
    conn.commit()


def parse_analysis_text(text: str) -> dict:
    result = {
        "研究主题": "",
        "空间/场景类型": "",
        "研究场景": "",
        "自变量": "",
        "因变量": "",
        "行为指标": "",
        "生理/感知指标": "",
        "研究方法": "",
        "数据/样本": "",
        "主要结论": "",
        "与建筑/体育空间研究相关性": "",
        "相关性分数": 0,
        "可借鉴启发": "",
        "原始分析": text,
    }

    current_key = None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        matched = False
        for key in list(result.keys()):
            if key == "原始分析":
                continue
            if line.startswith(f"{key}：") or line.startswith(f"{key}:"):
                current_key = key
                value = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
                value = value.strip()
                if key == "相关性分数":
                    try:
                        result[key] = int(value)
                    except Exception:
                        result[key] = 0
                else:
                    result[key] = value
                matched = True
                break
        if not matched and current_key and current_key != "原始分析":
            if current_key == "相关性分数":
                continue
            result[current_key] = (result[current_key] + " " + line).strip()

    return result


def analyze_paper(client: OpenAI, model: str, title: str, abstract: str, retries: int = 3, retry_delay: int = 3) -> dict:
    prompt = f"""
你是一个“建筑学 / 体育空间 / VR环境 / 行为轨迹”方向的科研文献分析助手。
请根据下面论文标题和摘要，输出适合空间研究者使用的结构化信息。

要求：
1. 用简洁中文。
2. 如果摘要没有明确写出，就写“未明确说明”，不要瞎编。
3. “相关性分数”请按 0-100 打分。
4. 特别关注：空间类型、研究场景、行为变量、生理指标、VR/轨迹方法、是否能迁移到建筑/体育空间研究。

请严格按下面格式输出：

研究主题：
空间/场景类型：
研究场景：
自变量：
因变量：
行为指标：
生理/感知指标：
研究方法：
数据/样本：
主要结论：
与建筑/体育空间研究相关性：
相关性分数：
可借鉴启发：

标题：{title}

摘要：{abstract}
"""

    last_error = None
    for attempt in range(1, retries + 1):
        try:
            response = client.responses.create(model=model, input=prompt)
            text = response.output_text.strip()
            return parse_analysis_text(text)
        except Exception as e:
            last_error = e
            if attempt < retries:
                time.sleep(retry_delay * attempt)

    return {
        "研究主题": "",
        "空间/场景类型": "",
        "研究场景": "",
        "自变量": "",
        "因变量": "",
        "行为指标": "",
        "生理/感知指标": "",
        "研究方法": "",
        "数据/样本": "",
        "主要结论": "",
        "与建筑/体育空间研究相关性": "",
        "相关性分数": 0,
        "可借鉴启发": "",
        "原始分析": f"分析失败：{last_error}",
    }


def result_to_row(query_name: str, published, result, analysis: dict) -> dict:
    authors = [a.name for a in getattr(result, "authors", [])]
    primary_category = getattr(result, "primary_category", "") or ""
    categories = getattr(result, "categories", []) or []

    return {
        "query_name": query_name,
        "published_date": published.strftime("%Y-%m-%d"),
        "title": (result.title or "").strip(),
        "url": result.entry_id,
        "authors": "; ".join(authors),
        "primary_category": primary_category,
        "categories": "; ".join(categories),
        "研究主题": analysis["研究主题"],
        "空间/场景类型": analysis["空间/场景类型"],
        "研究场景": analysis["研究场景"],
        "自变量": analysis["自变量"],
        "因变量": analysis["因变量"],
        "行为指标": analysis["行为指标"],
        "生理/感知指标": analysis["生理/感知指标"],
        "研究方法": analysis["研究方法"],
        "数据/样本": analysis["数据/样本"],
        "主要结论": analysis["主要结论"],
        "与建筑/体育空间研究相关性": analysis["与建筑/体育空间研究相关性"],
        "相关性分数": analysis["相关性分数"],
        "可借鉴启发": analysis["可借鉴启发"],
        "原始分析": analysis["原始分析"],
    }


def write_markdown(md_path: str, df: pd.DataFrame, today_str: str):
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(f"# arXiv 每日简报（{today_str}）\n\n")

        if df.empty:
            f.write("今天没有抓到符合条件的新论文。\n")
            return

        f.write(f"- 今日入选论文数：{len(df)}\n")
        f.write(f"- 高相关（>=80分）：{len(df[df['相关性分数'] >= 80])}\n")
        f.write(f"- 中高相关（>=60分）：{len(df[df['相关性分数'] >= 60])}\n\n")

        top_df = df.sort_values(by=["相关性分数", "published_date"], ascending=[False, False]).head(5)
        f.write("## 今日最值得优先看的 TOP 5\n\n")
        for _, row in top_df.iterrows():
            f.write(f"- **{row['title']}**（{row['相关性分数']}分）\n")
            f.write(f"  - 分组：{row['query_name']}\n")
            f.write(f"  - 链接：{row['url']}\n")
            f.write(f"  - 启发：{row['可借鉴启发']}\n")
        f.write("\n")

        grouped = df.sort_values(by=["query_name", "相关性分数"], ascending=[True, False]).groupby("query_name")
        for group_name, sub_df in grouped:
            f.write(f"## 分组：{group_name}\n\n")
            for _, row in sub_df.iterrows():
                f.write(f"### {row['title']}\n\n")
                f.write(f"- 日期：{row['published_date']}\n")
                f.write(f"- 作者：{row['authors']}\n")
                f.write(f"- 分类：{row['primary_category']}\n")
                f.write(f"- 链接：{row['url']}\n")
                f.write(f"- 研究主题：{row['研究主题']}\n")
                f.write(f"- 空间/场景类型：{row['空间/场景类型']}\n")
                f.write(f"- 研究场景：{row['研究场景']}\n")
                f.write(f"- 自变量：{row['自变量']}\n")
                f.write(f"- 因变量：{row['因变量']}\n")
                f.write(f"- 行为指标：{row['行为指标']}\n")
                f.write(f"- 生理/感知指标：{row['生理/感知指标']}\n")
                f.write(f"- 研究方法：{row['研究方法']}\n")
                f.write(f"- 数据/样本：{row['数据/样本']}\n")
                f.write(f"- 主要结论：{row['主要结论']}\n")
                f.write(f"- 相关性：{row['与建筑/体育空间研究相关性']}\n")
                f.write(f"- 相关性分数：{row['相关性分数']}\n")
                f.write(f"- 可借鉴启发：{row['可借鉴启发']}\n\n")


def main():
    print("arxiv agent started")

    config = load_config("config.yaml")
    client = load_env()

    output_dir = config.get("output_dir", "output")
    output_prefix = config.get("output_prefix", "arxiv_daily")
    openai_model = config.get("openai_model", "gpt-4.1-mini")
    max_chars_per_paper = config.get("max_chars_per_paper", 6000)
    days_back = config.get("days_back", 2)
    max_results_per_query = config.get("max_results_per_query", 10)
    queries = config.get("queries", {})
    exclude_keywords = config.get("exclude_keywords", [])
    must_have_keywords = config.get("must_have_keywords", [])
    db_path = config.get("db_path", DB_PATH)
    analysis_retries = config.get("analysis_retries", 3)
    retry_delay_seconds = config.get("retry_delay_seconds", 3)
    force_refresh = config.get("force_refresh", False)

    ensure_output_dir(output_dir)
    conn = init_db(db_path)

    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days_back)

    all_rows = []
    seen_urls = set()
    stats = {
        "fetched": 0,
        "too_old": 0,
        "duplicate": 0,
        "excluded": 0,
        "must_have_filtered": 0,
        "cache_hit": 0,
        "analyzed": 0,
    }

    for query_name, query_text in queries.items():
        print(f"正在抓取 query: {query_name}")

        search = arxiv.Search(
            query=query_text,
            max_results=max_results_per_query,
            sort_by=arxiv.SortCriterion.SubmittedDate,
        )

        for result in search.results():
            stats["fetched"] += 1

            title = (result.title or "").strip()
            abstract = (result.summary or "").strip()
            url = result.entry_id
            published = result.published

            if published.tzinfo is None:
                published = published.replace(tzinfo=timezone.utc)

            if published < cutoff_date:
                stats["too_old"] += 1
                continue

            if url in seen_urls:
                stats["duplicate"] += 1
                continue

            combined_text = f"{title}\n{abstract}"

            if exclude_keywords and contains_excluded_keyword(combined_text, exclude_keywords):
                stats["excluded"] += 1
                continue

            if not contains_must_have_keyword(combined_text, must_have_keywords):
                stats["must_have_filtered"] += 1
                continue

            seen_urls.add(url)
            short_abstract = truncate_text(abstract, max_chars_per_paper)

            cached = None if force_refresh else get_cached_analysis(conn, url)
            if cached:
                analysis = cached
                stats["cache_hit"] += 1
            else:
                analysis = analyze_paper(
                    client=client,
                    model=openai_model,
                    title=title,
                    abstract=short_abstract,
                    retries=analysis_retries,
                    retry_delay=retry_delay_seconds,
                )
                stats["analyzed"] += 1
                upsert_paper(
                    conn=conn,
                    url=url,
                    title=title,
                    published_date=published.strftime("%Y-%m-%d"),
                    query_name=query_name,
                    authors=[a.name for a in getattr(result, "authors", [])],
                    primary_category=getattr(result, "primary_category", "") or "",
                    categories=getattr(result, "categories", []) or [],
                    summary=abstract,
                    analysis=analysis,
                )

            all_rows.append(result_to_row(query_name, published, result, analysis))

    today_str = datetime.now().strftime("%Y-%m-%d")
    excel_path = os.path.join(output_dir, f"{output_prefix}_{today_str}.xlsx")
    md_path = os.path.join(output_dir, f"{output_prefix}_{today_str}.md")
    stats_path = os.path.join(output_dir, f"{output_prefix}_{today_str}_stats.json")

    df = pd.DataFrame(all_rows)

    if not df.empty:
        df = df.sort_values(by=["相关性分数", "published_date"], ascending=[False, False])
        df.to_excel(excel_path, index=False)

    write_markdown(md_path, df, today_str)

    with open(stats_path, "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)

    if df.empty:
        print("没有抓到符合条件的新论文。")
    else:
        print(f"已生成 Excel：{excel_path}")
    print(f"已生成 Markdown：{md_path}")
    print(f"已生成统计：{stats_path}")
    print("运行统计：", stats)


if __name__ == "__main__":
    main()
