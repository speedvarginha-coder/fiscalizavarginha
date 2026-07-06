"""Script auxiliar para identificar o ID do grupo de WhatsApp a partir do Link de Convite."""
import json
import re
import sys
import urllib.request
from pathlib import Path

# Console do Windows UTF-8
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT.parent / "private" / "whatsapp_config.json"

INVITE_CODE = "ImAaUvQaHgM4WUsHf0SNJc"  # Código de convite do grupo do Fiscaliza Varginha


def carregar_config() -> dict:
    if not CONFIG_PATH.exists():
        print(f"❌ O arquivo de configuração em {CONFIG_PATH} não existe.")
        print("Rode o script `alertar_whatsapp.py` ou crie o arquivo primeiro.")
        return {}
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def salvar_config(config: dict):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    print(f"💾 Configurações salvas e atualizadas em: {CONFIG_PATH}")


def main():
    print("🔍 Iniciando Assistente de Identificação de Grupo do WhatsApp...")
    config = carregar_config()
    if not config:
        return

    api_type = config.get("api_type", "z-api").lower()
    url = config.get("api_url", "https://api.z-api.io")
    token = config.get("token", "")
    instance = config.get("instance_id", "")

    if not token or "SEU_TOKEN" in token or "token_aqui" in token:
        print("⚠️  Aviso: Você precisa preencher o 'token' e o 'instance_id' no arquivo 'private/whatsapp_config.json' primeiro.")
        print("Consulte o painel do seu provedor (Z-API ou Evolution API) para copiar estes valores.")
        return

    print(f"📡 Conectando ao provedor {api_type.upper()}...")
    try:
        group_id = None
        if api_type == "z-api":
            # Endpoint correto da Z-API para ler metadados do link de convite
            import urllib.parse
            invite_url = f"https://chat.whatsapp.com/{INVITE_CODE}"
            encoded_url = urllib.parse.quote(invite_url)
            endpoint = f"{url}/instances/{instance}/token/{token}/group-invitation-metadata?url={encoded_url}"
            print(f"Buscando metadados na Z-API...")
            
            req = urllib.request.Request(endpoint, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=15) as r:
                res = json.loads(r.read().decode("utf-8"))
                group_id = res.get("id") or res.get("phone")
                
        elif api_type == "evolution":
            # Endpoint para buscar informações do convite no Evolution API
            endpoint = f"{url}/group/inviteInfo?inviteCode={INVITE_CODE}"
            print(f"Buscando metadados na Evolution API...")
            
            headers = {"Content-Type": "application/json", "apikey": token}
            req = urllib.request.Request(endpoint, headers=headers)
            with urllib.request.urlopen(req, timeout=15) as r:
                res = json.loads(r.read().decode("utf-8"))
                group_id = res.get("id")

        else:
            print(f"❌ O tipo de API '{api_type}' configurado não suporta resolução automática de convites.")
            print("Mude o provedor para 'z-api' ou 'evolution'.")
            return

        if group_id:
            print(f"🎉 Grupo Identificado com Sucesso!")
            print(f"🆔 ID do Grupo (JID): {group_id}")
            config["group_id"] = group_id
            salvar_config(config)
            print("\n✨ Tudo pronto! O robô de alertas diários já sabe onde postar as atualizações.")
        else:
            print("❌ Não foi possível extrair o ID do grupo a partir da resposta da API.")
            print("Resposta recebida:", res)

    except Exception as e:
        print("\n❌ Falha na conexão com a API de WhatsApp.")
        print(f"Detalhes do erro: {e}")
        print("\nDicas para resolver:")
        print("1. Certifique-se de que o número do robô leu o QR Code e está conectado.")
        print("2. Verifique se o seu Token e a URL do servidor estão corretos no arquivo 'private/whatsapp_config.json'.")


if __name__ == "__main__":
    main()
