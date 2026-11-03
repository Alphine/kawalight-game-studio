"""SMTP delivery path of the mailer, with smtplib replaced by a fake server."""

import smtplib

import pytest

from kgsm import mailer


class FakeSMTP:
    instances = []
    fail_with = None

    def __init__(self, host, port, timeout=None, **_):
        self.host, self.port = host, port
        self.calls = []
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self, context=None):
        self.calls.append("starttls")

    def login(self, user, password):
        self.calls.append(("login", user))
        if FakeSMTP.fail_with:
            raise FakeSMTP.fail_with

    def send_message(self, message):
        self.calls.append(("send", message["To"], message["Subject"]))


@pytest.fixture()
def smtp(monkeypatch):
    FakeSMTP.instances.clear()
    FakeSMTP.fail_with = None
    monkeypatch.setattr(mailer.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setenv("KGSM_MAIL_MODE", "smtp")
    monkeypatch.setenv("KGSM_SMTP_HOST", "smtp.example.test")
    monkeypatch.setenv("KGSM_SMTP_PORT", "587")
    monkeypatch.setenv("KGSM_SMTP_USER", "mailer@example.test")
    monkeypatch.setenv("KGSM_SMTP_PASSWORD", "super-secret-value")
    monkeypatch.setenv("KGSM_MAIL_FROM", "mailer@example.test")
    yield


def test_send_uses_starttls_and_login_then_delivers(smtp):
    mailer.send("alice@example.com", "Subject here", "Body")
    (server,) = FakeSMTP.instances
    assert server.host == "smtp.example.test" and server.port == 587
    assert server.calls[0] == "starttls"
    assert server.calls[1] == ("login", "mailer@example.test")
    assert server.calls[2] == ("send", "alice@example.com", "Subject here")


def test_failures_surface_without_credentials_or_body(smtp):
    FakeSMTP.fail_with = smtplib.SMTPAuthenticationError(535, b"bad creds")
    with pytest.raises(mailer.MailError) as exc:
        mailer.send("alice@example.com", "Subject", "Secret body text")
    message = str(exc.value)
    assert "super-secret-value" not in message
    assert "Secret body" not in message
    assert "SMTPAuthenticationError" in message


def test_mode_off_refuses_to_send(monkeypatch):
    monkeypatch.setenv("KGSM_MAIL_MODE", "off")
    with pytest.raises(mailer.MailError):
        mailer.send("alice@example.com", "Subject", "Body")


def test_mode_defaults_to_smtp_only_when_host_is_set(monkeypatch):
    monkeypatch.delenv("KGSM_MAIL_MODE", raising=False)
    monkeypatch.delenv("KGSM_SMTP_HOST", raising=False)
    assert mailer.mode() == "off"
    monkeypatch.setenv("KGSM_SMTP_HOST", "smtp.example.test")
    assert mailer.mode() == "smtp"
