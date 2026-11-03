"""Transactional email for account verification and password reset.

Stdlib only (``smtplib``). Mode comes from ``KGSM_MAIL_MODE``:

- ``smtp``   production: sends through the server named by ``KGSM_SMTP_HOST``.
- ``memory`` tests: messages collect in :data:`OUTBOX`.
- ``off``    default when no SMTP host is set. Sending fails with
  :class:`MailError`, so sign-up cannot silently skip verification.

SMTP settings: ``KGSM_SMTP_HOST``, ``KGSM_SMTP_PORT`` (587 STARTTLS, or 465
implicit TLS), ``KGSM_SMTP_USER``, ``KGSM_SMTP_PASSWORD``, ``KGSM_MAIL_FROM``.
Links point at ``KGSM_PUBLIC_URL`` (default ``https://basyid.dev/kgsm``).
Secrets belong in an EnvironmentFile readable only by root and the service user.
"""

from __future__ import annotations

import os
import smtplib
import ssl
import threading
from email.message import EmailMessage
from email.utils import formataddr

OUTBOX: list[dict] = []
_outbox_lock = threading.Lock()


class MailError(Exception):
    """Sending failed or mail is not configured. The route maps this to 503."""


def mode() -> str:
    explicit = os.environ.get("KGSM_MAIL_MODE", "").strip().lower()
    if explicit in ("smtp", "memory", "off"):
        return explicit
    return "smtp" if os.environ.get("KGSM_SMTP_HOST", "").strip() else "off"


def public_url() -> str:
    return os.environ.get("KGSM_PUBLIC_URL", "https://basyid.dev/kgsm").rstrip("/")


def _from_address() -> str:
    sender = os.environ.get("KGSM_MAIL_FROM", "").strip()
    if not sender:
        sender = os.environ.get("KGSM_SMTP_USER", "").strip()
    if not sender:
        raise MailError("mail sender is not configured (KGSM_MAIL_FROM)")
    return formataddr(("Kawalight Game Studio Maker", sender))


def send(to: str, subject: str, text: str) -> None:
    """Deliver one plain-text message. Raises :class:`MailError` on failure."""
    current = mode()
    if current == "off":
        raise MailError("email is not configured on this server")
    if current == "memory":
        with _outbox_lock:
            OUTBOX.append({"to": to, "subject": subject, "text": text})
        return

    message = EmailMessage()
    message["From"] = _from_address()
    message["To"] = to
    message["Subject"] = subject
    message.set_content(text)

    host = os.environ.get("KGSM_SMTP_HOST", "").strip()
    port = int(os.environ.get("KGSM_SMTP_PORT", "587") or 587)
    user = os.environ.get("KGSM_SMTP_USER", "").strip()
    password = os.environ.get("KGSM_SMTP_PASSWORD", "")
    context = ssl.create_default_context()
    try:
        if port == 465:
            server = smtplib.SMTP_SSL(host, port, context=context, timeout=20)
        else:
            server = smtplib.SMTP(host, port, timeout=20)
        with server:
            if port != 465:
                server.starttls(context=context)
            if user:
                server.login(user, password)
            server.send_message(message)
    except (smtplib.SMTPException, OSError) as exc:
        # Never include credentials or the message body in the error.
        raise MailError(f"could not send email ({type(exc).__name__})") from None


def verification_message(link: str) -> tuple[str, str]:
    subject = "Confirm your Kawalight Game Studio Maker email"
    text = (
        "Welcome to Kawalight Game Studio Maker.\n\n"
        "Confirm your email to activate your account:\n"
        f"{link}\n\n"
        "The link expires in 24 hours. If you did not sign up, you can ignore this email.\n"
    )
    return subject, text


def reset_message(link: str) -> tuple[str, str]:
    subject = "Reset your Kawalight Game Studio Maker password"
    text = (
        "We received a request to reset your password.\n\n"
        f"Choose a new password here:\n{link}\n\n"
        "The link expires in 1 hour and works once. If you did not ask for this, "
        "ignore this email; your password stays the same.\n"
    )
    return subject, text
