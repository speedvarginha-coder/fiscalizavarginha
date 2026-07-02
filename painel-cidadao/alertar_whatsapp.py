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
    with open(SENT_PATH, "w", encoding="utf-8") as f:
        json.dump(list(enviados), f, indent=2, ensure_ascii=False)


def formatar_valor(valor) -> str:
    if valor is None:
        return "Não informado"
    try:
        return f"R$ {float(valor):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except (ValueError, TypeError):
        return str(valor)


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
            import urllib.parse
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

        # Construção da mensagem formatada para WhatsApp
        tipo_label = pub.get("tipo_label", "Ato").upper()
        titulo = pub.get("titulo", "")
        autor = pub.get("autor", "Não identificado")
        resumo = pub.get("resumo", "").strip()
        o_que_propoe = pub.get("o_que_propoe", "").strip()
        por_que_acompanhar = pub.get("por_que_acompanhar", "").strip()
        link = (pub.get("links") or {}).get("consulta") or ""

        msg = f"🏛️ *CÂMARA MUNICIPAL: NOVO ATO DETECTADO*\n"
        msg += f"📄 *{tipo_label}*\n"
        msg += f"✍️ *Autor:* {autor}\n\n"
        
        if resumo:
            msg += f"📝 *Resumo Cidadão:*\n{resumo}\n\n"
        if o_que_propoe:
            msg += f"🎯 *O que propõe:*\n{o_que_propoe}\n\n"
        if por_que_acompanhar:
            msg += f"🔔 *Por que acompanhar:*\n{por_que_acompanhar}\n\n"
        if link:
            msg += f"🔗 *Conferir na fonte:* {link}"

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

        tipo = pub.get("tipo", "")
        tipo_label = pub.get("tipo_label", "Ato").upper()
        titulo = pub.get("titulo", "")
        resumo = pub.get("resumo", "").strip()
        pontos_atencao = pub.get("pontos_atencao", [])
        link = (pub.get("links") or {}).get("publicacao") or ""
        
        # Extrai o valor
        valores = pub.get("valores") or {}
        val_total = valores.get("total")
        
        # Filtro de relevância ou valor mínimo de compras
        relevante = False
        relevancia_str = str(pub.get("relevancia") or "").lower()
        if relevancia_str in ("alto", "médio", "medio", "sim", "3", "4", "5"):
            relevante = True
        
        if val_total is not None and float(val_total) >= val_minimo:
            relevante = True

        if filtro_relevante and not relevante:
            continue

        # Resolve envolvidos
        envolvidos_str = ""
        envolvidos = pub.get("envolvidos") or []
        for env in envolvidos:
            nome = env.get("nome")
            cnpj = env.get("cnpj")
            if nome and cnpj:
                envolvidos_str += f"- {nome} ({cnpj})\n"
            elif nome:
                envolvidos_str += f"- {nome}\n"
            elif cnpj:
                envolvidos_str += f"- CNPJ: {cnpj}\n"

        msg = f"🔔 *DIÁRIO OFICIAL: CONTRATO / COMPRA DETECTADA*\n"
        msg += f"📄 *{tipo_label}*\n"
        if val_total is not None:
            msg += f"💰 *Valor:* {formatar_valor(val_total)}\n"
        msg += f"🏢 *Órgão:* Prefeitura de Varginha\n\n"

        if envolvidos_str:
            msg += f"👥 *Envolvidos:*\n{envolvidos_str.strip()}\n\n"
        if resumo:
            msg += f"📝 *Resumo Cidadão:*\n{resumo}\n\n"
        
        if pontos_atencao:
            # Se for lista ou string
            if isinstance(pontos_atencao, list):
                pontos = "\n".join(f"- {p}" for p in pontos_atencao if p)
            else:
                pontos = str(pontos_atencao).strip()
            if pontos:
                msg += f"⚠️ *Pontos de Atenção (IA):*\n{pontos}\n\n"
                
        if link:
            msg += f"🔗 *Conferir no Diário Oficial:* {link}"

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
            sucessos += 1
            # Evita sobrecarga ou bloqueio do WhatsApp
            import time
            time.sleep(2)
        else:
            print(f"❌ Falha no envio do ID: {pid}")

    if sucessos > 0:
        salvar_enviados(enviados)
        print(f"✅ Sucesso: {sucessos} alertas enviados e registrados.")
    else:
        print("ℹ️ Nenhum alerta pôde ser enviado com sucesso.")


if __name__ == "__main__":
    main()
