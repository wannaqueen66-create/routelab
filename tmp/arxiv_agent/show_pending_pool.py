import os
import sqlite3
from datetime import datetime, timedelta

from dotenv import load_dotenv


def main():
    load_dotenv()
    db_path = os.getenv("DB_PATH", "papers.db")
    pending_days = int(os.getenv("PENDING_POOL_DAYS", "7"))
    limit = int(os.getenv("REPORT_TOP_N", "10"))

    if not os.path.exists(db_path):
        print(f"数据库不存在：{db_path}")
        return

    cutoff = (datetime.now() - timedelta(days=pending_days)).strftime("%Y-%m-%d")

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    rows = conn.execute(
        """
        SELECT doi, source, query_name, published_date, title, url, related_score,
               display_count, report_count
        FROM papers
        WHERE displayed_at IS NULL
          AND COALESCE(meets_threshold,0)=1
          AND COALESCE(eligible_for_pending,0)=1
          AND analysis_status='success'
          AND published_date >= ?
        ORDER BY related_score DESC, published_date DESC
        LIMIT ?
        """,
        (cutoff, limit),
    ).fetchall()

    print(f"=== 待展示池（最近 {pending_days} 天，最多显示 {limit} 条）===")
    if not rows:
        print("(空)")
        conn.close()
        return

    for i, row in enumerate(rows, start=1):
        print(f"{i}. {row['title']}")
        print(f"   来源: {row['source']}")
        print(f"   分组: {row['query_name']}")
        print(f"   日期: {row['published_date']}")
        print(f"   分数: {row['related_score']}")
        print(f"   DOI: {row['doi'] or '-'}")
        print(f"   URL: {row['url']}")
        print(f"   display_count: {row['display_count'] or 0} | report_count: {row['report_count'] or 0}")
        print()

    conn.close()


if __name__ == "__main__":
    main()
