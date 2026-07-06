"""Envio de alertas diários de compras, contratos e diário oficial para o WhatsApp.

Este script lê as publicações estruturadas da Câmara e do Diário Oficial da Prefeitura,
filtra por relevância ou valores mínimos de contratação, formata uma mensagem amigável
com marcações de negrito do WhatsApp (*texto*) e envia para o grupo/comunidade configurado.

Previne duplicidade usando um arquivo de controle de histórico em `private/state/whatsapp_sent.json`.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

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

_emendas_cache = None
_prefeitura_cache = None


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

TEMPLATE_CONFIG = {
    "api_type": "evolution",  # opções: "evolution", "z-api", "callmebot", "custom"
    "api_url": "http://localhost:8080",
    "instance_id": "fiscaliza",
    "token": "seu_token_aqui",
    "group_id": "120363XXXXXXXXXXXX@g.us",  # JID do grupo/comunidade do WhatsApp
    "filtrar_relevantes_apenas": True,     # envia apenas com interesse público / relevância alto/médio
    "valor_minimo_alerta_compras": 10000.0,  # valor mínimo de contrato/dispensa para alertar
    "enviar_legislativo": True,
    "enviar_diario_oficial": True
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
    enviados_lista = list(enviados)
    # Limita o histórico aos últimos 1000 registros para otimização
    if len(enviados_lista) > 1000:
        enviados_lista = enviados_lista[-1000:]
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
        # Ex.: R$ 2.404.755,50  (formato brasileiro com centavos)
        for m in re.finditer(r"R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})", str(t)):
            v = m.group(1)
            if v not in achados:
                achados.append(v)
    return achados


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
    mensagens = []

    for pub in pubs:
        pid = pub.get("id")
        if not pid or pid in enviados:
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
        
        if "urgência" in texto_analise or "urgente" in texto_analise:
            alertas_ia.append("Tramitação em regime de urgência identificada. Reduz o tempo de debate nas comissões parlamentares.")
        if "crédito" in texto_analise or "credito" in texto_analise or "orçamento" in texto_analise or "orcamento" in texto_analise:
            alertas_ia.append("Alteração orçamentária ou abertura de crédito. Impacta diretamente a alocação de recursos públicos do município.")

        # Construção da mensagem estruturada profissional (sem emojis)
        msg = ""

        # Preview do link no topo para o WhatsApp
        if link_consulta:
            msg += f"[{link_consulta}]\n\n"

        msg += f"BOLETIM DE FISCALIZAÇÃO | CÂMARA DE VARGINHA\n"
        msg += f"════════════════════════════════════\n"
        msg += f"{titulo}\n\n"

        msg += f"*Categoria:* {categoria}\n"
        msg += f"*Data:* {data_formatada}\n"
        msg += f"*Autor:* {autor}\n"
        msg += f"*Situação:* {situacao}\n\n"

        msg += f"*Relevância:* {interesse_publico.upper()}\n"
        msg += f"*Tema:* {tema.upper()}\n\n"

        if resumo:
            msg += f"*SÍNTESE DE FISCALIZAÇÃO*\n{resumo}\n\n"

        if o_que_propoe:
            msg += f"*PROPOSTA DO PROJETO*\n{o_que_propoe}\n\n"

        if por_que:
            if isinstance(por_que, list):
                por_que_str = "\n".join(f"- {p}" for p in por_que if p)
            else:
                por_que_str = str(por_que).strip()
            if por_que_str:
                msg += f"*JUSTIFICATIVA DE ACOMPANHAMENTO*\n{por_que_str}\n\n"

        # Pontos de atenção nativos + alertas IA estruturados
        todos_pontos = []
        if pontos:
            if isinstance(pontos, list):
                todos_pontos.extend([p for p in pontos if p])
            else:
                todos_pontos.append(str(pontos).strip())
        todos_pontos.extend(alertas_ia)

        if todos_pontos:
            msg += f"*APONTAMENTOS DE AUDITORIA*\n"
            msg += "\n".join(f"- {p}" for p in todos_pontos if p) + "\n\n"

        if link_consulta or link_anexo:
            msg += f"*FONTES DE VERIFICAÇÃO*\n"
            if link_consulta:
                msg += f"Publicação: {link_consulta}\n"
            if link_anexo:
                msg += f"Documento original: {link_anexo}\n\n"

        # Rodapé de Controle Cidadão
        msg += f"*CONTROLE CIDADÃO*\n"
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
    mensagens = []

    for pub in pubs:
        pid = pub.get("id")
        if not pid or pid in enviados:
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
        
        # Filtro de relevância ou valor mínimo de compras
        relevante = False
        if relevancia_str in ("alto", "médio", "medio", "sim", "3", "4", "5"):
            relevante = True
        
        if val_total is not None and float(val_total) >= val_minimo:
            relevante = True

        if filtro_relevante and not relevante:
            continue

        # Resolve envolvidos e busca histórico financeiro
        envolvidos_str = ""
        vinculos_emendas = []
        historico_fornecedores = []
        
        envolvidos = pub.get("envolvidos") or []
        for env in envolvidos:
            nome = env.get("nome")
            cnpj = env.get("cnpj")
            
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

        # Análise forense de riscos e termos sensíveis
        alertas_forenses = []
        texto_analise = (titulo + " " + resumo).lower()
        
        # Alerta de limite de dispensa de licitação (Lei 14.133)
        eh_dispensa = "dispensa" in texto_analise or "inexigibilidade" in texto_analise
        if eh_dispensa and val_total is not None:
            val = float(val_total)
            if 50000.0 <= val <= 61000.0:
                alertas_forenses.append("Dispensa de licitação com valor próximo ao limite legal (R$ 59,9 mil) para compras/serviços. Risco de fracionamento de despesa.")
            elif 100000.0 <= val <= 122000.0:
                alertas_forenses.append("Dispensa de licitação com valor próximo ao limite legal (R$ 119,8 mil) para engenharia/veículos. Risco de fracionamento de despesa.")

        # Alerta de termos sensíveis
        if "emergencial" in texto_analise or "calamidade" in texto_analise or "emergência" in texto_analise:
            alertas_forenses.append("Contratação sob alegação de emergência/urgência. Requer fiscalização do nexo causal e prazo máximo de 1 ano.")
        if "termo aditivo" in texto_analise or "aditivo" in texto_analise:
            if "acréscimo" in texto_analise or "aumento" in texto_analise or "reajuste" in texto_analise:
                alertas_forenses.append("Termo aditivo de ampliação de valores. O teto legal permitido de acréscimo é de 25% para a maioria dos contratos públicos.")
        if eh_compra_camara:
            alertas_forenses.append("Contratação direta realizada pelo Poder Legislativo (Câmara Municipal). Acompanhar a finalidade pública do gasto para o funcionamento da Câmara.")

        # Construção da mensagem estruturada profissional (sem emojis)
        msg = ""

        # Preview do link no topo para o WhatsApp
        if link_consulta:
            msg += f"[{link_consulta}]\n\n"

        if eh_compra_camara:
            msg += f"BOLETIM DE FISCALIZAÇÃO | COMPRAS DA CÂMARA MUNICIPAL\n"
        else:
            msg += f"BOLETIM DE FISCALIZAÇÃO | DIÁRIO OFICIAL DE VARGINHA\n"
        msg += f"════════════════════════════════════\n"
        msg += f"{titulo}\n\n"

        msg += f"*Categoria:* {categoria}\n"
        msg += f"*Data:* {data_formatada}\n"
        msg += f"*Órgão:* {orgao}\n\n"

        msg += f"*Relevância:* {relevancia_str.upper()}\n"
        msg += f"*Tema:* {tema.upper()}\n\n"

        if resumo:
            msg += f"*SÍNTESE DE FISCALIZAÇÃO*\n{resumo}\n\n"

        if envolvidos_str:
            msg += f"*PARTES ENVOLVIDAS*\n{envolvidos_str.strip()}\n\n"

        # Histórico de fornecedores no município
        if historico_fornecedores:
            msg += f"*HISTÓRICO FINANCEIRO DE CREDORES*\n"
            msg += "\n".join(f"- {h}" for h in historico_fornecedores) + "\n\n"

        # Vínculos parlamentares com emendas
        if vinculos_emendas:
            msg += f"*VÍNCULO PARLAMENTAR IDENTIFICADO*\n"
            msg += "\n".join(f"- {v}" for v in vinculos_emendas) + "\n\n"

        # Valores — prioriza o valor do TEXTO da IA (confiável, com centavos).
        # A extração numérica bruta (val_total/encontrados) costuma pescar números
        # redondos errados de tabelas ou de outras publicações da mesma página.
        vals_texto = valores_do_texto(resumo, pontos_atencao)
        if vals_texto:
            valores_str = f"- Valor: R$ {vals_texto[0]}\n"
            if len(vals_texto) > 1:
                outros_txt = ", ".join(f"R$ {v}" for v in vals_texto[1:3])
                valores_str += f"- Outros valores citados: {outros_txt}\n"
        elif val_total is not None:
            # Sem valor no texto: mostra o bruto, mas marca como "a conferir".
            valores_str = f"- Valor citado (confira na fonte): {formatar_valor(val_total)}\n"
        else:
            valores_str = "- Valor: não identificado com segurança (confira na fonte)\n"

        msg += f"*VALORES IDENTIFICADOS*\n{valores_str.strip()}\n\n"

        # Junta pontos de atenção nativos e os alertas analíticos forenses
        todos_pontos = []
        if pontos_atencao:
            if isinstance(pontos_atencao, list):
                todos_pontos.extend([p for p in pontos_atencao if p])
            else:
                todos_pontos.append(str(pontos_atencao).strip())
        todos_pontos.extend(alertas_forenses)

        if todos_pontos:
            msg += f"*APONTAMENTOS DE AUDITORIA*\n"
            msg += "\n".join(f"- {p}" for p in todos_pontos if p) + "\n\n"

        if link_consulta or link_anexo:
            msg += f"*FONTES DE VERIFICAÇÃO*\n"
            if link_consulta:
                msg += f"Publicação: {link_consulta}\n"
            if link_anexo:
                msg += f"Documento original: {link_anexo}\n\n"

        # Rodapé de Controle Cidadão
        msg += f"*CONTROLE CIDADÃO*\n"
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


def main():
    print("🚀 Iniciando Bot de Alertas para o WhatsApp - Fiscaliza Varginha")
    config = carregar_config()
    enviados = carregar_enviados()

    todas_mensagens = []

    # 1. Processa Câmara
    if config.get("enviar_legislativo", True) and CAMARA_JSON.exists():
        try:
            with open(CAMARA_JSON, "r", encoding="utf-8") as f:
                data = json.load(f)
                pubs = data.get("publicacoes", [])
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

    if not todas_mensagens:
        print("💡 Nenhuma nova publicação qualificada para envio hoje.")
        return

    print(f"📬 Encontradas {len(todas_mensagens)} novas publicações qualificadas. Enviando...")
    
    sucessos = 0
    for pid, msg in todas_mensagens:
        print(f"💬 Enviando alerta do ID: {pid}...")
        if enviar_mensagem(config, msg):
            enviados.add(pid)
            salvar_enviados(enviados)  # Salva incrementalmente para garantir resiliência contra falhas
            sucessos += 1
            # Evita sobrecarga ou bloqueio do WhatsApp
            import time
            time.sleep(2)
        else:
            print(f"❌ Falha no envio do ID: {pid}")

    if sucessos > 0:
        print(f"✅ Concluído: {sucessos} novos alertas transmitidos e registrados.")
    else:
        print("ℹ️ Nenhum alerta pôde ser enviado com sucesso nesta execução.")


if __name__ == "__main__":
    main()
