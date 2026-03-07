import os
import sqlite3
import sys

from dotenv import load_dotenv


def main():
    load_dotenv()
    db_path = os.getenv("DB_PATH", "papers.db")

    if not os.path.exists(db_path):
        print(f"数据库不存在：{db_path}")
        return

    mode = sys.argv[1] if len(sys.argv) > 1 else "all"

    conn = sqlite3.connect(db_path)

    if mode == "all":
        conn.execute("UPDATE papers SET reported_at = NULL, report_count = 0")
        conn.commit()
        print("已重置全部论文的 reported 状态。")
    elif mode == "displayed":
        conn.execute("UPDATE papers SET displayed_at = NULL, display_count = 0")
        conn.commit()
        print("已重置全部论文的 displayed 状态。")
    elif mode == "both":
        conn.execute("UPDATE papers SET reported_at = NULL, report_count = 0, displayed_at = NULL, display_count = 0")
        conn.commit()
        print("已同时重置 reported / displayed 状态。")
    else:
        print("用法：")
        print("  python reset_reported.py all       # 重置 reported")
        print("  python reset_reported.py displayed # 重置 displayed")
        print("  python reset_reported.py both      # 两者都重置")

    conn.close()


if __name__ == "__main__":
    main()
