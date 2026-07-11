"""Conteúdos complementares do WhatsApp do Fiscaliza Varginha.

O módulo concentra três responsabilidades que não existiam no emissor original:

* transformar matérias recentes do SAPL no mesmo formato dos boletins da Câmara;
* acompanhar mudanças em obras e alertas de transparência por meio de snapshots;
* produzir um resumo semanal de Prefeitura, Câmara, diárias, obras e Legislativo.

Nenhuma função deste arquivo envia mensagens. O envio continua centralizado em
``alertar_whatsapp.py`` para manter uma única trilha de deduplicação e auditoria.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any


STATE_VERSION = 1


def carregar_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        with path.open("r", encoding="utf-8") as arquivo:
            return json.load(arquivo)
    except Exception as exc:
        print(f"⚠️ Não foi possível ler {path.name}: {exc}")
        return default


def carregar_estado(path: Path) -> dict:
    estado = carregar_json(path, {})
    if not isinstance(estado, dict) or estado.get("version") != STATE_VERSION:
        return {
            "version": STATE_VERSION,
            "initialized": False,
            "obras": {},
            "transparencia": {},
        }
    estado.setdefault("initialized", False)
    estado.setdefault("obras", {})
    estado.setdefault("transparencia", {})
    return estado


def salvar_estado(path: Path, estado: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as arquivo:
        json.dump(estado, arquivo, indent=2, ensure_ascii=False, sort_keys=True)


def _texto(valor: Any) -> str:
    return str(valor or "").strip()


def _numero(valor: Any) -> float:
    try:
        return float(valor or 0)
    except (TypeError, ValueError):
        return 0.0


def _data(valor: Any) -> date | None:
    bruto = _texto(valor).split("T")[0].split(" ")[0]
    if not bruto:
        return None
    try:
        return datetime.strptime(bruto, "%Y-%m-%d").date()
    except ValueError:
        return None


def _fmt_data(valor: Any) -> str:
    dt = _data(valor)
    return dt.strftime("%d/%m/%Y") if dt else (_texto(valor) or "Não informada")


def _fmt_valor(valor: Any) -> str:
    return f"R$ {_numero(valor):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _hash(payload: Any, tamanho: int = 14) -> str:
    bruto = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(bruto.encode("utf-8")).hexdigest()[:tamanho]


def _slug(valor: Any) -> str:
    return re.sub(r"[^A-Z0-9]+", "-", _texto(valor).upper()).strip("-")


def _no_periodo(valor: Any, inicio: date, fim: date) -> bool:
    dt = _data(valor)
    return bool(dt and inicio <= dt <= fim)


def _inicio_resumo(hoje: date, data_minima: str, primeiro_resumo: bool = False) -> date:
    inicio = hoje - timedelta(days=6)
    piso = _data(data_minima)
    if piso:
        if primeiro_resumo:
            inicio = piso
        elif piso > inicio:
            inicio = piso
    return inicio


def _sigla_materia(materia: dict) -> str:
    sigla = _slug(materia.get("sigla"))
    if sigla:
        return sigla
    tipo = _texto(materia.get("tipo")).lower()
    mapa = {
        "projeto de lei ordinária do executivo": "PLOE",
        "projeto de lei ordinária do legislativo": "PLOL",
        "projeto de lei complementar": "PLC",
        "projeto de resolução": "PRE",
        "projeto de decreto legislativo": "PDL",
        "requerimento": "REQ",
        "indicação": "IND",
        "moção": "MOC",
        "emenda": "EMEN",
        "mensagem de veto": "VETO",
        "parecer": "PAR",
    }
    return mapa.get(tipo, "MAT")


def _materia_relevante(materia: dict) -> tuple[str, list[str]]:
    """Classifica apenas para decidir alerta individual; tudo segue no resumo."""
    tipo = _texto(materia.get("tipo")).lower()
    ementa = _texto(materia.get("ementa"))
    texto = f"{tipo} {ementa}".lower()
    financeiro = any(
        termo in texto
        for termo in (
            "orçamento", "credito", "crédito", "tribut", "imposto", "taxa",
            "gratifica", "cargo", "salário", "subsid", "remunera", "fundo municipal",
            "despesa", "receita", "emenda", "doação", "alienação", "contrata",
        )
    )
    estrutural = any(
        termo in tipo
        for termo in (
            "projeto de lei", "mensagem de veto", "emenda", "parecer",
            "projeto de resolução",
        )
    )
    rotina = bool(materia.get("impacto_zero")) or any(
        termo in tipo for termo in ("moção", "indicação", "pronunciamento")
    )

    motivos: list[str] = []
    if financeiro:
        motivos.append("A matéria possui possível impacto financeiro ou orçamentário e merece acompanhamento cidadão.")
    if estrutural and not rotina:
        motivos.append("A proposta pode alterar regras ou políticas públicas do município.")
    if financeiro:
        return "alto", motivos
    if estrutural and not rotina:
        return "médio", motivos
    return "baixo", motivos


def materias_para_publicacoes(camara_anos: dict, ano: int, data_minima: str) -> list[dict]:
    bloco = camara_anos.get(str(ano)) or {}
    materias = bloco.get("materias") or []
    piso = _data(data_minima)
    publicacoes = []
    for materia in materias:
        data_materia = _data(materia.get("data"))
        if piso and (not data_materia or data_materia < piso):
            continue
        relevancia, motivos = _materia_relevante(materia)
        numero = _texto(materia.get("numero"))
        sigla = _sigla_materia(materia)
        id_sapl = _texto(materia.get("id"))
        ementa = re.sub(r"\s+", " ", _texto(materia.get("ementa"))).strip()
        titulo = f"{_texto(materia.get('tipo'))} nº {numero}/{ano}".strip()
        publicacoes.append(
            {
                "id": f"CAMARA-{ano}-{sigla}-{numero}",
                "fonte": "camara",
                "tipo_label": _texto(materia.get("tipo")) or "Matéria legislativa",
                "titulo": titulo,
                "categoria": "Legislativo",
                "data": _texto(materia.get("data")),
                "autor": _texto(materia.get("autor")) or "Não identificado",
                "situacao": _texto(materia.get("desfecho")) or "Em acompanhamento",
                "interesse_publico": relevancia,
                "tema": _texto(materia.get("tema_label") or materia.get("tema")) or "Geral",
                "resumo": ementa,
                "o_que_propoe": ementa,
                "por_que_acompanhar": motivos,
                "pontos_atencao": [],
                "links": {
                    "consulta": f"https://sapl.varginha.mg.leg.br/materia/{id_sapl}" if id_sapl else "",
                    "inteiro_teor": _texto(materia.get("pdf")),
                },
            }
        )
    return publicacoes


def _snapshot_obras(obras: list[dict]) -> dict[str, dict]:
    campos = (
        "objeto", "situacao", "data_prevista_conclusao", "data_efetiva_conclusao",
        "data_ultima_medicao", "fornecedor", "valor_previsto", "valor_atualizado",
        "valor_efetivo", "percentual_executado", "contrato_numero", "endereco",
        "fonte_url",
    )
    saida: dict[str, dict] = {}
    for obra in obras:
        chave = _texto(obra.get("id_obra") or obra.get("numero"))
        if not chave:
            chave = _hash([obra.get("objeto"), obra.get("data_inicio")])
        saida[chave] = {campo: obra.get(campo) for campo in campos}
    return saida


def _snapshot_transparencia(itens: list[dict]) -> dict[str, dict]:
    saida: dict[str, dict] = {}
    for item in itens:
        if _texto(item.get("severity")).lower() not in {"warning", "error"}:
            continue
        chave = _texto(item.get("id")) or _hash(item)
        saida[chave] = {
            "severity": _texto(item.get("severity")),
            "title": _texto(item.get("title")),
            "detail": _texto(item.get("detail")),
            "action": _texto(item.get("action")),
            "source": _texto(item.get("source")),
        }
    return saida


def _mudancas_obra(antes: dict, agora: dict) -> list[str]:
    mudancas: list[str] = []
    textos = {
        "situacao": "Situação",
        "data_prevista_conclusao": "Prazo previsto",
        "data_efetiva_conclusao": "Conclusão informada",
        "data_ultima_medicao": "Última medição",
        "percentual_executado": "Execução informada",
        "contrato_numero": "Contrato",
        "fornecedor": "Empresa responsável",
    }
    valores = {
        "valor_previsto": "Valor previsto",
        "valor_atualizado": "Valor atualizado",
        "valor_efetivo": "Valor efetivo informado",
    }
    for campo, rotulo in textos.items():
        if _texto(antes.get(campo)) == _texto(agora.get(campo)):
            continue
        anterior = _texto(antes.get(campo)) or "não informado"
        atual = _texto(agora.get(campo)) or "não informado"
        if campo.startswith("data_"):
            anterior, atual = _fmt_data(anterior), _fmt_data(atual)
        elif campo == "percentual_executado":
            anterior = f"{_numero(anterior):.2f}%"
            atual = f"{_numero(atual):.2f}%"
        mudancas.append(f"{rotulo}: {anterior} → {atual}")
    for campo, rotulo in valores.items():
        if abs(_numero(antes.get(campo)) - _numero(agora.get(campo))) > 0.009:
            mudancas.append(
                f"{rotulo}: {_fmt_valor(antes.get(campo))} → {_fmt_valor(agora.get(campo))}"
            )
    return mudancas


def _mensagem_obra(chave: str, atual: dict, mudancas: list[str], nova: bool) -> tuple[str, str]:
    titulo = _texto(atual.get("objeto")) or f"Obra pública {chave}"
    link = _texto(atual.get("fonte_url"))
    prefixo = f"[{link}]\n\n" if link else ""
    cabecalho = "NOVA OBRA LOCALIZADA" if nova else "ATUALIZAÇÃO DE OBRA PÚBLICA"
    linhas = [
        prefixo + "🚧 BOLETIM DE FISCALIZAÇÃO | OBRAS DE VARGINHA",
        "════════════════════════════════════",
        titulo.upper(),
        "",
        f"⏳ *Situação informada:* {_texto(atual.get('situacao')) or 'Não informada'}",
        f"🏢 *Empresa:* {_texto(atual.get('fornecedor')) or 'Não informada'}",
        f"📄 *Contrato:* {_texto(atual.get('contrato_numero')) or 'Não localizado na base'}",
        f"📍 *Local:* {_texto(atual.get('endereco')) or 'Não informado'}",
        "",
        f"💰 *Valor previsto:* {_fmt_valor(atual.get('valor_previsto'))}",
        f"💵 *Valor efetivo informado:* {_fmt_valor(atual.get('valor_efetivo'))}",
        f"📈 *Execução informada:* {_numero(atual.get('percentual_executado')):.2f}%",
        f"📅 *Prazo previsto:* {_fmt_data(atual.get('data_prevista_conclusao'))}",
        f"📐 *Última medição:* {_fmt_data(atual.get('data_ultima_medicao'))}",
        "",
        f"*{cabecalho}*",
    ]
    linhas.extend(f"- {mudanca}" for mudanca in mudancas)
    linhas.extend(
        [
            "",
            "🛡️ *CONTROLE CIDADÃO*",
            "Os dados indicam um ponto para conferência e não comprovam irregularidade.",
            "Painel: https://www.fiscalizavarginha.com.br",
            "",
            "#fiscalizacao #varginha #obraspublicas #dinheiropublico",
        ]
    )
    identificador = f"OBRA-{_slug(chave)}-{_hash(atual)}"
    return identificador, "\n".join(linhas).strip()


def gerar_alertas_obras(estado_anterior: dict, atual: dict[str, dict]) -> list[tuple[str, str]]:
    if not estado_anterior.get("initialized"):
        return []
    anteriores = estado_anterior.get("obras") or {}
    mensagens: list[tuple[str, str]] = []
    for chave, obra in atual.items():
        anterior = anteriores.get(chave)
        if anterior is None:
            mensagens.append(_mensagem_obra(chave, obra, ["Novo registro localizado na fonte consultada."], True))
            continue
        mudancas = _mudancas_obra(anterior, obra)
        if mudancas:
            mensagens.append(_mensagem_obra(chave, obra, mudancas, False))
    return mensagens


def gerar_alertas_transparencia(estado_anterior: dict, atual: dict[str, dict]) -> list[tuple[str, str]]:
    if not estado_anterior.get("initialized"):
        return []
    anteriores = estado_anterior.get("transparencia") or {}
    mensagens: list[tuple[str, str]] = []
    for chave, item in atual.items():
        if anteriores.get(chave) == item:
            continue
        titulo = _texto(item.get("title")) or "Ponto de transparência"
        fonte = _texto(item.get("source")) or "Base pública consultada"
        linhas = [
            "📊 BOLETIM DE FISCALIZAÇÃO | TRANSPARÊNCIA",
            "════════════════════════════════════",
            titulo.upper(),
            "",
            "🔎 *O que foi identificado*",
            _texto(item.get("detail")) or "A informação precisa de conferência.",
            "",
            "➡️ *Próximo passo sugerido*",
            _texto(item.get("action")) or "Conferir a documentação na fonte oficial.",
            "",
            f"🔗 *Fonte analisada:* {fonte}",
            "",
            "A ausência automática significa que o documento não foi localizado nas bases integradas; não prova que ele não exista.",
            "",
            "#fiscalizacao #varginha #transparencia #controlecidadao",
        ]
        mensagens.append((f"TRANSPARENCIA-{_slug(chave)}-{_hash(item)}", "\n".join(linhas)))
    return mensagens


def _registros_periodo(registros: list[dict], campos_data: tuple[str, ...], inicio: date, fim: date) -> list[dict]:
    saida = []
    for registro in registros:
        for campo in campos_data:
            if _no_periodo(registro.get(campo), inicio, fim):
                saida.append(registro)
                break
    return saida


def _soma(registros: list[dict], *campos: str) -> float:
    total = 0.0
    for registro in registros:
        for campo in campos:
            if registro.get(campo) not in (None, ""):
                total += _numero(registro.get(campo))
                break
    return total


def gerar_resumo_semanal(
    chunks: Path,
    config: dict,
    enviados: set[str],
    hoje: date,
    forcar: bool = False,
) -> list[tuple[str, str]]:
    if not config.get("enviar_resumo_semanal", True):
        return []
    dia_programado = int(config.get("dia_resumo_semanal", 5))
    if not forcar and hoje.weekday() != dia_programado:
        return []

    primeiro_resumo = not any(str(item).startswith("RESUMO-SEMANAL-") for item in enviados)
    inicio = _inicio_resumo(
        hoje,
        config.get("data_minima_envio", ""),
        primeiro_resumo=primeiro_resumo,
    )
    resumo_id = f"RESUMO-SEMANAL-{hoje.isocalendar().year}-{hoje.isocalendar().week:02d}"
    if resumo_id in enviados:
        return []

    prefeitura = carregar_json(chunks / "prefeitura.json", {})
    camara = carregar_json(chunks / "camara_betha.json", {})
    diarias = carregar_json(chunks / "diarias.json", {})
    camara_anos = carregar_json(chunks / "camara_anos.json", {})
    auditoria = carregar_json(chunks / "auditoria_dados.json", {})

    contratos_pref = _registros_periodo(prefeitura.get("contratos") or [], ("data_assinatura", "data"), inicio, hoje)
    licit_pref = _registros_periodo(
        (prefeitura.get("licit_andamento") or []) + (prefeitura.get("licit_finalizadas") or []),
        ("data", "data_publicacao"), inicio, hoje,
    )
    compras_pref = _registros_periodo(prefeitura.get("compras_diretas") or [], ("data",), inicio, hoje)
    contratos_cam = _registros_periodo(camara.get("contratos") or [], ("data_assinatura", "data"), inicio, hoje)
    licit_cam = _registros_periodo(camara.get("licitacoes") or [], ("data",), inicio, hoje)
    if config.get("enviar_diarias", True):
        diarias_pref = _registros_periodo(diarias.get("prefeitura") or [], ("data_inicial",), inicio, hoje)
        diarias_cam = _registros_periodo(diarias.get("camara") or [], ("data_inicial",), inicio, hoje)
    else:
        diarias_pref, diarias_cam = [], []

    bloco_ano = camara_anos.get(str(hoje.year)) or {}
    materias = _registros_periodo(bloco_ano.get("materias") or [], ("data",), inicio, hoje)
    sessoes = _registros_periodo(bloco_ano.get("sessoes") or [], ("data",), inicio, hoje)
    vereadores = bloco_ano.get("vereadores") or []
    obras = prefeitura.get("obras_publicas") or []
    obras_medidas = _registros_periodo(obras, ("data_ultima_medicao",), inicio, hoje)
    obras_andamento = [o for o in obras if "andamento" in _texto(o.get("situacao")).lower()]
    obras_prazo = [
        o for o in obras_andamento
        if _data(o.get("data_prevista_conclusao")) and _data(o.get("data_prevista_conclusao")) < hoje
    ]
    pendencias = [
        item for item in auditoria.get("items") or []
        if _texto(item.get("severity")).lower() in {"warning", "error"}
    ]

    linhas = [
        "📅 RESUMO SEMANAL | FISCALIZA VARGINHA",
        "════════════════════════════════════",
        f"⏳ *Período:* {inicio.strftime('%d/%m/%Y')} a {hoje.strftime('%d/%m/%Y')}",
        "",
        "🏢 *DINHEIRO PÚBLICO — PREFEITURA*",
        f"- Contratos publicados: {len(contratos_pref)} | valores informados: {_fmt_valor(_soma(contratos_pref, 'valor'))}",
        f"- Licitações publicadas: {len(licit_pref)} | valores estimados: {_fmt_valor(_soma(licit_pref, 'valor'))}",
        f"- Compras diretas publicadas: {len(compras_pref)} | valores informados: {_fmt_valor(_soma(compras_pref, 'valor'))}",
        f"- Diárias: {len(diarias_pref)} | total informado: {_fmt_valor(_soma(diarias_pref, 'valor_total'))}",
        "",
        "🏛️ *DINHEIRO PÚBLICO — CÂMARA*",
        f"- Contratos publicados: {len(contratos_cam)} | valores informados: {_fmt_valor(_soma(contratos_cam, 'valor'))}",
        f"- Licitações publicadas: {len(licit_cam)} | valores estimados: {_fmt_valor(_soma(licit_cam, 'valor'))}",
        f"- Diárias: {len(diarias_cam)} | total informado: {_fmt_valor(_soma(diarias_cam, 'valor_total'))}",
    ]

    destaques_diarias = sorted(
        [("Prefeitura", item) for item in diarias_pref] + [("Câmara", item) for item in diarias_cam],
        key=lambda par: _numero(par[1].get("valor_total")),
        reverse=True,
    )
    if destaques_diarias:
        linhas.extend(["", "✈️ *DIÁRIAS PUBLICADAS NO PERÍODO*"])
        for poder, item in destaques_diarias[:5]:
            destino = _texto(item.get("destino")) or "destino não informado"
            linhas.append(
                f"- {poder}: {_texto(item.get('funcionario')) or 'beneficiário não informado'} — "
                f"{destino} — {_fmt_valor(item.get('valor_total'))}"
            )
        if len(destaques_diarias) > 5:
            linhas.append(f"- Outros {len(destaques_diarias) - 5} registros estão disponíveis no painel.")

    linhas.extend([
        "",
        "🚧 *OBRAS PÚBLICAS*",
        f"- Obras cadastradas como em andamento: {len(obras_andamento)}",
        f"- Com prazo informado anterior à data atual: {len(obras_prazo)}",
        f"- Com medição registrada no período: {len(obras_medidas)}",
        "",
        "💼 *TRABALHO DA CÂMARA*",
        f"- Matérias apresentadas/publicadas no período: {len(materias)}",
    ])

    relevantes = []
    for materia in sorted(materias, key=lambda item: _texto(item.get("data")), reverse=True):
        relevancia, _ = _materia_relevante(materia)
        if relevancia in {"alto", "médio"}:
            relevantes.append(materia)
    for materia in relevantes[:5]:
        ementa = re.sub(r"\s+", " ", _texto(materia.get("ementa")))
        if len(ementa) > 150:
            ementa = ementa[:147].rstrip() + "..."
        linhas.append(f"- {_texto(materia.get('tipo'))} — {_texto(materia.get('autor'))}: {ementa}")

    if vereadores:
        percentuais = [_numero(v.get("presenca_pct")) for v in vereadores if v.get("presenca_pct") not in (None, "")]
        if percentuais:
            linhas.append(
                f"- Presença acumulada disponível: média de {sum(percentuais) / len(percentuais):.1f}% "
                f"({len(percentuais)} vereadores com dado)"
            )
        else:
            linhas.append("- Presença nominal: dado não localizado na atualização atual.")

    if sessoes:
        linhas.extend(["", "🗳️ *SESSÕES, PRESENÇAS E VOTOS*"])
        materias_por_id = {_texto(m.get("id")): m for m in bloco_ano.get("materias") or []}
        for sessao in sorted(sessoes, key=lambda item: _texto(item.get("data"))):
            nomes = ", ".join(sessao.get("presentes") or []) or "nomes não informados"
            linhas.append(
                f"- {_fmt_data(sessao.get('data'))} — {_texto(sessao.get('tipo'))} nº "
                f"{_texto(sessao.get('numero'))}: {int(_numero(sessao.get('presentes_qtd')))} presenças registradas."
            )
            linhas.append(f"  Presentes: {nomes}")
            for votacao in sessao.get("votacoes") or []:
                materia = materias_por_id.get(_texto(votacao.get("materia_id"))) or {}
                identificacao = _texto(materia.get("tipo"))
                if materia.get("numero"):
                    identificacao += f" nº {_texto(materia.get('numero'))}/{hoje.year}"
                if not identificacao:
                    identificacao = re.sub(r"^.*? - ", "", _texto(votacao.get("descricao")), count=1)
                linhas.append(
                    f"  Votação — {identificacao}: {_texto(votacao.get('resultado'))} "
                    f"({int(_numero(votacao.get('sim')))} sim, {int(_numero(votacao.get('nao')))} não, "
                    f"{int(_numero(votacao.get('abstencoes')))} abstenções)."
                )
                grupos: dict[str, list[str]] = {}
                for voto in votacao.get("votos") or []:
                    grupos.setdefault(_texto(voto.get("voto")) or "Não informado", []).append(
                        _texto(voto.get("parlamentar")) or "Não identificado"
                    )
                for escolha, nomes_votos in grupos.items():
                    linhas.append(f"    {escolha}: {', '.join(sorted(nomes_votos))}")
            if sessao.get("fonte"):
                linhas.append(f"  Fonte da sessão: {_texto(sessao.get('fonte'))}")
    else:
        linhas.append("- Votos nominais por sessão: ainda não disponíveis de forma estruturada na atualização atual.")

    linhas.extend(
        [
            "",
            "📊 *TRANSPARÊNCIA DOS DADOS*",
            f"- Pendências automáticas ativas: {len(pendencias)}",
        ]
    )
    for item in pendencias[:3]:
        linhas.append(f"- {_texto(item.get('title'))}")

    linhas.extend(
        [
            "",
            "Os valores reproduzem os campos das fontes oficiais e podem representar fases diferentes do gasto. Consulte os documentos antes de concluir.",
            "",
            "🔗 *FONTES E DETALHES*",
            "https://www.fiscalizavarginha.com.br",
            "https://sapl.varginha.mg.leg.br",
            "",
            "#fiscalizacao #varginha #dinheiropublico #camaramunicipal",
        ]
    )
    return [(resumo_id, "\n".join(linhas).strip())]


def preparar_conteudos_complementares(
    root: Path,
    config: dict,
    enviados: set[str],
    hoje: date,
    forcar_resumo: bool = False,
) -> tuple[list[tuple[str, str]], dict]:
    chunks = root / "data" / "chunks"
    state_path = root.parent / "private" / "state" / "whatsapp_monitor_state.json"
    estado = carregar_estado(state_path)

    prefeitura = carregar_json(chunks / "prefeitura.json", {})
    auditoria = carregar_json(chunks / "auditoria_dados.json", {})
    obras_atual = _snapshot_obras(prefeitura.get("obras_publicas") or [])
    transparencia_atual = _snapshot_transparencia(auditoria.get("items") or [])

    mensagens: list[tuple[str, str]] = []
    if config.get("enviar_obras", True):
        mensagens.extend(gerar_alertas_obras(estado, obras_atual))
    if config.get("enviar_alertas_transparencia", True):
        mensagens.extend(gerar_alertas_transparencia(estado, transparencia_atual))
    mensagens.extend(gerar_resumo_semanal(chunks, config, enviados, hoje, forcar_resumo))

    proximo_estado = {
        "version": STATE_VERSION,
        "initialized": True,
        "updated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "obras": obras_atual,
        "transparencia": transparencia_atual,
    }
    return mensagens, proximo_estado
