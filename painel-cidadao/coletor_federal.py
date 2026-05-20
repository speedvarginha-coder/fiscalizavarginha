"""
Zela Varginha — Coletor Federal
================================
Rastreador de recursos da União destinados a Varginha-MG.
Foca em transferências constitucionais, convênios e emendas parlamentares federais.

Fontes principais:
  - Portal da Transparência (CGU)
  - Transferegov / Dados.gov.br
"""
import datetime as dt
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)

# Identificadores de Varginha
CODIGO_IBGE = "3170701"
SIAFI_MUNICIPIO = "5415"
CNPJ_PREFEITURA = "18.240.380/0001-38"

def coletar() -> dict:
    print("⇣ Iniciando monitoramento de recursos federais para Varginha...")
    
    # Links diretos para auditoria cidadã (filtros prontos)
    links_auditoria = [
        {
            "titulo": "Transferências para Varginha (Geral 2026)",
            "url": f"https://portaldatransparencia.gov.br/localidades/{CODIGO_IBGE}-varginha?ano=2026",
            "desc": "Resumo de todos os recursos federais que entraram no município em 2026."
        },
        {
            "titulo": "Convênios Federais em Varginha",
            "url": f"https://portaldatransparencia.gov.br/convenios/consulta?paginacaoSimples=true&tamanhopagina=50&nomeMunicipio=Varginha",
            "desc": "Acordos específicos para obras e projetos (asfalto, prédios, equipamentos)."
        },
        {
            "titulo": "Emendas Parlamentares Federais para Varginha",
            "url": f"https://portaldatransparencia.gov.br/emendas/consulta?paginacaoSimples=true&tamanhopagina=50&nomeMunicipio=Varginha",
            "desc": "Verbas enviadas por Deputados Federais e Senadores para a cidade."
        },
        {
            "titulo": "Programas Sociais (Bolsa Família, etc)",
            "url": f"https://portaldatransparencia.gov.br/beneficios/consulta?paginacaoSimples=true&tamanhopagina=50&nomeMunicipio=Varginha",
            "desc": "Pagamentos diretos aos cidadãos de Varginha via programas federais."
        }
    ]

    # Como o acesso via API exige chave pessoal (API-Key), 
    # fornecemos a estrutura para o cidadão fiscalizar diretamente na fonte.
    # Em uma versão futura, se o usuário fornecer a chave, a coleta se torna automática.
    
    resumo = {
        "status": "Monitoramento Ativo",
        "municipio": "Varginha-MG",
        "codigo_ibge": CODIGO_IBGE,
        "cnpj_alvo": CNPJ_PREFEITURA,
        "fontes_mapeadas": len(links_auditoria),
        "conclusao": "O rastreio federal está configurado. O cidadão pode auditar os links oficiais que já possuem os filtros de Varginha aplicados."
    }

    payload = {
        "fonte": "Portal da Transparência Federal / Dados.gov.br",
        "atualizado_em": dt.datetime.now().isoformat(),
        "resumo": resumo,
        "links_auditoria": links_auditoria,
        "pistas_investigacao": [
            "Verificar se o valor 'Conveniado' de grandes obras bate com o que a Prefeitura anuncia.",
            "Acompanhar se as emendas federais de saúde estão sendo aplicadas no Hospital Regional ou em custeio.",
            "Fiscalizar convênios com 'vencimento próximo' para evitar perda de recurso federal."
        ]
    }

    return payload

def salvar(payload: dict | None = None) -> dict:
    payload = payload or coletar()
    out = DATA / "federal.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  ✓ federal.json salvo.")
    return payload

if __name__ == "__main__":
    salvar()
