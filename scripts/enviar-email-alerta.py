# -*- coding: utf-8 -*-
"""Envio de e-mail de alerta operacional — canal privado, separado do grupo publico.

Le a configuracao SMTP de private/email_config.json (fora do git) e envia um
e-mail simples. Usado pelo check-pipeline-health.mjs quando detecta que a
automacao parou ou falha ha tempo demais. Usa apenas a stdlib (smtplib) — sem
dependencia nova.

Uso: python scripts/enviar-email-alerta.py "<assunto>" "<corpo>"
Retorna codigo 0 em sucesso, 1 em falha (config ausente/incompleta ou erro SMTP).
"""
import json
import smtplib
import ssl
import sys
from email.message import EmailMessage
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "private" / "email_config.json"


def carregar_config() -> dict | None:
    if not CONFIG_PATH.exists():
        print(f"AVISO: {CONFIG_PATH} nao existe; e-mail nao enviado.", file=sys.stderr)
        return None
    try:
        cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"AVISO: falha ao ler {CONFIG_PATH}: {e}", file=sys.stderr)
        return None
    faltando = [k for k in ("host", "port", "user", "password", "para") if not cfg.get(k)]
    if faltando:
        print(f"AVISO: config de e-mail incompleta (falta: {', '.join(faltando)}).", file=sys.stderr)
        return None
    return cfg


def enviar(assunto: str, corpo: str) -> bool:
    cfg = carregar_config()
    if not cfg:
        return False

    msg = EmailMessage()
    msg["Subject"] = assunto
    msg["From"] = cfg.get("remetente") or cfg["user"]
    msg["To"] = cfg["para"]
    msg.set_content(corpo)

    porta = int(cfg["port"])
    host = cfg["host"]
    try:
        if porta == 465:
            contexto = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, porta, timeout=30, context=contexto) as s:
                s.login(cfg["user"], cfg["password"])
                s.send_message(msg)
        else:
            with smtplib.SMTP(host, porta, timeout=30) as s:
                s.starttls(context=ssl.create_default_context())
                s.login(cfg["user"], cfg["password"])
                s.send_message(msg)
        return True
    except Exception as e:
        print(f"AVISO: falha ao enviar e-mail: {e}", file=sys.stderr)
        return False


def main():
    if len(sys.argv) < 3:
        print("Uso: python scripts/enviar-email-alerta.py <assunto> <corpo>", file=sys.stderr)
        sys.exit(1)
    ok = enviar(sys.argv[1], sys.argv[2])
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
