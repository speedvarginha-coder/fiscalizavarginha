import sys
import json
from pathlib import Path

# Ajusta o path para importar do diretório correto
sys.path.append(str(Path(__file__).parent))
from alertar_whatsapp import carregar_config, enviar_mensagem, processar_camara, processar_diario, CAMARA_JSON

def main():
    print("🤖 Iniciando teste de disparo com a nova formatação analítica...")
    config = carregar_config()
    
    # Configuração temporária para o teste extrair qualquer publicação
    teste_config = config.copy()
    teste_config["filtrar_relevantes_apenas"] = False
    
    # 1. Obter uma publicação real da Câmara para teste
    msg_camara = ""
    if CAMARA_JSON.exists():
        with open(CAMARA_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
            pubs = data.get("publicacoes", [])
            if pubs:
                msgs = processar_camara(pubs[:1], teste_config, set())
                if msgs:
                    msg_camara = msgs[0][1]
    
    if not msg_camara:
        msg_camara = (
            "🤖 *Fiscaliza Varginha: Teste da Câmara*\n"
            "Não foi possível ler as publicações da Câmara no momento."
        )

    # 2. Simular uma publicação do Diário Oficial com cruzamento de dados inteligente
    # CNPJ Vida Viva (emenda cadastrada): 01.355.795/0001-13
    # CNPJ Hospital Regional (credor com histórico na prefeitura): 25.863.390/0001-99
    pub_diario_mock = [
        {
            "id": "mock_diario_teste_analitico",
            "tipo_label": "Contrato",
            "titulo": "EXTRATO DE DISPENSA DE LICITAÇÃO Nº 042/2026 - SECRETARIA DE SAÚDE",
            "categoria": "Diário Oficial",
            "data": "2026-07-03",
            "orgao": "Câmara Municipal de Varginha",
            "relevancia": "alto",
            "tema": "saúde",
            "resumo": "Contratação emergencial de insumos hospitalares e suplementação alimentar de urgência para atendimento das demandas de saúde e assistência social do município.",
            "pontos_atencao": [
                "Requer acompanhamento do cronograma de desembolso financeiro."
            ],
            "links": {
                "publicacao": "https://www.varginha.mg.gov.br/portal/diario-oficial/ver/232/",
                "anexo_pdf": "https://www.varginha.mg.gov.br/portal/diario-oficial/ver/232/pdf"
            },
            "valores": {
                "total": 58500.00,
                "encontrados": [58500.00]
            },
            "envolvidos": [
                {
                    "nome": "HOSPITAL REGIONAL DO SUL DE MINAS",
                    "cnpj": "25.863.390/0001-99"
                },
                {
                    "nome": "ASSOCIAÇÃO DO VOLUNTARIADO DE VARGINHA VIDA VIVA",
                    "cnpj": "01.355.795/0001-13"
                }
            ]
        }
    ]

    msgs_diario = processar_diario(pub_diario_mock, teste_config, set())
    msg_diario = msgs_diario[0][1] if msgs_diario else "Falha ao gerar mock do diário."

    print(f"Destinatário do Grupo: {config.get('group_id')}")
    
    # Disparar Alerta da Câmara
    print("\n[TESTE 1] Enviando alerta da Câmara...")
    sucesso_camara = enviar_mensagem(config, msg_camara)
    if sucesso_camara:
        print("✅ Alerta da Câmara enviado com sucesso!")
    else:
        print("❌ Falha ao enviar alerta da Câmara.")

    # Disparar Alerta do Diário Oficial (Com cruzamentos)
    print("\n[TESTE 2] Enviando boletim analítico do Diário Oficial...")
    sucesso_diario = enviar_mensagem(config, msg_diario)
    if sucesso_diario:
        print("✅ Boletim inteligente do Diário Oficial enviado com sucesso!")
    else:
        print("❌ Falha ao enviar boletim do Diário Oficial.")

if __name__ == "__main__":
    main()
