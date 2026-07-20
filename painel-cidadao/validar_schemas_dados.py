# -*- coding: utf-8 -*-
"""Validação formal dos dados publicados pelo painel.

Executar após os coletores e antes de sincronizar/empacotar dados:
    python painel-cidadao/validar_schemas_dados.py
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

ROOT = Path(__file__).resolve().parent
CHUNKS = ROOT / "data" / "chunks"
EMENDAS = ROOT / "emendas" / "data"


class ModeloAberto(BaseModel):
    model_config = ConfigDict(extra="allow", str_strip_whitespace=True)


class ManifestChunk(ModeloAberto):
    arquivo: str = Field(pattern=r"^data/chunks/[^/]+\.json$")
    bytes: int = Field(ge=2)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class Manifest(ModeloAberto):
    gerado_em: str = Field(min_length=16)
    chunks: dict[str, ManifestChunk] = Field(min_length=1)


class SourceDomain(ModeloAberto):
    label: str = Field(min_length=1)
    status: Literal["ok", "partial", "manual", "preserved", "failed", "unknown"]
    max_age_days: int = Field(ge=0)


class SourceStatus(ModeloAberto):
    schema_version: int = Field(ge=1)
    gerado_em: str = Field(min_length=16)
    domains: dict[str, SourceDomain] = Field(min_length=1)


class MonitorSource(ModeloAberto):
    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    status: Literal["ok", "partial", "manual", "preserved", "failed", "unknown"]
    reason: str = Field(min_length=1)


class Monitoring(ModeloAberto):
    schema_version: int = Field(ge=1)
    generated_at: str = Field(min_length=16)
    sources: list[MonitorSource] = Field(min_length=1)


class MunicipalChunkRecord(ModeloAberto):
    ano: str = Field(pattern=r"^20\d{2}$")
    numero: str = Field(min_length=1)
    autor: str = Field(min_length=1)
    beneficiario: str = Field(min_length=1)
    objeto: str = Field(min_length=1)
    valor_brl: float = Field(ge=0)


class MunicipalPublicationRecord(ModeloAberto):
    id: str = Field(min_length=1)
    tipo: Literal["Municipal"]
    emenda: str = Field(pattern=r"^\d{3}/20\d{2}$")
    anoEmenda: str = Field(pattern=r"^20\d{2}$")
    valorIndicado: float = Field(ge=0)
    origemMunicipal: Literal["historico_betha", "sapl_camara"]
    classificacaoComprovacao: Literal["Inferido"]


class MunicipalPublication(ModeloAberto):
    metadata: dict[str, Any]
    emendas: list[MunicipalPublicationRecord] = Field(min_length=1)


class FederalPublicationRecord(ModeloAberto):
    tipo: Literal["Federal"]
    emenda: str = Field(min_length=1)
    fonteUrl: str = Field(min_length=8)
    granularidade: str = Field(min_length=1)
    identificador_repasse_confirmado: bool


class FederalPublication(ModeloAberto):
    metadata: dict[str, Any]
    emendas: list[FederalPublicationRecord] = Field(min_length=1)


class EstadualPublicationRecord(ModeloAberto):
    tipo: Literal["Estadual"]
    classificacaoComprovacao: Literal["confirmado", "parcial", "sem_comprovacao"]
    valorDeclarado: float | None = Field(default=None, ge=0)


class EstadualPublication(ModeloAberto):
    metadata: dict[str, Any]
    emendas: list[EstadualPublicationRecord] = Field(min_length=1)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def read_js_payload(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    start = text.find("{")
    if start < 0:
        raise ValueError("objeto JSON ausente")
    payload, _ = json.JSONDecoder().raw_decode(text[start:])
    return payload


def validate_manifest() -> int:
    manifest_path = ROOT / "data" / "manifest.json"
    manifest = Manifest.model_validate(read_json(manifest_path))
    for name, item in manifest.chunks.items():
        path = ROOT / item.arquivo
        if not path.exists():
            raise ValueError(f"manifest: chunk ausente: {name} ({item.arquivo})")
        content = path.read_bytes()
        if len(content) != item.bytes:
            raise ValueError(f"manifest: tamanho divergente em {name}")
        if hashlib.sha256(content).hexdigest() != item.sha256:
            raise ValueError(f"manifest: hash divergente em {name}")
        read_json(path)
    return len(manifest.chunks)


def validate_emendas() -> tuple[int, int, int]:
    municipal = MunicipalPublication.model_validate(read_js_payload(EMENDAS / "emendas_municipais_unificadas.js"))
    federal = FederalPublication.model_validate(read_js_payload(EMENDAS / "emendas_federais.js"))
    estadual = EstadualPublication.model_validate(read_js_payload(EMENDAS / "emendas_estaduais_normalizadas.js"))

    keys = [record.emenda for record in municipal.emendas]
    if len(keys) != len(set(keys)):
        raise ValueError("municipais: número/ano de emenda duplicado na publicação")
    for record in federal.emendas:
        if record.granularidade == "emenda_favorecido_agregado" and record.identificador_repasse_confirmado:
            raise ValueError(f"federal {record.emenda}: agregado marcado como repasse individual")
    return len(municipal.emendas), len(estadual.emendas), len(federal.emendas)


# Guarda contra regressao estrutural: chunk que HISTORICAMENTE carrega muitos
# registros nao pode virar lista vazia silenciosamente (foi exatamente o que
# aconteceu em 20/07/2026 — diarias.json publicado vazio por uma coleta com
# o Chromium do Playwright ausente, sem que nenhuma validacao formal pegasse
# antes do teste de UI). getter(payload) extrai a lista a checar; PISO e o
# minimo historico plausivel — abaixo disso, so aceita se o proprio chunk
# se declarar "preservado"/"parcial" (coleta sabe que falhou e nao mentiu).

def _checar_regressao(nome_chunk: str, descricao: str, piso: int, getter):
    payload = read_json(CHUNKS / f"{nome_chunk}.json")
    valor = getter(payload)
    if not isinstance(valor, list):
        raise ValueError(f"{nome_chunk}: {descricao} nao e uma lista (tipo {type(valor).__name__})")
    if len(valor) < piso:
        texto_bruto = json.dumps(payload, ensure_ascii=False).lower()
        declarado_parcial = any(p in texto_bruto for p in ("preservad", "parcial", "falha"))
        if not declarado_parcial:
            raise ValueError(
                f"{nome_chunk}: {descricao} tem {len(valor)} registro(s) (esperado >= {piso}) "
                f"e o chunk nao se declara preservado/parcial — provavel coleta vazia publicada por engano."
            )


def _checar_regressao_numero(nome_chunk: str, descricao: str, piso: int, getter):
    """Mesma logica de _checar_regressao, mas para um campo numerico (contagem)
    em vez de uma lista — caso dos 3 chunks de cruzamento externo, onde o
    coletor guarda a metrica de cobertura (verificados/eleitos/compras) e nao
    so a lista de achados (que e naturalmente pequena/varia sem indicar
    problema). Incidente real que motivou: licitacoes_resultados.json caiu de
    302 para 0 compras numa coleta que voltou vazia por falha transitoria da
    API do PNCP, sem excecao — publicado por engano em 20/07/2026."""
    payload = read_json(CHUNKS / f"{nome_chunk}.json")
    valor = getter(payload)
    if not isinstance(valor, (int, float)):
        raise ValueError(f"{nome_chunk}: {descricao} nao e numerico (tipo {type(valor).__name__})")
    if valor < piso:
        texto_bruto = json.dumps(payload, ensure_ascii=False).lower()
        declarado_parcial = any(p in texto_bruto for p in ("preservad", "parcial", "falha"))
        if not declarado_parcial:
            raise ValueError(
                f"{nome_chunk}: {descricao} e {valor} (esperado >= {piso}) "
                f"e o chunk nao se declara preservado/parcial — provavel coleta vazia publicada por engano."
            )


def validate_regressoes() -> None:
    _checar_regressao("diarias", "diarias.prefeitura", 500, lambda p: (p or {}).get("prefeitura"))
    _checar_regressao("diarias", "diarias.camara", 30, lambda p: (p or {}).get("camara"))
    _checar_regressao("pessoal", "pessoal.prefeitura.servidores", 500,
                       lambda p: ((p or {}).get("prefeitura") or {}).get("servidores"))
    _checar_regressao("pessoal", "pessoal.camara.servidores", 20,
                       lambda p: ((p or {}).get("camara") or {}).get("servidores"))
    _checar_regressao("prefeitura", "prefeitura.contratos", 200, lambda p: (p or {}).get("contratos"))
    _checar_regressao("camara_betha", "camara_betha.top_fornecedores_atual", 5,
                       lambda p: (p or {}).get("top_fornecedores_atual"))
    _checar_regressao_numero("sancoes", "sancoes.verificados", 500, lambda p: (p or {}).get("verificados"))
    _checar_regressao_numero("tse_doacoes", "tse_doacoes.eleitos", 10, lambda p: (p or {}).get("eleitos"))
    _checar_regressao_numero("licitacoes_resultados", "licitacoes_resultados.compras", 50,
                              lambda p: (p or {}).get("compras"))


def main() -> int:
    try:
        chunks = validate_manifest()
        status = SourceStatus.model_validate(read_json(CHUNKS / "status_fontes.json"))
        monitor = Monitoring.model_validate(read_json(CHUNKS / "monitoramento_coletas.json"))
        municipal, estadual, federal = validate_emendas()
        validate_regressoes()
    except (OSError, ValueError, ValidationError, json.JSONDecodeError) as exc:
        print(f"ERRO DE SCHEMA: {exc}", file=sys.stderr)
        return 1
    print(f"OK schemas: {chunks} chunks; {len(status.domains)} fontes; {len(monitor.sources)} monitoradas; {municipal} municipais; {estadual} estaduais; {federal} federais")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
