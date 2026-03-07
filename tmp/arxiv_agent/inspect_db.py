import os
import sqlite3
from collections import Counter
from datetime import datetime, timedelta

from dotenv import load_dotenv


def main():
    load_dotenv()
    db_path = os.getenv("DB_PATH", "papers.db")
    pending_days = int(os.getenv("PENDING_POOL_DAYS", "7"))

    if not os.path.exists(db_path):
        print(f"数据库不存在：{db_path}")
        return

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    total = conn.execute("SELECT COUNT(*) AS c FROM papers").fetchone()["c"]
    success = conn.execute("SELECT COUNT(*) AS c FROM papers WHERE analysis_status='success'").fetchone()["c"]
    failed = conn.execute("SELECT COUNT(*) AS c FROM papers WHERE analysis_status='failed'").fetchone()["c"]
    threshold = conn.execute("SELECT COUNT(*) AS c FROM papers WHERE COALESCE(meets_threshold,0)=1").fetchone()["c"]
    displayed = conn.execute("SELECT COUNT(*) AS c FROM papers WHERE displayed_at IS NOT NULL").fetchone()["c"]
    reported = conn.execute("SELECT COUNT(*) AS c FROM papers WHERE reported_at IS NOT NULL").fetchone()["c"]

    cutoff = (datetime.now() - timedelta(days=pending_days)).strftime("%Y-%m-%d")
    pending = conn.execute(
        """
        SELECT COUNT(*) AS c FROM papers
        WHERE displayed_at IS NULL
          AND COALESCE(meets_threshold,0)=1
          AND COALESCE(eligible_for_pending,0)=1
          AND analysis_status='success'
          AND published_date >= ?
        """,
        (cutoff,),
    ).fetchone()["c"]

    print("=== 数据库概览 ===")
    print(f"DB_PATH: {db_path}")
    print(f"总记录数: {total}")
    print(f"AI 分析成功: {success}")
    print(f"AI 分析失败: {failed}")
    print(f"达到阈值: {threshold}")
    print(f"已展示(displayed): {displayed}")
    print(f"已上报(reported): {reported}")
    print(f"当前待展示池({pending_days}天): {pending}")

    print("\n=== 来源分布 ===")
    rows = conn.execute("SELECT source, COUNT(*) AS c FROM papers GROUP BY source ORDER BY c DESC").fetchall()
    for row in rows:
        print(f"- {row['source']}: {row['c']}")

    print("\n=== 近期待展示 TOP 10 ===")
    rows = conn.execute(
        """
        SELECT title, source, published_date, related_score
        FROM papers
        WHERE displayed_at IS NULL
          AND COALESCE(meets_threshold,0)=1
          AND COALESCE(eligible_for_pending,0)=1
          AND analysis_status='success'
          AND published_date >= ?
        ORDER BY related_score DESC, published_date DESC
        LIMIT 10
        """,
        (cutoff,),
    ).fetchall()
    if not rows:
        print("(空)")
    else:
        for i, row in enumerate(rows, start=1):
            print(f"{i}. [{row['source']}] {row['published_date']} | {row['related_score']} | {row['title']}")

    conn.close()


if __name__ == "__main__":
    main()
