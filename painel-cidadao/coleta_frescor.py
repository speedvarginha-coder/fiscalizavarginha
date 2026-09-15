"""Datas de coleta por conjunto, sem rejuvenescer registros preservados."""
from datetime import datetime, timezone


def registrar_frescor(payload, anterior, estados, agora=None):
    agora = agora or datetime.now(timezone.utc).isoformat(timespec="seconds")
    anteriores = (anterior or {}).get("coleta_frescor", {}).get("datasets", {})
    datasets = {}
    for nome, estado in estados.items():
        completo = estado in ("ok", "coleta_atual")
        datasets[nome] = {
            "status": estado or "unknown",
            "checked_at": agora,
            "last_complete_at": agora if completo else anteriores.get(nome, {}).get("last_complete_at"),
        }
    payload["coleta_frescor"] = {"checked_at": agora, "datasets": datasets}
    return payload


def registrar_frescor_federal(payload, anterior, agora=None):
    estados = {
        nome: "preservado" if payload.get("_preservado") else payload.get("status_fontes", {}).get(nome, {}).get("status", "unknown")
        for nome in ("emendas", "convenios", "transferencias_especiais", "ceis")
    }
    return registrar_frescor(payload, anterior, estados, agora)
