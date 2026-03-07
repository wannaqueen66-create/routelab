import os
import smtplib
from email.message import EmailMessage

from dotenv import load_dotenv


def parse_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def main():
    load_dotenv()

    host = os.getenv("EMAIL_SMTP_HOST", "smtp-relay.brevo.com")
    port = int(os.getenv("EMAIL_SMTP_PORT", "587"))
    user = os.getenv("EMAIL_USERNAME", "")
    password = os.getenv("EMAIL_PASSWORD", "")
    mail_from = os.getenv("EMAIL_FROM", "")
    mail_to = os.getenv("EMAIL_TO", "")
    use_tls = parse_bool(os.getenv("EMAIL_USE_TLS"), True)

    required = {
        "EMAIL_USERNAME": user,
        "EMAIL_PASSWORD": password,
        "EMAIL_FROM": mail_from,
        "EMAIL_TO": mail_to,
    }
    missing = [k for k, v in required.items() if not v]
    if missing:
        raise ValueError(f"缺少必要环境变量：{', '.join(missing)}")

    msg = EmailMessage()
    msg["Subject"] = "arxiv_agent 邮件测试"
    msg["From"] = mail_from
    msg["To"] = mail_to
    msg.set_content(
        "这是一封来自 arxiv_agent 的测试邮件。\n\n"
        "如果你收到了这封邮件，说明当前的 Brevo SMTP 配置是可用的。"
    )

    with smtplib.SMTP(host, port, timeout=30) as server:
        if use_tls:
            server.starttls()
        server.login(user, password)
        server.send_message(msg)

    print("测试邮件已发送成功。")


if __name__ == "__main__":
    main()
