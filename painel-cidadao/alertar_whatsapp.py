"""Envio de alertas e resumos do Fiscaliza Varginha para o WhatsApp.

O emissor preserva os boletins estruturados da Câmara e do Diário Oficial e acrescenta
monitoramento de qualquer valor financeiro, obras públicas, diárias, atividade legislativa,
presença disponível, resumos semanais e alertas de transparência.

Previne duplicidade usando um arquivo de controle de histórico em `private/state/whatsapp_sent.json`.
"""
from __future__ import annotations

import json
import os
import re
import sys
import unicodedata
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

from whatsapp_conteudo import (
    materias_para_publicacoes,
    preparar_conteudos_complementares,
    salvar_estado,
)

# Console do Windows UTF-8
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT.parent / "private" / "whatsapp_config.json"
SENT_PATH = ROOT.parent / "private" / "state" / "whatsapp_sent.json"

CAMARA_JSON = ROOT / "data" / "chunks" / "publicacoes_estruturadas.json"
DIARIO_JSON = ROOT / "data" / "chunks" / "publicacoes_diario.json"
EMENDAS_JSON = ROOT / "data" / "chunks" / "emendas.json"
PREFEITURA_JSON = ROOT / "data" / "chunks" / "prefeitura.json"
CAMARA_ANOS_JSON = ROOT / "data" / "chunks" / "camara_anos.json"
CAMARA_BETHA_JSON = ROOT / "data" / "chunks" / "camara_betha.json"
PNCP_JSON = ROOT / "data" / "chunks" / "pncp.json"
LICITACOES_RESULTADOS_JSON = ROOT / "data" / "chunks" / "licitacoes_resultados.json"
MONITOR_STATE_PATH = ROOT.parent / "private" / "state" / "whatsapp_monitor_state.json"

_emendas_cache = None
_prefeitura_cache = None
_base_financeira_cache = None


def carregar_emendas() -> list[dict]:
    global _emendas_cache
    if _emendas_cache is not None:
        return _emendas_cache
    if not EMENDAS_JSON.exists():
        _emendas_cache = []
        return _emendas_cache
    try:
        with open(EMENDAS_JSON, "r", encoding="utf-8") as f:
            _emendas_cache = json.load(f)
    except Exception as e:
        print(f"⚠️ Erro ao carregar emendas: {e}")
        _emendas_cache = []
    return _emendas_cache


def limpar_cnpj(cnpj_str: str) -> str:
    if not cnpj_str:
        return ""
    return re.sub(r"\D", "", str(cnpj_str))


def buscar_emendas_por_cnpj(cnpj: str) -> list[dict]:
    cnpj_limpo = limpar_cnpj(cnpj)
    if not cnpj_limpo:
        return []
    emendas = carregar_emendas()
    return [e for e in emendas if limpar_cnpj(e.get("cnpj", "")) == cnpj_limpo]


def carregar_prefeitura() -> dict:
    global _prefeitura_cache
    if _prefeitura_cache is not None:
        return _prefeitura_cache
    if not PREFEITURA_JSON.exists():
        _prefeitura_cache = {}
        return _prefeitura_cache
    try:
        with open(PREFEITURA_JSON, "r", encoding="utf-8") as f:
            _prefeitura_cache = json.load(f)
    except Exception as e:
        print(f"⚠️ Erro ao carregar dados da Prefeitura: {e}")
        _prefeitura_cache = {}
    return _prefeitura_cache


def obter_raiz_cnpj(cnpj_str: str) -> str:
    cnpj_limpo = limpar_cnpj(cnpj_str)
    return cnpj_limpo[:8] if len(cnpj_limpo) >= 8 else ""


def obter_historico_fornecedor(cnpj: str) -> tuple[float | None, str | None]:
    raiz = obter_raiz_cnpj(cnpj)
    if not raiz:
        return None, None
    dados = carregar_prefeitura()
    top_fornecedores = dados.get("top_fornecedores_atual") or []
    for f in top_fornecedores:
        f_cnpj = f.get("cnpj") or ""
        f_raiz = obter_raiz_cnpj(f_cnpj)
        if f_raiz == raiz:
            return f.get("valor_total"), f.get("nome")
    return None, None


def _carregar_json(path: Path) -> dict:
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            dados = json.load(f)
        return dados if isinstance(dados, dict) else {}
    except Exception:
        return {}


def _texto_normalizado(valor) -> str:
    texto = unicodedata.normalize("NFKD", str(valor or ""))
    texto = texto.encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]+", " ", texto).strip()


_STOPWORDS_OBJETO = {
    "para", "com", "sem", "uma", "uns", "das", "dos", "que", "por", "pela",
    "pelo", "municipio", "municipal", "prefeitura", "varginha", "contratacao",
    "empresa", "especializada", "servico", "servicos", "fornecimento", "aquisicao",
    "futura", "eventual", "registro", "precos", "publica", "publico",
}


def _tokens_objeto(valor) -> set[str]:
    return {
        token for token in _texto_normalizado(valor).split()
        if len(token) >= 4 and token not in _STOPWORDS_OBJETO
    }


def _numero_simples(valor) -> str:
    m = re.search(r"\d+", str(valor or ""))
    return str(int(m.group(0))) if m else ""


def _ano_registro(item: dict) -> str:
    ano = re.search(r"20\d{2}", str(item.get("ano") or ""))
    if ano:
        return ano.group(0)
    for campo in ("data", "data_publicacao", "data_assinatura"):
        data = re.search(r"20\d{2}", str(item.get(campo) or ""))
        if data:
            return data.group(0)
    return ""


def _adicionar_candidatos(
    saida: list[dict], itens: list[dict], *, escopo: str, fonte: str,
    natureza: str, campo_valor: str = "valor", campo_numero: str = "numero",
) -> None:
    for item in itens or []:
        valor = item.get(campo_valor)
        try:
            valor = float(valor)
        except (TypeError, ValueError):
            continue
        if valor <= 0:
            continue
        saida.append({
            "valor": valor,
            "natureza": natureza,
            "fonte": fonte,
            "escopo": escopo,
            "numero": _numero_simples(item.get(campo_numero)),
            "ano": _ano_registro(item),
            "modalidade": _texto_normalizado(item.get("modalidade")),
            "objeto": str(item.get("objeto") or ""),
            "cnpj": limpar_cnpj(
                item.get("cnpj_fornecedor") or item.get("cnpj") or item.get("cnpj_vencedor") or ""
            ),
        })


def carregar_base_financeira() -> list[dict]:
    """Indexa apenas valores oficiais já coletados; não consulta a internet no envio."""
    global _base_financeira_cache
    if _base_financeira_cache is not None:
        return _base_financeira_cache

    candidatos: list[dict] = []
    prefeitura = carregar_prefeitura()
    _adicionar_candidatos(candidatos, prefeitura.get("contratos"), escopo="prefeitura", fonte="Betha - contratos", natureza="valor contratado")
    _adicionar_candidatos(candidatos, prefeitura.get("licit_andamento"), escopo="prefeitura", fonte="Betha - licitações", natureza="valor estimado")
    _adicionar_candidatos(candidatos, prefeitura.get("licit_finalizadas"), escopo="prefeitura", fonte="Betha - licitações", natureza="valor estimado")
    _adicionar_candidatos(candidatos, prefeitura.get("compras_diretas"), escopo="prefeitura", fonte="Betha - compras diretas", natureza="valor informado")

    camara = _carregar_json(CAMARA_BETHA_JSON)
    _adicionar_candidatos(candidatos, camara.get("contratos"), escopo="camara", fonte="Betha Camara - contratos", natureza="valor contratado")
    _adicionar_candidatos(candidatos, camara.get("licitacoes"), escopo="camara", fonte="Betha Câmara - licitações", natureza="valor estimado")

    pncp = _carregar_json(PNCP_JSON)
    _adicionar_candidatos(candidatos, pncp.get("contratos"), escopo="prefeitura", fonte="PNCP - contratos", natureza="valor contratado")

    resultados = _carregar_json(LICITACOES_RESULTADOS_JSON)
    for item in resultados.get("registros") or []:
        if item.get("valor_homologado_total") is not None:
            _adicionar_candidatos(candidatos, [item], escopo="prefeitura", fonte="PNCP - resultado da contratação", natureza="valor homologado", campo_valor="valor_homologado_total", campo_numero="numero_compra")
        elif item.get("valor_estimado") is not None:
            _adicionar_candidatos(candidatos, [item], escopo="prefeitura", fonte="PNCP - contratacao", natureza="valor estimado", campo_valor="valor_estimado", campo_numero="numero_compra")

    _base_financeira_cache = candidatos
    return candidatos


def _referencias_publicacao(pub: dict) -> list[tuple[str, str, str]]:
    partes = [
        pub.get("titulo", ""), pub.get("resumo", ""), pub.get("o_que_propoe", ""),
        pub.get("ementa", ""), " ".join(str(x) for x in (pub.get("pontos_atencao") or [])),
    ]
    texto = _texto_normalizado(" ".join(str(x) for x in partes))
    padrao = re.compile(
        r"(pregao|concorrencia|dispensa|inexigibilidade|licitacao|processo|contrato)"
        r"(?:\s+(?:eletronico|eletronica|administrativo))?\s+(?:n\s+)?(\d{1,4})(?:\s+(20\d{2}))?"
    )
    return [(m.group(1), str(int(m.group(2))), m.group(3) or "") for m in padrao.finditer(texto)]


def _modalidade_compativel(tipo: str, modalidade: str) -> bool:
    if tipo in {"processo", "contrato", "licitacao"}:
        return True
    if tipo == "pregao":
        return "pregao" in modalidade
    if tipo == "concorrencia":
        return "concorrencia" in modalidade
    if tipo == "dispensa":
        return "dispensa" in modalidade
    if tipo == "inexigibilidade":
        return "inexigibilidade" in modalidade
    return False


def cruzar_valor_publicacao(pub: dict, escopo: str) -> dict | None:
    """Cruza somente por identificadores + objeto/CNPJ; similaridade isolada é proibida."""
    referencias = _referencias_publicacao(pub)
    partes = [pub.get("titulo", ""), pub.get("resumo", ""), pub.get("o_que_propoe", ""), pub.get("ementa", "")]
    tokens_publicacao = _tokens_objeto(" ".join(str(x) for x in partes))
    raizes = {
        obter_raiz_cnpj(item.get("cnpj", ""))
        for item in (pub.get("envolvidos") or []) if obter_raiz_cnpj(item.get("cnpj", ""))
    }
    pontuados = []
    for candidato in carregar_base_financeira():
        if candidato["escopo"] != escopo:
            continue
        tokens_candidato = _tokens_objeto(candidato["objeto"])
        comuns = tokens_publicacao & tokens_candidato
        if len(comuns) < 3:
            continue
        cobertura = len(comuns) / max(1, min(len(tokens_candidato), 10))
        raiz_candidato = obter_raiz_cnpj(candidato.get("cnpj", ""))
        cnpj_confere = bool(raiz_candidato and raiz_candidato in raizes)
        ref_confere = False
        for tipo, numero, ano in referencias:
            if numero != candidato["numero"]:
                continue
            if ano and candidato["ano"] and ano != candidato["ano"]:
                continue
            if _modalidade_compativel(tipo, candidato["modalidade"]):
                ref_confere = True
                break
        if not cnpj_confere and not ref_confere:
            continue
        if cobertura < 0.35:
            continue
        score = (100 if cnpj_confere else 80) + (20 if ref_confere else 0) + len(comuns)
        pontuados.append((score, candidato))

    if not pontuados:
        return None
    pontuados.sort(key=lambda x: x[0], reverse=True)
    melhor_score, melhor = pontuados[0]
    empatados = [item for score, item in pontuados if score >= melhor_score - 2]
    if any(abs(item["valor"] - melhor["valor"]) > 0.01 for item in empatados[1:]):
        return None
    return {
        **melhor,
        "confianca": "alta",
        "metodo": "cruzamento por identificador, objeto e CNPJ/modalidade",
    }

TEMPLATE_CONFIG = {
    "api_type": "evolution",  # opções: "evolution", "z-api", "callmebot", "custom"
    "api_url": "http://localhost:8080",
    "instance_id": "fiscaliza",
    "token": "seu_token_aqui",
    "group_id": "120363XXXXXXXXXXXX@g.us",  # JID do grupo/comunidade do WhatsApp
    "filtrar_relevantes_apenas": True,     # envia apenas com interesse público / relevância alto/médio
    "valor_minimo_alerta_compras": 0.0,      # qualquer valor financeiro entra no monitoramento
    "data_minima_envio": "2026-07-01",       # só envia publicações com data >= esta (evita notícia antiga)
    "intervalo_envio_segundos": 45,          # pausa entre mensagens (0 = sem pausa)
    "max_por_execucao": 12,                  # teto de mensagens por rodada (0 = sem teto)
    "enviar_legislativo": True,
    "enviar_diario_oficial": True,
    "enviar_obras": True,
    "enviar_diarias": True,
    "enviar_alertas_transparencia": True,
    "enviar_resumo_semanal": True,
    "dia_resumo_semanal": 5                 # segunda=0; sábado=5
}


def carregar_config() -> dict:
    if not CONFIG_PATH.exists():
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_PATH.write_text(json.dumps(TEMPLATE_CONFIG, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"⚠️ Arquivo de configuração criado em: {CONFIG_PATH}")
        print("Configure seus tokens e URL do WhatsApp antes de rodar o script.")
        sys.exit(0)
    
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def carregar_enviados() -> set[str]:
    if not SENT_PATH.exists():
        return set()
    try:
        with open(SENT_PATH, "r", encoding="utf-8") as f:
            return set(json.load(f))
    except Exception:
        return set()


def salvar_enviados(enviados: set[str]):
    SENT_PATH.parent.mkdir(parents=True, exist_ok=True)
    # O monitor agora cobre diversas fontes. Manter todos os IDs evita que um
    # registro antigo volte ao grupo quando o histórico ultrapassar 1.000 itens.
    enviados_lista = sorted(enviados)
    with open(SENT_PATH, "w", encoding="utf-8") as f:
        json.dump(enviados_lista, f, indent=2, ensure_ascii=False)


def formatar_valor(valor) -> str:
    if valor is None:
        return "Não informado"
    try:
        return f"R$ {float(valor):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except (ValueError, TypeError):
        return str(valor)


def formatar_data(data_str) -> str:
    if not data_str:
        return "Não informada"
    try:
        data_limpa = data_str.split("T")[0]
        dt = datetime.strptime(data_limpa, "%Y-%m-%d")
        return dt.strftime("%d/%m/%Y")
    except Exception:
        return str(data_str)


def dentro_da_janela(data_str, data_minima: str) -> bool:
    """Retorna True se a publicação deve ser enviada considerando o piso de data.

    Com um piso configurado, registros sem data confiável não são enviados: não
    é possível afirmar que pertencem à janela aprovada pelo usuário."""
    if not data_minima:
        return True
    try:
        piso = datetime.strptime(data_minima, "%Y-%m-%d").date()
    except Exception:
        return True
    try:
        dt = datetime.strptime(str(data_str).split("T")[0], "%Y-%m-%d").date()
    except Exception:
        return False
    return dt >= piso


def valores_do_texto(*textos) -> list[str]:
    """Extrai valores monetários COM centavos do texto da IA (resumo/pontos).
    São muito mais confiáveis que a extração numérica bruta, que pesca números
    redondos de tabelas/outras publicações da mesma página do diário."""
    achados = []
    for t in textos:
        if not t:
            continue
        if isinstance(t, list):
            t = " ".join(str(x) for x in t)
        # Ex.: R$ 2.404.755,50 ou R $ 60000,00 (sempre exige centavos).
        for m in re.finditer(r"R\s*\$\s*((?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})", str(t), re.I):
            v = m.group(1)
            if v not in achados:
                achados.append(v)
    return achados


def _valor_texto_para_float(valor: str) -> float | None:
    try:
        return round(float(str(valor).replace(".", "").replace(",", ".")), 2)
    except (TypeError, ValueError):
        return None


def resolver_valor_publicacao(pub: dict, escopo: str) -> dict | None:
    """Resolve valor e proveniencia sem transformar ausencia em zero."""
    valores = pub.get("valores") or {}
    textos = (
        pub.get("resumo"), pub.get("o_que_propoe"), pub.get("ementa"),
        pub.get("pontos_atencao"),
    )
    explicitos = valores_do_texto(*textos)
    total = valores.get("total")
    try:
        total = float(total) if total is not None else None
    except (TypeError, ValueError):
        total = None

    if total is not None and valores.get("confianca") in {"alta", "media"}:
        return {
            "valor": total,
            "natureza": valores.get("natureza") or "valor citado na publicação",
            "fonte": valores.get("fonte_total") or "texto estruturado da publicação",
            "confianca": valores.get("confianca"),
            "metodo": valores.get("metodo") or "extração do texto oficial",
            "pagina": valores.get("pagina"),
            "link_verificacao": valores.get("link_verificacao") or "",
        }

    if explicitos:
        valor = _valor_texto_para_float(explicitos[0])
        if valor is not None:
            return {
                "valor": valor,
                "natureza": "valor citado no resumo da publicação",
                "fonte": "publicação estruturada",
                "confianca": "media",
                "metodo": "valor monetário explícito com centavos",
            }

    cruzado = cruzar_valor_publicacao(pub, escopo)
    if cruzado:
        return cruzado

    # Compatibilidade com registros antigos: o numero bruto continua visivel,
    # mas nunca e promovido a valor confirmado sem proveniencia.
    if total is not None:
        return {
            "valor": total,
            "natureza": valores.get("natureza") or "valor citado no ato",
            "fonte": "extração numérica legada",
            "confianca": "baixa",
            "metodo": "extração sem proveniência estruturada",
        }
    return None


def bloco_valor_publicacao(pub: dict, escopo: str) -> str:
    resolvido = resolver_valor_publicacao(pub, escopo)
    if not resolvido:
        bloco = (
            "- Situação: valor não publicado ou não localizado com segurança\n"
            "- Observação: ausência de valor na matéria não significa custo zero"
        )
        localizacao = pub.get("localizacao") or {}
        if localizacao.get("pagina_inicial"):
            bloco += f"\n- Onde conferir o ato: página {localizacao['pagina_inicial']} do documento"
        if localizacao.get("link_direto"):
            bloco += f"\n- Abrir o ato: {localizacao['link_direto']}"
        return bloco
    confianca = {"alta": "ALTA", "media": "MÉDIA", "baixa": "BAIXA"}.get(
        str(resolvido.get("confianca") or "").lower(), "INDISPONÍVEL"
    )
    bloco = (
        f"- {str(resolvido.get('natureza') or 'Valor').capitalize()}: {formatar_valor(resolvido.get('valor'))}\n"
        f"- Fonte do valor: {resolvido.get('fonte') or 'não informada'}\n"
        f"- Confiança: {confianca}\n"
        f"- Método: {resolvido.get('metodo') or 'não informado'}"
    )
    if resolvido.get("pagina"):
        bloco += f"\n- Onde conferir: página {resolvido['pagina']} do documento"
    elif resolvido.get("link_verificacao"):
        bloco += "\n- Onde conferir: documento original (sem paginação estável)"
    if resolvido.get("link_verificacao"):
        bloco += f"\n- Abrir evidência: {resolvido['link_verificacao']}"
    return bloco


def assunto_financeiro_diario(pub: dict) -> bool:
    """Indica se o ato do Diario tem contexto financeiro claro.

    O valor minimo de compras pode ser zero, mas ainda precisa haver sinal de
    compra, contrato, licitacao, diaria, credito, orcamento ou repasse. Isso
    evita que numeros de portarias, CNPJs ou leis sejam publicados como valores
    de gasto quando a propria publicacao nao trata de despesa/receita.
    """
    pontos = pub.get("pontos_atencao") or []
    partes = [
        pub.get("titulo", ""),
        pub.get("tipo_label", ""),
        pub.get("tema", ""),
        pub.get("resumo", ""),
        pub.get("o_que_propoe", ""),
        pub.get("ementa", ""),
        " ".join(str(p) for p in pontos),
    ]
    texto = " ".join(partes).lower()
    termos = (
        "licitacao", "licitação", "contrato", "contratacao", "contratação",
        "dispensa de licitacao", "dispensa de licitação", "inexigibilidade",
        "compra", "aquisicao", "aquisição",
        "aditivo", "diaria", "diária", "passagem", "credito", "crédito",
        "orcamento", "orçamento", "empenho", "convenio", "convênio",
        "repasse", "subvencao", "subvenção", "recurso", "suplementar", "r$",
    )
    return any(termo in texto for termo in termos)


def enviar_mensagem(config: dict, texto: str) -> bool:
    api_type = config.get("api_type", "evolution").lower()
    url = config.get("api_url", "")
    token = config.get("token", "")
    instance = config.get("instance_id", "")
    to = config.get("group_id", "")

    if not to or "XXXX" in to:
        print("⚠️ ID de grupo ou número de destino não configurado no whatsapp_config.json")
        return False

    try:
        if api_type == "evolution":
            # Evolution API v1/v2 endpoint padrão para envio de texto
            endpoint = f"{url}/message/sendText/{instance}"
            headers = {
                "Content-Type": "application/json",
                "apikey": token
            }
            payload = {
                "number": to,
                "options": {
                    "delay": 1200,
                    "presence": "composing"
                },
                "textMessage": {
                    "text": texto
                }
            }
        elif api_type == "z-api":
            # Z-API endpoint padrão
            endpoint = f"{url}/instances/{instance}/token/{token}/send-text"
            headers = {
                "Content-Type": "application/json"
            }
            payload = {
                "phone": to,
                "message": texto
            }
        elif api_type == "callmebot":
            # CallMeBot via requisição GET simples
            encoded_text = urllib.parse.quote(texto)
            # Para o CallMeBot, o group_id é tratado como o telefone cadastrado
            endpoint = f"https://api.callmebot.com/whatsapp.php?phone={to}&text={encoded_text}&apikey={token}"
            req = urllib.request.Request(endpoint, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=15) as r:
                return r.status == 200
        else:
            print(f"❌ Tipo de API '{api_type}' desconhecido.")
            return False

        # POST request genérica
        req = urllib.request.Request(
            endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=20) as r:
            res = json.loads(r.read().decode("utf-8"))
            # Verifica sucesso básico na resposta
            return res.get("key") is not None or res.get("messageId") is not None or res.get("status") in (200, "success")

    except Exception as e:
        print(f"❌ Erro ao enviar mensagem via {api_type}: {e}")
        return False


def processar_camara(pubs: list[dict], config: dict, enviados: set[str]) -> list[tuple[str, str]]:
    filtro_relevante = config.get("filtrar_relevantes_apenas", True)
    data_minima = config.get("data_minima_envio", "")
    mensagens = []

    for pub in pubs:
        pid = pub.get("id")
        if not pid or pid in enviados:
            continue

        # Piso de data: não reenvia publicação anterior à janela configurada
        if not dentro_da_janela(pub.get("data", ""), data_minima):
            continue

        # Filtro de interesse público / relevância
        int_pub = str(pub.get("interesse_publico") or "").lower()
        if filtro_relevante and int_pub not in ("alto", "médio", "medio", "sim", "3", "4", "5"):
            continue

        tipo_label = pub.get("tipo_label", "Ato")
        titulo = pub.get("titulo", "").upper()
        categoria = pub.get("categoria", "Legislativo")
        data_original = pub.get("data", "")
        data_formatada = formatar_data(data_original)
        autor = pub.get("autor", "Não identificado")
        situacao = pub.get("situacao", "Não informada")
        interesse_publico = str(pub.get("interesse_publico") or "Não informado").lower()
        tema = pub.get("tema", "Não informado")
        resumo = pub.get("resumo", "").strip()
        o_que_propoe = pub.get("o_que_propoe", "").strip()
        por_que = pub.get("por_que_acompanhar") or []
        pontos = pub.get("pontos_atencao") or []
        link_consulta = (pub.get("links") or {}).get("consulta") or ""
        link_anexo = (pub.get("links") or {}).get("inteiro_teor") or ""

        # Identificação de alertas por análise textual (Câmara)
        alertas_ia = []
        texto_analise = (titulo + " " + resumo + " " + o_que_propoe).lower()
        assunto_financeiro = assunto_financeiro_diario(pub)
        valor_resolvido = resolver_valor_publicacao(pub, "camara")
        
        if "urgência" in texto_analise or "urgente" in texto_analise:
            alertas_ia.append("Tramitação em regime de urgência identificada. Reduz o tempo de debate nas comissões parlamentares.")
        if "crédito" in texto_analise or "credito" in texto_analise or "orçamento" in texto_analise or "orcamento" in texto_analise:
            alertas_ia.append("Alteração orçamentária ou abertura de crédito. Impacta diretamente a alocação de recursos públicos do município.")

        # Construção da mensagem estruturada profissional (sem emojis)
        msg = ""

        # Preview do link no topo para o WhatsApp
        if link_consulta:
            msg += f"[{link_consulta}]\n\n"

        msg += f"🏛️ BOLETIM DE FISCALIZAÇÃO | CÂMARA DE VARGINHA\n"
        msg += f"════════════════════════════════════\n"
        msg += f"*{titulo}*\n\n"

        msg += f"📂 *Categoria:* {categoria}\n"
        msg += f"📅 *Data:* {data_formatada}\n"
        msg += f"✍️ *Autor:* {autor}\n"
        msg += f"⏳ *Situação:* {situacao}\n\n"

        msg += f"📌 *Relevância:* {interesse_publico.upper()}\n"
        msg += f"🏷️ *Tema:* {tema.upper()}\n\n"

        if resumo:
            msg += f"💡 *SÍNTESE DE FISCALIZAÇÃO*\n{resumo}\n\n"

        if o_que_propoe:
            msg += f"📄 *PROPOSTA DO PROJETO*\n{o_que_propoe}\n\n"

        if assunto_financeiro:
            msg += f"💰 *VALOR E PROVENIÊNCIA*\n{bloco_valor_publicacao(pub, 'camara')}\n\n"

        if por_que:
            if isinstance(por_que, list):
                por_que_str = "\n".join(f"- {p}" for p in por_que if p)
            else:
                por_que_str = str(por_que).strip()
            if por_que_str:
                msg += f"🔎 *JUSTIFICATIVA DE ACOMPANHAMENTO*\n{por_que_str}\n\n"

        # Pontos de atenção nativos + alertas IA estruturados
        todos_pontos = []
        if pontos:
            if isinstance(pontos, list):
                todos_pontos.extend([p for p in pontos if p])
            else:
                todos_pontos.append(str(pontos).strip())
        todos_pontos.extend(alertas_ia)

        if todos_pontos:
            msg += f"⚠️ *APONTAMENTOS DE AUDITORIA*\n"
            msg += "\n".join(f"- {p}" for p in todos_pontos if p) + "\n\n"

        if link_consulta or link_anexo:
            msg += f"🔗 *FONTES DE VERIFICAÇÃO*\n"
            if link_consulta:
                msg += f"Publicação: {link_consulta}\n"
            if link_anexo:
                pagina = valor_resolvido.get("pagina") if valor_resolvido else None
                localizacao = pub.get("localizacao") or {}
                pagina = pagina or localizacao.get("pagina_inicial")
                link_direto = (
                    valor_resolvido.get("link_verificacao") if valor_resolvido else None
                ) or localizacao.get("link_direto") or link_anexo
                rotulo_pagina = f" (página {pagina})" if pagina else ""
                msg += f"Documento original{rotulo_pagina}: {link_direto or link_anexo}\n"
            msg += "\n"

        # Rodapé de Controle Cidadão
        msg += f"🛡️ *CONTROLE CIDADÃO*\n"
        msg += f"Acesse o painel completo e histórico de dados: https://www.fiscalizavarginha.com.br\n"
        msg += f"Para solicitar esclarecimentos oficiais via e-SIC: https://www.varginha.mg.gov.br/portal/sic\n\n"

        # Hashtags discretas
        tema_clean = re.sub(r"\W+", "", tema.lower())
        msg += f"#fiscalizacao #varginha #camaramunicipal #legislativo #{tema_clean}"

        mensagens.append((pid, msg.strip()))

    return mensagens


def processar_diario(pubs: list[dict], config: dict, enviados: set[str]) -> list[tuple[str, str]]:
    filtro_relevante = config.get("filtrar_relevantes_apenas", True)
    val_minimo = config.get("valor_minimo_alerta_compras", 10000.0)
    data_minima = config.get("data_minima_envio", "")
    mensagens = []

    for pub in pubs:
        pid = pub.get("id")
        if not pid or pid in enviados:
            continue

        # Piso de data: não reenvia publicação anterior à janela configurada
        if not dentro_da_janela(pub.get("data", ""), data_minima):
            continue

        tipo_label = pub.get("tipo_label", "Ato")
        titulo = pub.get("titulo", "").upper()
        categoria = pub.get("categoria", "Diário Oficial")
        data_original = pub.get("data", "")
        data_formatada = formatar_data(data_original)
        orgao = pub.get("orgao", "Prefeitura de Varginha")
        relevancia_str = str(pub.get("relevancia") or "baixo").lower()
        tema = pub.get("tema", "Não informado")
        resumo = pub.get("resumo", "").strip()
        pontos_atencao = pub.get("pontos_atencao") or []
        link_consulta = (pub.get("links") or {}).get("publicacao") or ""
        link_anexo = (pub.get("links") or {}).get("anexo_pdf") or ""

        # Identifica se é compra da Câmara Municipal
        eh_compra_camara = "camara" in orgao.lower() or "câmara" in orgao.lower() or "legislativo" in orgao.lower()

        # Extrai o valor
        valores = pub.get("valores") or {}
        val_total = valores.get("total")
        valores_encontrados = valores.get("encontrados") or []
        texto_analise = (titulo + " " + resumo).lower()
        assunto_financeiro = assunto_financeiro_diario(pub)
        valor_resolvido = resolver_valor_publicacao(pub, "camara" if eh_compra_camara else "prefeitura")
        
        # Filtro de relevância ou valor mínimo de compras
        relevante = False
        if relevancia_str in ("alto", "médio", "medio", "sim", "3", "4", "5"):
            relevante = True
        
        valor_relevancia = valor_resolvido.get("valor") if valor_resolvido else val_total
        if assunto_financeiro and valor_relevancia is not None and float(valor_relevancia) >= val_minimo:
            relevante = True

        if filtro_relevante and not relevante:
            continue

        # Resolve envolvidos e busca histórico financeiro
        envolvidos_str = ""
        vinculos_emendas = []
        historico_fornecedores = []
        
        envolvidos = (pub.get("envolvidos") or []) if assunto_financeiro else []
        for env in envolvidos:
            nome = env.get("nome")
            cnpj = env.get("cnpj")
            papel = env.get("papel")

            if papel == "orgao":
                envolvidos_str += f"- Órgão responsável: {nome or 'não identificado'}"
                if cnpj:
                    envolvidos_str += f" ({cnpj})"
                envolvidos_str += "\n"
                continue
            
            if nome and cnpj:
                envolvidos_str += f"- {nome} ({cnpj})\n"
                
                # 1. Cruzamento com Emendas
                emendas_encontradas = buscar_emendas_por_cnpj(cnpj)
                for emenda in emendas_encontradas:
                    v_emenda = (
                        f"Emenda {emenda.get('numero')}/{emenda.get('ano')} de autoria de "
                        f"{emenda.get('autor')} no valor de {formatar_valor(emenda.get('valor_brl'))} "
                        f"destinada a {emenda.get('beneficiario')} (Objeto: {emenda.get('objeto')})"
                    )
                    if v_emenda not in vinculos_emendas:
                        vinculos_emendas.append(v_emenda)
                
                # 2. Histórico de Contratações da Prefeitura
                hist_valor, hist_nome = obter_historico_fornecedor(cnpj)
                if hist_valor is not None:
                    historico_fornecedores.append(
                        f"{nome}: Contratado acumulado em 2026 de {formatar_valor(hist_valor)}"
                    )
            elif nome:
                envolvidos_str += f"- {nome}\n"
            elif cnpj:
                envolvidos_str += f"- CNPJ: {cnpj}\n"

        # Sinais textuais para orientar conferência cidadã. Evita afirmar
        # irregularidade ou congelar no código limites legais que mudam com o tempo.
        alertas_forenses = []
        eh_dispensa = "dispensa de licita" in texto_analise or "inexigibilidade" in texto_analise
        if assunto_financeiro and eh_dispensa and val_total is not None:
            alertas_forenses.append(
                "Contratação direta identificada. Conferir justificativa, pesquisa de preços, fornecedor e eventual repetição de compras semelhantes."
            )

        # Alerta de termos sensíveis
        if "emergencial" in texto_analise or "calamidade" in texto_analise or "emergência" in texto_analise:
            alertas_forenses.append(
                "Contratação sob justificativa de emergência ou urgência. Conferir motivação, prazo, preços e entrega efetiva."
            )
        if "termo aditivo" in texto_analise or "aditivo" in texto_analise:
            if "acréscimo" in texto_analise or "aumento" in texto_analise or "reajuste" in texto_analise:
                alertas_forenses.append(
                    "Aditivo com possível alteração de valor. Conferir justificativa técnica, percentual acumulado e regras aplicáveis ao contrato."
                )
        if eh_compra_camara:
            alertas_forenses.append("Contratação direta realizada pelo Poder Legislativo (Câmara Municipal). Acompanhar a finalidade pública do gasto para o funcionamento da Câmara.")

        # Construção da mensagem estruturada profissional (sem emojis)
        msg = ""

        # Preview do link no topo para o WhatsApp
        if link_consulta:
            msg += f"[{link_consulta}]\n\n"

        if eh_compra_camara:
            msg += f"🏛️ BOLETIM DE FISCALIZAÇÃO | COMPRAS DA CÂMARA\n"
        else:
            msg += f"📰 BOLETIM DE FISCALIZAÇÃO | DIÁRIO OFICIAL DE VARGINHA\n"
        msg += f"════════════════════════════════════\n"
        msg += f"*{titulo}*\n\n"

        msg += f"📂 *Categoria:* {categoria}\n"
        msg += f"📅 *Data:* {data_formatada}\n"
        msg += f"🏢 *Órgão:* {orgao}\n\n"

        relevancia_label = {
            "medio": "MÉDIO",
            "médio": "MÉDIO",
            "alto": "ALTO",
            "baixo": "BAIXO",
        }.get(relevancia_str, relevancia_str.upper())
        msg += f"📌 *Relevância:* {relevancia_label}\n"
        msg += f"🏷️ *Tema:* {tema.upper()}\n\n"

        if resumo:
            msg += f"💡 *SÍNTESE DE FISCALIZAÇÃO*\n{resumo}\n\n"

        if envolvidos_str:
            msg += f"👥 *PARTES ENVOLVIDAS*\n{envolvidos_str.strip()}\n\n"

        # Histórico de fornecedores no município
        if historico_fornecedores:
            msg += f"📈 *HISTÓRICO FINANCEIRO DE CREDORES*\n"
            msg += "\n".join(f"- {h}" for h in historico_fornecedores) + "\n\n"

        # Vínculos parlamentares com emendas
        if vinculos_emendas:
            msg += f"🎯 *VÍNCULO PARLAMENTAR IDENTIFICADO*\n"
            msg += "\n".join(f"- {v}" for v in vinculos_emendas) + "\n\n"

        if assunto_financeiro or valor_resolvido:
            escopo = "camara" if eh_compra_camara else "prefeitura"
            msg += f"💰 *VALOR E PROVENIÊNCIA*\n{bloco_valor_publicacao(pub, escopo)}\n\n"

        # Junta pontos de atenção nativos e os alertas analíticos forenses
        todos_pontos = []
        if pontos_atencao:
            if isinstance(pontos_atencao, list):
                todos_pontos.extend([p for p in pontos_atencao if p])
            else:
                todos_pontos.append(str(pontos_atencao).strip())
        todos_pontos.extend(alertas_forenses)

        if todos_pontos:
            msg += f"⚠️ *APONTAMENTOS DE AUDITORIA*\n"
            msg += "\n".join(f"- {p}" for p in todos_pontos if p) + "\n\n"

        if link_consulta or link_anexo:
            msg += f"🔗 *FONTES DE VERIFICAÇÃO*\n"
            if link_consulta:
                msg += f"Publicação: {link_consulta}\n"
            if link_anexo:
                pagina = valor_resolvido.get("pagina") if valor_resolvido else None
                localizacao = pub.get("localizacao") or {}
                pagina = pagina or localizacao.get("pagina_inicial")
                link_direto = (
                    valor_resolvido.get("link_verificacao") if valor_resolvido else None
                ) or localizacao.get("link_direto") or link_anexo
                rotulo_pagina = f" (página {pagina})" if pagina else ""
                msg += f"Documento original{rotulo_pagina}: {link_direto or link_anexo}\n"
            msg += "\n"

        # Rodapé de Controle Cidadão
        msg += f"🛡️ *CONTROLE CIDADÃO*\n"
        msg += f"Acesse o painel completo e histórico de dados: https://www.fiscalizavarginha.com.br\n"
        msg += f"Para solicitar esclarecimentos oficiais via e-SIC: https://www.varginha.mg.gov.br/portal/sic\n\n"

        # Hashtags discretas
        tema_clean = re.sub(r"\W+", "", tema.lower())
        if eh_compra_camara:
            msg += f"#fiscalizacao #varginha #comprascamara #camaramunicipal #{tema_clean}"
        else:
            msg += f"#fiscalizacao #varginha #diariooficial #auditoria #{tema_clean}"

        mensagens.append((pid, msg.strip()))

    return mensagens


def checar_bridge(config: dict) -> tuple[bool, str]:
    """Healthcheck antes de tentar enviar: o painel do bridge expõe o estado
    da sessão. Detecta 'WhatsApp não conectado' de imediato, em vez de N
    erros 503 individuais (o bridge devolve 503 por mensagem nesse estado)."""
    url = (config.get("api_url") or "").rstrip("/")
    if not url:
        return False, "api_url não configurada"
    try:
        req = urllib.request.Request(url + "/", headers={"User-Agent": "FiscalizaBot/1.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            corpo = r.read().decode("utf-8", errors="replace")
    except Exception as e:
        return False, f"bridge inacessível: {e}"
    if "Desconectado" in corpo:
        return False, "bridge no ar, mas sessão do WhatsApp desconectada (ver painel/QR Code)"
    if "Conectado" not in corpo:
        return False, "bridge respondeu, mas sem estado 'Conectado' no painel"
    return True, "conectado"


def main():
    print("🚀 Iniciando Bot de Alertas para o WhatsApp - Fiscaliza Varginha")
    preview = "--preview" in sys.argv
    preview_limit = 0
    for argumento in sys.argv[1:]:
        if argumento.startswith("--preview-limit="):
            try:
                preview_limit = max(0, int(argumento.split("=", 1)[1]))
            except ValueError:
                print("❌ --preview-limit deve ser um número inteiro.")
                sys.exit(2)
    forcar_resumo = preview or "--resumo-semanal" in sys.argv
    config = carregar_config()
    enviados = carregar_enviados()

    if not preview:
        ok_bridge, motivo = checar_bridge(config)
        if not ok_bridge:
            print(f"❌ Healthcheck do bridge falhou: {motivo}")
            print("   Nenhum envio tentado; a fila fica preservada para o próximo ciclo.")
            sys.exit(1)
        print(f"✅ Bridge WhatsApp: {motivo}")
    hoje = datetime.now().astimezone().date()

    todas_mensagens = []
    proximo_estado = None

    # 1. Processa Câmara
    if config.get("enviar_legislativo", True):
        try:
            pubs = []
            if CAMARA_JSON.exists():
                with open(CAMARA_JSON, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    pubs = data.get("publicacoes", [])

            # A base resumida do SAPL costuma atualizar antes da análise detalhada.
            # Converte matérias novas para o mesmo boletim e mantém o ID compatível,
            # evitando reenvio quando a versão enriquecida ficar pronta.
            if CAMARA_ANOS_JSON.exists():
                with open(CAMARA_ANOS_JSON, "r", encoding="utf-8") as f:
                    camara_anos = json.load(f)
                extras = materias_para_publicacoes(
                    camara_anos,
                    hoje.year,
                    config.get("data_minima_envio", ""),
                )
                ids_existentes = {pub.get("id") for pub in pubs}
                pubs.extend(pub for pub in extras if pub.get("id") not in ids_existentes)

            todas_mensagens += processar_camara(pubs, config, enviados)
        except Exception as e:
            print(f"❌ Erro ao ler publicações da Câmara: {e}")

    # 2. Processa Diário Oficial
    if config.get("enviar_diario_oficial", True) and DIARIO_JSON.exists():
        try:
            with open(DIARIO_JSON, "r", encoding="utf-8") as f:
                data = json.load(f)
                pubs = data.get("publicacoes", [])
                todas_mensagens += processar_diario(pubs, config, enviados)
        except Exception as e:
            print(f"❌ Erro ao ler publicações do Diário Oficial: {e}")

    # 3. Obras, transparência e resumo semanal. Na primeira execução, as obras
    # e pendências formam apenas uma linha de base, sem avalanche retroativa.
    try:
        complementares, proximo_estado = preparar_conteudos_complementares(
            ROOT,
            config,
            enviados,
            hoje,
            forcar_resumo=forcar_resumo,
        )
        todas_mensagens += complementares
    except Exception as e:
        print(f"❌ Erro ao preparar monitoramento complementar: {e}")

    if not todas_mensagens:
        print("💡 Nenhuma nova publicação qualificada para envio hoje.")
        if not preview and proximo_estado is not None:
            salvar_estado(MONITOR_STATE_PATH, proximo_estado)
            print("ℹ️ Linha de base de obras e transparência atualizada.")
        return

    mensagens_unicas = []
    ids_na_execucao = set()
    for pid, msg in todas_mensagens:
        if pid in enviados:
            continue
        if pid in ids_na_execucao:
            print(f"ℹ️ Publicação duplicada ignorada nesta execução: {pid}")
            continue
        ids_na_execucao.add(pid)
        mensagens_unicas.append((pid, msg))

    todas_mensagens = mensagens_unicas

    if not todas_mensagens:
        print("💡 Nenhuma nova publicação qualificada para envio hoje após remover duplicidades.")
        if not preview and proximo_estado is not None:
            salvar_estado(MONITOR_STATE_PATH, proximo_estado)
        return

    if preview:
        total_previa = len(todas_mensagens)
        mensagens_previa = todas_mensagens[:preview_limit] if preview_limit else todas_mensagens
        print(
            f"🔎 PRÉVIA LOCAL — exibindo {len(mensagens_previa)} de {total_previa} mensagem(ns); "
            "nada será enviado."
        )
        for indice, (pid, msg) in enumerate(mensagens_previa, start=1):
            print(f"\n{'=' * 72}\nPRÉVIA {indice} | ID: {pid}\n{'=' * 72}\n{msg}\n")
        return

    import time

    # Ritmo de envio: evita despejar tudo de uma vez no grupo.
    # intervalo_envio_segundos: pausa entre mensagens (parece conversa, não spam).
    # max_por_execucao: teto por rodada; o excedente fica na fila e sai no próximo
    #   ciclo (0 = sem teto). Anti-duplicado garante que nada se perde nem repete.
    intervalo = float(config.get("intervalo_envio_segundos", 45))
    max_exec = int(config.get("max_por_execucao", 12))

    total_qualificadas = len(todas_mensagens)
    if max_exec > 0 and total_qualificadas > max_exec:
        adiadas = total_qualificadas - max_exec
        todas_mensagens = todas_mensagens[:max_exec]
        print(f"📬 {total_qualificadas} qualificadas. Enviando {max_exec} agora "
              f"(intervalo {intervalo:.0f}s); {adiadas} ficam para o próximo ciclo.")
    else:
        print(f"📬 Encontradas {total_qualificadas} novas publicações qualificadas. "
              f"Enviando (intervalo {intervalo:.0f}s)...")

    sucessos = 0
    falhas = 0
    ultimo = len(todas_mensagens) - 1
    for i, (pid, msg) in enumerate(todas_mensagens):
        print(f"💬 Enviando alerta do ID: {pid}...")
        if enviar_mensagem(config, msg):
            enviados.add(pid)
            salvar_enviados(enviados)  # Salva incrementalmente para garantir resiliência contra falhas
            sucessos += 1
            # Espaça os envios (pula a espera após a última mensagem)
            if intervalo > 0 and i < ultimo:
                time.sleep(intervalo)
        else:
            print(f"❌ Falha no envio do ID: {pid}")
            falhas += 1

    truncou = max_exec > 0 and total_qualificadas > max_exec
    if falhas == 0 and not truncou and proximo_estado is not None:
        salvar_estado(MONITOR_STATE_PATH, proximo_estado)
        print("ℹ️ Estado de obras e transparência atualizado com segurança.")
    elif truncou and proximo_estado is not None:
        # Alguns alertas (possivelmente de obras) ficaram para o próximo ciclo:
        # não avança a linha de base, senão os adiados nunca seriam regerados.
        print("⏳ Estado complementar preservado — há alertas adiados para o próximo ciclo.")
    elif falhas and proximo_estado is not None:
        print("⚠️ Estado complementar preservado para repetir os alertas que falharam.")

    if sucessos > 0:
        print(f"✅ Concluído: {sucessos} novos alertas transmitidos e registrados.")
    else:
        print("ℹ️ Nenhum alerta pôde ser enviado com sucesso nesta execução.")

    # Falha total de envio precisa derrubar o exit code, senão o pipeline
    # marca whatsapp=SUCESSO com o bridge fora do ar (regressão de 15-17/07).
    if falhas > 0 and sucessos == 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
