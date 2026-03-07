import json
import os
import smtplib
import sqlite3
import time
import hashlib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

import arxiv
import pandas as pd
import requests
import yaml
from dotenv import load_dotenv
from openai import OpenAI


DB_PATH = "papers.db"
REQUEST_HEADERS = {"User-Agent": "arxiv-agent/1.0"}


def normalize_doi(value: str | None) -> str:
    if not value:
        return ""
    doi = value.strip()
    doi = doi.replace("https://doi.org/", "").replace("http://doi.org/", "")
    doi = doi.replace("doi.org/", "")
    return doi.lower()


def load_config(config_path: str = "config.yaml") -> dict:
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def parse_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def load_env() -> tuple[OpenAI, dict]:
    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("没有读取到 OPENAI_API_KEY，请检查 .env 文件。")

    base_url = os.getenv("OPENAI_BASE_URL", "").strip()

    runtime = {
        "openai_model": os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        "days_back": int(os.getenv("DAYS_BACK", "2")),
        "max_results_per_query": int(os.getenv("MAX_RESULTS_PER_QUERY", "30")),
        "min_relevance_score": int(os.getenv("MIN_RELEVANCE_SCORE", "0")),
        "force_refresh": parse_bool(os.getenv("FORCE_REFRESH"), False),
        "email_enabled": parse_bool(os.getenv("EMAIL_ENABLED"), False),
        "email_smtp_host": os.getenv("EMAIL_SMTP_HOST", "smtp-relay.brevo.com"),
        "email_smtp_port": int(os.getenv("EMAIL_SMTP_PORT", "587")),
        "email_username": os.getenv("EMAIL_USERNAME", ""),
        "email_password": os.getenv("EMAIL_PASSWORD", ""),
        "email_from": os.getenv("EMAIL_FROM", ""),
        "email_to": os.getenv("EMAIL_TO", ""),
        "email_use_tls": parse_bool(os.getenv("EMAIL_USE_TLS"), True),
        "report_top_n": int(os.getenv("REPORT_TOP_N", "10")),
        "email_top_n": int(os.getenv("EMAIL_TOP_N", "5")),
        "pending_pool_days": int(os.getenv("PENDING_POOL_DAYS", "7")),
        "empty_report_email": parse_bool(os.getenv("EMPTY_REPORT_EMAIL"), True),
    }

    client_kwargs = {"api_key": api_key}
    if base_url:
        client_kwargs["base_url"] = base_url

    return OpenAI(**client_kwargs), runtime


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
            doi TEXT,
            source TEXT,
            title TEXT,
            english_abstract TEXT,
            chinese_summary TEXT,
            published_date TEXT,
            query_name TEXT,
            authors TEXT,
            primary_category TEXT,
            categories TEXT,
            analysis_json TEXT,
            related_score INTEGER,
            analysis_status TEXT,
            meets_threshold INTEGER,
            eligible_for_pending INTEGER,
            first_seen_at TEXT,
            last_seen_at TEXT,
            displayed_at TEXT,
            display_count INTEGER,
            reported_at TEXT,
            report_count INTEGER,
            content_hash TEXT,
            created_at TEXT,
            updated_at TEXT
        )
        """
    )
    conn.commit()
    return conn


def ensure_column(conn: sqlite3.Connection, table: str, column: str, ddl: str):
    cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")
        conn.commit()


def migrate_db(conn: sqlite3.Connection):
    ensure_column(conn, "papers", "doi", "doi TEXT")
    ensure_column(conn, "papers", "source", "source TEXT")
    ensure_column(conn, "papers", "english_abstract", "english_abstract TEXT")
    ensure_column(conn, "papers", "chinese_summary", "chinese_summary TEXT")
    ensure_column(conn, "papers", "analysis_status", "analysis_status TEXT")
    ensure_column(conn, "papers", "meets_threshold", "meets_threshold INTEGER")
    ensure_column(conn, "papers", "eligible_for_pending", "eligible_for_pending INTEGER")
    ensure_column(conn, "papers", "first_seen_at", "first_seen_at TEXT")
    ensure_column(conn, "papers", "last_seen_at", "last_seen_at TEXT")
    ensure_column(conn, "papers", "displayed_at", "displayed_at TEXT")
    ensure_column(conn, "papers", "display_count", "display_count INTEGER DEFAULT 0")
    ensure_column(conn, "papers", "reported_at", "reported_at TEXT")
    ensure_column(conn, "papers", "report_count", "report_count INTEGER DEFAULT 0")
    ensure_column(conn, "papers", "content_hash", "content_hash TEXT")


def get_paper_record(conn: sqlite3.Connection, url: str, doi: str = "") -> dict | None:
    if doi:
        row = conn.execute(
            "SELECT url, doi, analysis_json, content_hash, reported_at, displayed_at FROM papers WHERE doi = ? LIMIT 1",
            (doi,),
        ).fetchone()
        if row:
            return {
                "url": row[0], "doi": row[1], "analysis_json": row[2],
                "content_hash": row[3], "reported_at": row[4], "displayed_at": row[5]
            }
    row = conn.execute(
        "SELECT url, doi, analysis_json, content_hash, reported_at, displayed_at FROM papers WHERE url = ? LIMIT 1",
        (url,),
    ).fetchone()
    if row:
        return {
            "url": row[0], "doi": row[1], "analysis_json": row[2],
            "content_hash": row[3], "reported_at": row[4], "displayed_at": row[5]
        }
    return None


def get_cached_analysis(conn: sqlite3.Connection, url: str, doi: str = "") -> dict | None:
    record = get_paper_record(conn, url, doi)
    if not record or not record.get("analysis_json"):
        return None
    try:
        return json.loads(record["analysis_json"])
    except Exception:
        return None


def was_reported(conn: sqlite3.Connection, url: str, doi: str = "") -> bool:
    if doi:
        row = conn.execute(
            "SELECT reported_at FROM papers WHERE doi = ? AND reported_at IS NOT NULL LIMIT 1", (doi,)
        ).fetchone()
        if row:
            return True
    row = conn.execute(
        "SELECT reported_at FROM papers WHERE url = ?", (url,)
    ).fetchone()
    return bool(row and row[0])


def mark_reported(conn: sqlite3.Connection, urls: list[str], dois: list[str]):
    if not urls and not dois:
        return
    now = datetime.now().isoformat(timespec="seconds")
    for url in urls:
        conn.execute(
            """
            UPDATE papers
            SET reported_at = ?, report_count = COALESCE(report_count, 0) + 1, updated_at = ?
            WHERE url = ?
            """,
            (now, now, url),
        )
    for doi in [d for d in dois if d]:
        conn.execute(
            """
            UPDATE papers
            SET reported_at = ?, report_count = COALESCE(report_count, 0) + 1, updated_at = ?
            WHERE doi = ?
            """,
            (now, now, doi),
        )
    conn.commit()


def mark_displayed(conn: sqlite3.Connection, urls: list[str], dois: list[str]):
    if not urls and not dois:
        return
    now = datetime.now().isoformat(timespec="seconds")
    for url in urls:
        conn.execute(
            """
            UPDATE papers
            SET displayed_at = ?, display_count = COALESCE(display_count, 0) + 1, updated_at = ?
            WHERE url = ?
            """,
            (now, now, url),
        )
    for doi in [d for d in dois if d]:
        conn.execute(
            """
            UPDATE papers
            SET displayed_at = ?, display_count = COALESCE(display_count, 0) + 1, updated_at = ?
            WHERE doi = ?
            """,
            (now, now, doi),
        )
    conn.commit()


def load_pending_pool(conn: sqlite3.Connection, days: int, limit: int) -> pd.DataFrame:
    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    rows = conn.execute(
        """
        SELECT doi, source, query_name, published_date, title, url, authors, primary_category, categories,
               english_abstract, chinese_summary, analysis_json, related_score
        FROM papers
        WHERE displayed_at IS NULL
          AND published_date >= ?
          AND COALESCE(meets_threshold, 0) = 1
          AND COALESCE(eligible_for_pending, 0) = 1
          AND analysis_status = 'success'
        ORDER BY related_score DESC, published_date DESC
        LIMIT ?
        """,
        (cutoff, limit),
    ).fetchall()

    if not rows:
        return pd.DataFrame()

    items = []
    for row in rows:
        analysis = {}
        try:
            analysis = json.loads(row[11])
        except Exception:
            analysis = {}
        items.append(
            {
                "doi": row[0],
                "source": row[1],
                "query_name": row[2],
                "published_date": row[3],
                "title": row[4],
                "url": row[5],
                "authors": row[6],
                "primary_category": row[7],
                "categories": row[8],
                "english_abstract": row[9],
                "中文摘要": row[10],
                "研究主题": analysis.get("研究主题", ""),
                "空间/场景类型": analysis.get("空间/场景类型", ""),
                "研究场景": analysis.get("研究场景", ""),
                "自变量": analysis.get("自变量", ""),
                "因变量": analysis.get("因变量", ""),
                "行为指标": analysis.get("行为指标", ""),
                "生理/感知指标": analysis.get("生理/感知指标", ""),
                "研究方法": analysis.get("研究方法", ""),
                "数据/样本": analysis.get("数据/样本", ""),
                "主要结论": analysis.get("主要结论", ""),
                "与建筑/体育空间研究相关性": analysis.get("与建筑/体育空间研究相关性", ""),
                "相关性分数": row[12],
                "可借鉴启发": analysis.get("可借鉴启发", ""),
                "原始分析": analysis.get("原始分析", ""),
            }
        )
    return pd.DataFrame(items)


def upsert_paper(
    conn: sqlite3.Connection,
    source: str,
    url: str,
    doi: str,
    title: str,
    english_abstract: str,
    chinese_summary: str,
    published_date: str,
    query_name: str,
    authors: list[str],
    primary_category: str,
    categories: list[str],
    analysis: dict,
    meets_threshold: bool,
    eligible_for_pending: bool,
    content_hash: str,
):
    now = datetime.now().isoformat(timespec="seconds")
    existing = conn.execute("SELECT first_seen_at, report_count, reported_at FROM papers WHERE url = ? OR doi = ? LIMIT 1", (url, doi)).fetchone()
    first_seen_at = existing[0] if existing and existing[0] else now
    report_count = existing[1] if existing and existing[1] is not None else 0
    reported_at = existing[2] if existing else None

    conn.execute(
        """
        INSERT INTO papers (
            url, doi, source, title, english_abstract, chinese_summary, published_date, query_name, authors,
            primary_category, categories, analysis_json, related_score, analysis_status, meets_threshold,
            eligible_for_pending, first_seen_at, last_seen_at, displayed_at, display_count, reported_at, report_count, content_hash, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET
            doi=excluded.doi,
            source=excluded.source,
            title=excluded.title,
            english_abstract=excluded.english_abstract,
            chinese_summary=excluded.chinese_summary,
            published_date=excluded.published_date,
            query_name=excluded.query_name,
            authors=excluded.authors,
            primary_category=excluded.primary_category,
            categories=excluded.categories,
            analysis_json=excluded.analysis_json,
            related_score=excluded.related_score,
            analysis_status=excluded.analysis_status,
            meets_threshold=excluded.meets_threshold,
            eligible_for_pending=excluded.eligible_for_pending,
            last_seen_at=excluded.last_seen_at,
            content_hash=excluded.content_hash,
            updated_at=excluded.updated_at
        """,
        (
            url,
            doi,
            source,
            title,
            english_abstract,
            chinese_summary,
            published_date,
            query_name,
            "; ".join(authors),
            primary_category,
            "; ".join(categories),
            json.dumps(analysis, ensure_ascii=False),
            analysis.get("相关性分数", 0),
            analysis.get("分析状态", "unknown"),
            1 if meets_threshold else 0,
            1 if eligible_for_pending else 0,
            first_seen_at,
            now,
            None,
            0,
            reported_at,
            report_count,
            content_hash,
            now,
            now,
        ),
    )
    conn.commit()


def parse_analysis_text(text: str) -> dict:
    result = {
        "中文摘要": "",
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
请根据下面论文标题和英文摘要，输出适合空间研究者使用的结构化信息。

要求：
1. 用简洁中文。
2. 先给出一句“中文摘要”。
3. 如果摘要没有明确写出，就写“未明确说明”，不要瞎编。
4. “相关性分数”请按 0-100 打分。
5. 特别关注：空间类型、研究场景、行为变量、生理指标、VR/轨迹方法、是否能迁移到建筑/体育空间研究。

请严格按下面格式输出：

中文摘要：
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

英文摘要：{abstract}
"""

    last_error = None
    for attempt in range(1, retries + 1):
        try:
            response = client.responses.create(model=model, input=prompt)
            text = response.output_text.strip()
            result = parse_analysis_text(text)
            result["分析状态"] = "success"
            return result
        except Exception as e:
            last_error = e
            if attempt < retries:
                time.sleep(retry_delay * attempt)

    return {
        "中文摘要": "",
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
        "分析状态": "failed",
    }


def normalize_date(value: str) -> str:
    if not value:
        return ""
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).strftime("%Y-%m-%d")
    except Exception:
        return value[:10]


def fetch_arxiv_results(query_text: str, max_results: int) -> list[dict]:
    items = []
    search = arxiv.Search(
        query=query_text,
        max_results=max_results,
        sort_by=arxiv.SortCriterion.SubmittedDate,
    )
    for result in search.results():
        published = result.published
        if published.tzinfo is None:
            published = published.replace(tzinfo=timezone.utc)
        items.append(
            {
                "source": "arxiv",
                "doi": normalize_doi(getattr(result, 'doi', '') or ''),
                "title": (result.title or "").strip(),
                "abstract": (result.summary or "").strip(),
                "url": result.entry_id,
                "published": published,
                "authors": [a.name for a in getattr(result, "authors", [])],
                "primary_category": getattr(result, "primary_category", "") or "",
                "categories": getattr(result, "categories", []) or [],
            }
        )
    return items


def fetch_openalex_results(query_text: str, max_results: int) -> list[dict]:
    items = []
    try:
        url = "https://api.openalex.org/works"
        params = {
            "search": query_text,
            "per-page": min(max_results, 25),
            "sort": "publication_date:desc",
        }
        data = requests.get(url, params=params, headers=REQUEST_HEADERS, timeout=30).json()
        for work in data.get("results", []):
            abstract = ""
            inverted = work.get("abstract_inverted_index")
            if inverted:
                terms = []
                for word, positions in inverted.items():
                    for p in positions:
                        terms.append((p, word))
                abstract = " ".join(word for _, word in sorted(terms))
            if not abstract:
                abstract = work.get("title", "")
            items.append(
                {
                    "source": "openalex",
                    "doi": normalize_doi(work.get("doi") or ""),
                    "title": work.get("title", "").strip(),
                    "abstract": abstract.strip(),
                    "url": work.get("primary_location", {}).get("landing_page_url")
                    or work.get("doi")
                    or f"https://openalex.org/{work.get('id','').split('/')[-1]}",
                    "published": datetime.fromisoformat((work.get("publication_date") or "1970-01-01") + "T00:00:00+00:00"),
                    "authors": [a.get("author", {}).get("display_name", "") for a in work.get("authorships", []) if a.get("author", {}).get("display_name")],
                    "primary_category": (work.get("primary_topic") or {}).get("display_name", ""),
                    "categories": [c.get("display_name", "") for c in work.get("concepts", [])[:8] if c.get("display_name")],
                }
            )
    except Exception:
        return []
    return items


def fetch_crossref_results(query_text: str, max_results: int) -> list[dict]:
    items = []
    try:
        url = "https://api.crossref.org/works"
        params = {"query": query_text, "rows": min(max_results, 20), "sort": "published", "order": "desc"}
        data = requests.get(url, params=params, headers=REQUEST_HEADERS, timeout=30).json()
        for work in data.get("message", {}).get("items", []):
            abstract = work.get("abstract", "") or ""
            abstract = abstract.replace("<jats:p>", "").replace("</jats:p>", " ").strip()
            title = (work.get("title") or [""])[0]
            published_parts = (((work.get("published-print") or work.get("published-online") or {}).get("date-parts") or [[1970, 1, 1]])[0])
            while len(published_parts) < 3:
                published_parts.append(1)
            items.append(
                {
                    "source": "crossref",
                    "doi": normalize_doi(work.get("DOI") or work.get("doi") or ""),
                    "title": title.strip(),
                    "abstract": (abstract or title).strip(),
                    "url": work.get("URL", ""),
                    "published": datetime(published_parts[0], published_parts[1], published_parts[2], tzinfo=timezone.utc),
                    "authors": [" ".join(filter(None, [a.get("given", ""), a.get("family", "")])).strip() for a in work.get("author", []) if (a.get("given") or a.get("family"))],
                    "primary_category": (work.get("subject") or [""])[0],
                    "categories": work.get("subject", [])[:8],
                }
            )
    except Exception:
        return []
    return items


def fetch_semantic_scholar_results(query_text: str, max_results: int) -> list[dict]:
    items = []
    try:
        url = "https://api.semanticscholar.org/graph/v1/paper/search"
        params = {
            "query": query_text,
            "limit": min(max_results, 20),
            "fields": "title,abstract,url,year,authors,publicationDate,fieldsOfStudy,externalIds",
        }
        data = requests.get(url, params=params, headers=REQUEST_HEADERS, timeout=30).json()
        for paper in data.get("data", []):
            date_str = paper.get("publicationDate") or f"{paper.get('year', 1970)}-01-01"
            items.append(
                {
                    "source": "semantic_scholar",
                    "doi": normalize_doi(paper.get("externalIds", {}).get("DOI", "") if isinstance(paper.get("externalIds"), dict) else ""),
                    "title": (paper.get("title") or "").strip(),
                    "abstract": (paper.get("abstract") or paper.get("title") or "").strip(),
                    "url": paper.get("url") or f"https://www.semanticscholar.org/paper/{paper.get('paperId','')}",
                    "published": datetime.fromisoformat(normalize_date(date_str) + "T00:00:00+00:00"),
                    "authors": [a.get("name", "") for a in paper.get("authors", []) if a.get("name")],
                    "primary_category": (paper.get("fieldsOfStudy") or [""])[0],
                    "categories": paper.get("fieldsOfStudy", [])[:8],
                }
            )
    except Exception:
        return []
    return items


def fetch_source_results(source_name: str, query_text: str, max_results: int) -> list[dict]:
    if source_name == "arxiv":
        return fetch_arxiv_results(query_text, max_results)
    if source_name == "openalex":
        return fetch_openalex_results(query_text, max_results)
    if source_name == "crossref":
        return fetch_crossref_results(query_text, max_results)
    if source_name == "semantic_scholar":
        return fetch_semantic_scholar_results(query_text, max_results)
    return []


def resolve_query_for_source(source_name: str, query_name: str, queries: dict, generic_queries: dict) -> str:
    if source_name == "arxiv":
        return queries.get(query_name, "")
    return generic_queries.get(query_name) or queries.get(query_name, "")


def result_to_row(query_name: str, item: dict, analysis: dict) -> dict:
    return {
        "doi": item.get("doi", ""),
        "source": item["source"],
        "query_name": query_name,
        "published_date": item["published"].strftime("%Y-%m-%d"),
        "title": item["title"],
        "url": item["url"],
        "authors": "; ".join(item["authors"]),
        "primary_category": item["primary_category"],
        "categories": "; ".join(item["categories"]),
        "english_abstract": item["abstract"],
        "中文摘要": analysis["中文摘要"],
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


def build_email_body(df: pd.DataFrame, today_str: str, top_n: int = 5) -> str:
    lines = []
    lines.append(f"arxiv_agent 文献简报｜{today_str}")
    lines.append("")

    if df.empty:
        lines.append("今天没有符合条件的新论文进入最终收录。")
        lines.append("可检查抓取窗口、相关性阈值、数据源配置或 API 调用情况。")
        return "\n".join(lines)

    lines.append(f"今日最终收录：{len(df)} 篇")
    lines.append(f"高相关（>=80分）：{len(df[df['相关性分数'] >= 80])} 篇")
    lines.append(f"数据源：{', '.join(sorted(df['source'].dropna().unique()))}")
    lines.append("")
    lines.append(f"TOP {top_n} 论文概览")
    lines.append("-" * 24)

    top_df = df.sort_values(by=["相关性分数", "published_date"], ascending=[False, False]).head(top_n)
    for idx, (_, row) in enumerate(top_df.iterrows(), start=1):
        lines.append(f"{idx}. {row['title']}")
        lines.append(f"   来源：{row['source']}｜日期：{row['published_date']}｜分数：{row['相关性分数']}")
        lines.append(f"   链接：{row['url']}")
        lines.append(f"   中文摘要：{row['中文摘要']}")
        lines.append(f"   启发：{row['可借鉴启发']}")
        lines.append("")

    lines.append("附件中包含完整 Markdown、Excel 和运行统计。")
    return "\n".join(lines)


def parse_recipients(value: str) -> list[str]:
    if not value:
        return []
    parts = [v.strip() for v in value.split(",")]
    return [p for p in parts if p]


def send_email_via_brevo(runtime: dict, subject: str, body: str, attachments: list[str] | None = None):
    attachments = attachments or []
    required = ["email_username", "email_password", "email_from", "email_to"]
    missing = [k for k in required if not runtime.get(k)]
    if missing:
        raise ValueError(f"邮件推送缺少必要环境变量：{', '.join(missing)}")

    recipients = parse_recipients(runtime["email_to"])
    if not recipients:
        raise ValueError("EMAIL_TO 没有可用收件人")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = runtime["email_from"]
    msg["To"] = ", ".join(recipients)
    msg.set_content(body)

    for file_path in attachments:
        if not file_path or not os.path.exists(file_path):
            continue
        with open(file_path, "rb") as f:
            data = f.read()
        filename = os.path.basename(file_path)
        maintype = "application"
        subtype = "octet-stream"
        if filename.endswith(".md"):
            maintype, subtype = "text", "markdown"
        elif filename.endswith(".xlsx"):
            maintype, subtype = "application", "vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        elif filename.endswith(".json"):
            maintype, subtype = "application", "json"
        msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=filename)

    with smtplib.SMTP(runtime["email_smtp_host"], runtime["email_smtp_port"], timeout=30) as server:
        if runtime.get("email_use_tls", True):
            server.starttls()
        server.login(runtime["email_username"], runtime["email_password"])
        server.send_message(msg)


def write_markdown(md_path: str, df: pd.DataFrame, today_str: str, report_top_n: int = 10):
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(f"# 文献简报（{today_str}）\n\n")

        if df.empty:
            f.write("今天没有符合条件的新论文进入最终收录。\n")
            f.write("\n")
            f.write("建议检查：\n")
            f.write("- 抓取窗口是否过窄\n")
            f.write("- 相关性阈值是否过高\n")
            f.write("- 数据源是否返回结果\n")
            f.write("- AI 分析是否成功\n")
            return

        f.write("## 概览\n\n")
        f.write(f"- 今日最终收录：{len(df)} 篇\n")
        f.write(f"- 高相关（>=80分）：{len(df[df['相关性分数'] >= 80])} 篇\n")
        f.write(f"- 中高相关（>=60分）：{len(df[df['相关性分数'] >= 60])} 篇\n")
        f.write(f"- 数据源：{', '.join(sorted(df['source'].dropna().unique()))}\n\n")

        top_df = df.sort_values(by=["相关性分数", "published_date"], ascending=[False, False]).head(report_top_n)
        f.write(f"## TOP {report_top_n} 优先关注\n\n")
        for idx, (_, row) in enumerate(top_df.iterrows(), start=1):
            f.write(f"### {idx}. {row['title']}\n\n")
            f.write(f"- 分数：{row['相关性分数']}\n")
            f.write(f"- 来源：{row['source']}\n")
            f.write(f"- 分组：{row['query_name']}\n")
            f.write(f"- 链接：{row['url']}\n")
            f.write(f"- 中文摘要：{row['中文摘要']}\n")
            f.write(f"- 可借鉴启发：{row['可借鉴启发']}\n\n")

        grouped = df.sort_values(by=["query_name", "相关性分数"], ascending=[True, False]).groupby("query_name")
        for group_name, sub_df in grouped:
            f.write(f"## 分组：{group_name}\n\n")
            for _, row in sub_df.iterrows():
                f.write(f"### {row['title']}\n\n")
                f.write(f"- 来源：{row['source']}\n")
                f.write(f"- 日期：{row['published_date']}\n")
                f.write(f"- 作者：{row['authors']}\n")
                f.write(f"- 分类：{row['primary_category']}\n")
                f.write(f"- 链接：{row['url']}\n")
                f.write(f"- 中文摘要：{row['中文摘要']}\n")
                f.write(f"- 英文摘要：{truncate_text(str(row['english_abstract']), 1200)}\n")
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
    client, runtime = load_env()

    output_dir = config.get("output_dir", "output")
    output_prefix = config.get("output_prefix", "arxiv_daily")
    max_chars_per_paper = config.get("max_chars_per_paper", 6000)
    openai_model = runtime["openai_model"]
    days_back = runtime["days_back"]
    max_results_per_query = runtime["max_results_per_query"]
    queries = config.get("queries", {})
    generic_queries = config.get("generic_queries", {})
    exclude_keywords = config.get("exclude_keywords", [])
    must_have_keywords = config.get("must_have_keywords", [])
    db_path = config.get("db_path", DB_PATH)
    analysis_retries = config.get("analysis_retries", 3)
    retry_delay_seconds = config.get("retry_delay_seconds", 3)
    min_relevance_score = runtime["min_relevance_score"]
    force_refresh = runtime["force_refresh"]
    sources = config.get("sources", ["arxiv"])

    ensure_output_dir(output_dir)
    conn = init_db(db_path)
    migrate_db(conn)

    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days_back)

    all_rows = []
    today_new_rows = []
    seen_urls = set()
    seen_keys = set()
    stats = {
        "fetched": 0,
        "too_old": 0,
        "duplicate": 0,
        "excluded": 0,
        "must_have_filtered": 0,
        "cache_hit": 0,
        "analyzed": 0,
        "analysis_success": 0,
        "analysis_failed": 0,
        "below_min_relevance": 0,
        "already_reported": 0,
        "kept": 0,
    }

    for query_name, query_text in queries.items():
        print(f"正在抓取 query: {query_name}")

        for source_name in sources:
            effective_query = resolve_query_for_source(source_name, query_name, queries, generic_queries)
            print(f"  来源: {source_name}")
            print(f"  使用检索式: {effective_query[:160]}{'...' if len(effective_query) > 160 else ''}")
            source_items = fetch_source_results(source_name, effective_query, max_results_per_query)

            for item in source_items:
                stats["fetched"] += 1
                title = (item.get("title") or "").strip()
                abstract = (item.get("abstract") or "").strip()
                url = item.get("url") or ""
                published = item.get("published")

                if not url or not title or not published:
                    continue
                if published.tzinfo is None:
                    published = published.replace(tzinfo=timezone.utc)

                if published < cutoff_date:
                    stats["too_old"] += 1
                    continue

                dedupe_key = ("doi", item.get("doi")) if item.get("doi") else ("url", url)
                if dedupe_key in seen_keys or url in seen_urls:
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
                seen_keys.add(dedupe_key)
                short_abstract = truncate_text(abstract, max_chars_per_paper)
                content_hash = hashlib.sha256(f"{title}\n{short_abstract}".encode("utf-8", errors="ignore")).hexdigest()

                record = None if force_refresh else get_paper_record(conn, url, item.get("doi", ""))
                cached = None
                if record and record.get("content_hash") == content_hash:
                    cached = get_cached_analysis(conn, url, item.get("doi", ""))
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

                if analysis.get("分析状态") == "failed" or str(analysis.get("原始分析", "")).startswith("分析失败"):
                    stats["analysis_failed"] += 1
                else:
                    stats["analysis_success"] += 1

                row = result_to_row(query_name, item, analysis)
                meets_threshold = row["相关性分数"] >= min_relevance_score
                eligible_for_pending = analysis.get("分析状态") == "success" and meets_threshold

                upsert_paper(
                    conn=conn,
                    source=item["source"],
                    url=url,
                    doi=item.get("doi", ""),
                    title=title,
                    english_abstract=abstract,
                    chinese_summary=analysis.get("中文摘要", ""),
                    published_date=published.strftime("%Y-%m-%d"),
                    query_name=query_name,
                    authors=item.get("authors", []),
                    primary_category=item.get("primary_category", ""),
                    categories=item.get("categories", []),
                    analysis=analysis,
                    meets_threshold=meets_threshold,
                    eligible_for_pending=eligible_for_pending,
                    content_hash=content_hash,
                )

                if not meets_threshold:
                    stats["below_min_relevance"] += 1
                    continue

                if was_reported(conn, url, item.get("doi", "")):
                    stats["already_reported"] += 1
                    continue

                stats["kept"] += 1
                today_new_rows.append(row)

    today_str = datetime.now().strftime("%Y-%m-%d")
    excel_path = os.path.join(output_dir, f"{output_prefix}_{today_str}.xlsx")
    md_path = os.path.join(output_dir, f"{output_prefix}_{today_str}.md")
    stats_path = os.path.join(output_dir, f"{output_prefix}_{today_str}_stats.json")

    all_rows = list(today_new_rows)
    target_size = max(runtime.get("report_top_n", 10), runtime.get("email_top_n", 5))
    if len(all_rows) < target_size:
        pending_df = load_pending_pool(conn, runtime.get("pending_pool_days", 7), target_size * 3)
        if not pending_df.empty:
            existing_keys = {(r.get('doi') or '', r.get('url')) for r in all_rows}
            for _, prow in pending_df.iterrows():
                key = (prow.get('doi') or '', prow.get('url'))
                if key in existing_keys:
                    continue
                all_rows.append(prow.to_dict())
                existing_keys.add(key)
                if len(all_rows) >= target_size:
                    break

    df = pd.DataFrame(all_rows)

    if not df.empty:
        df = df.sort_values(by=["相关性分数", "published_date"], ascending=[False, False])
        df.to_excel(excel_path, index=False)

    write_markdown(md_path, df, today_str, runtime.get("report_top_n", 10))

    if not df.empty:
        mark_displayed(conn, df["url"].tolist(), df.get("doi", pd.Series(dtype=str)).fillna("").tolist())

    with open(stats_path, "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)

    if runtime.get("email_enabled") and (not df.empty or runtime.get("empty_report_email", True)):
        try:
            email_subject = f"[arxiv_agent] 文献简报 {today_str}｜收录 {len(df)} 篇"
            email_body = build_email_body(df, today_str, runtime.get("email_top_n", 5))
            send_email_via_brevo(
                runtime=runtime,
                subject=email_subject,
                body=email_body,
                attachments=[md_path, excel_path if not df.empty else "", stats_path],
            )
            if not df.empty:
                mark_reported(conn, df["url"].tolist(), df.get("doi", pd.Series(dtype=str)).fillna("").tolist())
            print("邮件推送已发送。")
        except Exception as e:
            print(f"邮件推送失败：{e}")

    if df.empty:
        print("没有抓到符合条件的新论文。")
    else:
        print(f"已生成 Excel：{excel_path}")
    print(f"已生成 Markdown：{md_path}")
    print(f"已生成统计：{stats_path}")
    print("运行统计：", stats)


if __name__ == "__main__":
    main()
