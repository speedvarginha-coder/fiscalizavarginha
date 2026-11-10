"""Telemetria pública mínima, publicada independentemente do release de conteúdo."""
import argparse
import importlib.util
import json
import ssl
from datetime import datetime, timezone
from pathlib import Path
import ftplib

ROOT = Path(__file__).resolve().parents[1]


def public_status(state, external, now=None, financial=None):
    # Allowlist: não transportar logs, caminhos, destinatários ou credenciais.
    run = {key: state.get(key) for key in ("coleta", "deploy", "whatsapp", "fase", "finished_at")}
    verified = {key: external.get(key) for key in ("checked_at", "manifest_sha256", "collection_age_hours")}
    verified["status"] = "SUCESSO" if external.get("status") in ("ok", "defasado") else "FALHA"
    financial = financial or {}
    allowed_status = {"ok", "preservado", "pulado"}
    raw_sources = financial.get("fontes") if isinstance(financial.get("fontes"), dict) else {}
    sources = {key: value for key, value in raw_sources.items()
               if key in ("diarias", "federal", "tesouro", "estadual", "reconciliacao", "cruzamento_municipal") and value in allowed_status}
    timestamp = financial.get("executado_em")
    try:
        timestamp = datetime.fromisoformat(str(timestamp).replace("Z", "+00:00")).isoformat()
    except (ValueError, TypeError):
        timestamp = None
    cycle = financial.get("status") if financial.get("status") in ("sucesso", "parcial", "falha") else "desconhecido"
    attempt = {"concluido_em": timestamp, "ciclo": cycle, "fontes": sources} if timestamp else None
    return {"schema_version": 1, "generated_at": now or datetime.now(timezone.utc).isoformat(),
            "last_completed_run": run if state.get("finished_at") else None,
            "last_verified_deployment": verified if external.get("checked_at") else None,
            "financial_attempt": attempt}


def read(name):
    try:
        return json.loads((ROOT / f"private/state/{name}.json").read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return {}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    target = ROOT / "private/state/public-monitor.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(public_status(read("pipeline_last_result"), read("external_site"), financial=read("financial-update")), ensure_ascii=False), encoding="utf-8")
    temporary.replace(target)
    public = ROOT / "painel-cidadao/operacao.json"
    staged_public = public.with_suffix(".json.tmp")
    staged_public.write_bytes(target.read_bytes())
    staged_public.replace(public)
    if not args.publish:
        print("Telemetria mínima gerada; sem publicação.")
        return
    spec = importlib.util.spec_from_file_location("deploy", ROOT / "private/deploy_completo.py")
    deploy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(deploy)
    config = deploy.load_config()
    if not config["ftps"]:
        raise RuntimeError("Telemetria exige FTPS")
    with deploy.deployment_lock():
        with ftplib.FTP_TLS(context=ssl.create_default_context()) as ftp:
            ftp.connect(config["host"], config["port"], timeout=30)
            ftp.login(config["user"], config["password"])
            ftp.prot_p()
            ftp.set_pasv(True)
            deploy.upload(ftp, str(target), config["remote_base"] + "/operacao.json")
    print("Telemetria operacional publicada.")


if __name__ == "__main__":
    main()
