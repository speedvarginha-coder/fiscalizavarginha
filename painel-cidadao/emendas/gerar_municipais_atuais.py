# -*- coding: utf-8 -*-
"""Gera a base municipal única exibida no portal de emendas.

Escopo publicado:
* histórico da 19ª legislatura: publicidade oficial Betha, até 2024;
* 20ª legislatura em diante: coleta estruturada do SAPL/Câmara.

A fonte Betha continua preservada em ``data/emendas.js``. Ela não é carregada
diretamente pela interface para evitar dupla contagem com o SAPL. A união usa
o número e o ano da emenda como chave, com preferência para o SAPL no período
atual.
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHUNK = HERE.parent / "data" / "chunks" / "emendas.json"
BASE_LEGADA = HERE / "data" / "emendas.js"
SAIDA = HERE / "data" / "emendas_municipais_unificadas.js"
ANO_INICIO_SAPL = 2025

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def normalize(value: object) -> str:
    texto = unicodedata.normalize("NFD", str(value or ""))
    return "".join(char for char in texto if not unicodedata.combining(char)).lower().strip()


def valor_texto(valor: float) -> str:
    return f"{valor:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def centavos(value: object) -> int:
    try:
        return int((Decimal(str(value or 0)) * 100).quantize(Decimal("1"), ROUND_HALF_UP))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"valor inválido: {value!r}") from exc


def somente_digitos(value: object) -> str:
    return re.sub(r"\D", "", str(value or ""))


def cnpj_valido(value: object) -> bool:
    digits = somente_digitos(value)
    if len(digits) != 14 or digits == digits[0] * 14:
        return False
    for tamanho in (12, 13):
        trecho = digits[:tamanho]
        pesos = list(range(tamanho - 7, 1, -1)) + list(range(9, 1, -1))
        resto = sum(int(numero) * peso for numero, peso in zip(trecho, pesos)) % 11
        digito = 0 if resto < 2 else 11 - resto
        if int(digits[tamanho]) != digito:
            return False
    return True


def ler_js(caminho: Path) -> dict:
    texto = caminho.read_text(encoding="utf-8")
    inicio = texto.find("{")
    if inicio < 0:
        raise ValueError(f"JSON não encontrado em {caminho}")
    valor, _ = json.JSONDecoder().raw_decode(texto[inicio:])
    return valor


def ano_da_emenda(registro: dict) -> int | None:
    valor = str(registro.get("anoEmenda") or registro.get("ano") or "").strip()
    match = re.search(r"\b(20\d{2})\b", valor)
    return int(match.group(1)) if match else None


def chave_emenda(registro: dict) -> tuple[str, str]:
    texto = str(registro.get("emendaOriginal") or registro.get("emenda") or "")
    match = re.search(r"(\d{1,4})\s*/\s*(20\d{2})", texto)
    if match:
        return match.group(1).zfill(3), match.group(2)
    ano = ano_da_emenda(registro)
    numero = str(registro.get("numero") or texto).strip()
    return normalize(numero), str(ano or "")


def status_cnpj(valor: object) -> str:
    if not somente_digitos(valor):
        return "ausente"
    return "valido" if cnpj_valido(valor) else "invalido"


def transformar_historico(registro: dict) -> dict:
    """Conserva a evidência Betha, sem tratá-la como pagamento."""
    item = dict(registro)
    ano = ano_da_emenda(registro)
    valor = centavos(registro.get("valor")) / 100
    cnpj_status = status_cnpj(registro.get("documentoBeneficiario") or registro.get("cnpj"))
    pdf = str(registro.get("arquivoUrl") or registro.get("arquivo") or "").strip()
    numero, ano_chave = chave_emenda(registro)
    emenda_canonica = f"{numero}/{ano_chave}" if numero.isdigit() and ano_chave else str(registro.get("emenda") or "")
    item.update({
        "id": f"MUN-HIST-{registro.get('id') or '-'.join(chave_emenda(registro))}",
        "tipo": "Municipal",
        "ano": str(ano),
        "anoEmenda": str(ano),
        "anosRelacionados": [str(ano)],
        "emenda": emenda_canonica,
        "emendaOriginal": str(registro.get("emendaOriginal") or registro.get("emenda") or emenda_canonica),
        "valor": valor,
        "valorIndicado": valor,
        "valorTexto": valor_texto(valor),
        "estagio": "indicação/proposta histórica",
        "statusFinanceiro": "Valor histórico publicado; não comprova pagamento ou recebimento.",
        "classificacaoComprovacao": "Inferido",
        "origemMunicipal": "historico_betha",
        "cnpjStatus": cnpj_status,
        "pdfStatus": "disponivel" if pdf else "ausente",
        "proveniencia": {
            "fonte": "Publicidade de emendas da Prefeitura (Betha)",
            "camada": "histórico municipal",
            "criterio": "registro publicado na fonte oficial; estágio financeiro não inferido",
        },
    })
    item["textoBusca"] = normalize(" ".join(str(valor or "") for valor in (
        item.get("emenda"), item.get("autor"), item.get("beneficiario"),
        item.get("documentoBeneficiario"), item.get("objeto"), item.get("anoEmenda"), "municipal histórico Betha",
    )))
    return item


def transformar_sapl(registro: dict) -> dict:
    ano = str(registro.get("ano") or "").strip()
    numero = str(registro.get("numero") or "").strip()
    if not ano or not numero:
        raise ValueError("registro SAPL sem número ou ano")
    valor = centavos(registro.get("valor_brl")) / 100
    autor = str(registro.get("autor") or "").strip()
    beneficiario = str(registro.get("beneficiario") or "").strip()
    cnpj = str(registro.get("cnpj") or "").strip()
    objeto = str(registro.get("objeto") or "").strip()
    pdf = str(registro.get("pdf") or "").strip()
    autores = [nome.strip() for nome in autor.split(",") if nome.strip()]
    cnpj_status = status_cnpj(cnpj)
    confianca = "alta" if cnpj_status == "valido" and pdf and all((autor, beneficiario, objeto, valor)) else "media"
    emenda = f"{numero.zfill(3)}/{ano}"
    item = {
        "id": f"MUN-SAPL-{ano}-{numero.zfill(3)}",
        "tipo": "Municipal",
        "ano": ano,
        "anoEmenda": ano,
        "anosRelacionados": [ano],
        "emenda": emenda,
        "emendaOriginal": emenda,
        "autor": autor,
        "partido": "",
        "valor": valor,
        "valorIndicado": valor,
        "valorTexto": valor_texto(valor),
        "beneficiario": beneficiario,
        "documentoBeneficiario": cnpj,
        "orgao": beneficiario,
        "objeto": objeto,
        "descricao": objeto,
        "estagio": "indicação/proposta",
        "statusFinanceiro": "Indicação/proposta da Câmara; não comprova pagamento ou recebimento.",
        "classificacaoComprovacao": "Inferido",
        "aprovado": "",
        "autoria": {"tipo": "individual" if len(autores) == 1 else "coautoria", "autores": autores},
        "emendaIndividual": "Sim" if len(autores) == 1 else "Não",
        "cnpjStatus": cnpj_status,
        "pdfStatus": "disponivel" if pdf else "ausente",
        "confianca": confianca,
        "origemMunicipal": "sapl_camara",
        "proveniencia": {
            "fonte": "SAPL/Câmara Municipal de Varginha",
            "chunk": "data/chunks/emendas.json",
            "pdf": pdf or None,
            "campos": "ementa e metadados da matéria legislativa",
        },
        "fontes": ["Câmara Municipal de Varginha (SAPL)"],
        "arquivo": pdf.rsplit("/", 1)[-1] if pdf else "",
        "arquivoUrl": pdf,
    }
    item["textoBusca"] = normalize(" ".join(str(valor or "") for valor in (
        emenda, autor, beneficiario, cnpj, objeto, ano, "municipal SAPL Câmara",
    )))
    return item


def main() -> int:
    if not CHUNK.exists() or not BASE_LEGADA.exists():
        print("ERRO: fonte municipal ausente; saída preservada")
        return 1

    chunk = json.loads(CHUNK.read_text(encoding="utf-8"))
    sapl_bruto = chunk.get("emendas") if isinstance(chunk, dict) else chunk
    legado = ler_js(BASE_LEGADA).get("emendas", [])
    if not isinstance(sapl_bruto, list) or not sapl_bruto:
        print("ERRO: coleta SAPL vazia ou em formato inesperado; saída preservada")
        return 1

    sapl = [transformar_sapl(registro) for registro in sapl_bruto]
    chaves_sapl = [chave_emenda(registro) for registro in sapl]
    if len(chaves_sapl) != len(set(chaves_sapl)):
        print("ERRO: há duplicatas por número/ano na coleta SAPL; saída preservada")
        return 1

    legado_municipal = [registro for registro in legado if registro.get("tipo") == "Municipal"]
    historico_bruto = [registro for registro in legado_municipal if (ano_da_emenda(registro) or 0) < ANO_INICIO_SAPL]
    legados_atuais = [registro for registro in legado_municipal if (ano_da_emenda(registro) or 0) >= ANO_INICIO_SAPL]
    chaves_historico = [chave_emenda(registro) for registro in historico_bruto]
    if len(chaves_historico) != len(set(chaves_historico)):
        print("ERRO: há duplicatas por número/ano no histórico Betha; saída preservada")
        return 1

    duplicatas_legado_sapl = sum(chave_emenda(registro) in set(chaves_sapl) for registro in legados_atuais)
    historico = [transformar_historico(registro) for registro in historico_bruto]
    emendas = historico + sapl
    chaves_publicadas = [chave_emenda(registro) for registro in emendas]
    if len(chaves_publicadas) != len(set(chaves_publicadas)):
        print("ERRO: união municipal contém duplicatas por número/ano; saída preservada")
        return 1

    payload = {
        "metadata": {
            "geradoEm": datetime.now(timezone.utc).isoformat(),
            "fonte": "Histórico Betha (até 2024) + SAPL/Câmara (2025 em diante)",
            "criterioDeduplicacao": "número/ano da emenda; SAPL é canônico a partir de 2025",
            "totalRegistros": len(emendas),
            "registrosHistoricosBetha": len(historico),
            "registrosSapl": len(sapl),
            "registrosLegadoForaDoEscopo": len(legados_atuais),
            "duplicatasLegadoSapl": duplicatas_legado_sapl,
            "valorIndicadoTotal": round(sum(registro["valorIndicado"] for registro in emendas), 2),
            "qualidade": {
                "cnpjValido": sum(registro.get("cnpjStatus") == "valido" for registro in sapl),
                "cnpjInvalido": sum(registro.get("cnpjStatus") == "invalido" for registro in sapl),
                "cnpjAusente": sum(registro.get("cnpjStatus") == "ausente" for registro in sapl),
                "pdfAusente": sum(registro.get("pdfStatus") == "ausente" for registro in sapl),
            },
        },
        "emendas": emendas,
    }
    SAIDA.write_text(
        "window.EMENDAS_MUNICIPAIS_UNIFICADAS = " + json.dumps(payload, ensure_ascii=False, indent=1) + ";\n",
        encoding="utf-8",
    )
    print(f"OK: {len(historico)} históricas + {len(sapl)} SAPL = {len(emendas)} municipais")
    print(f"Deduplicação: {duplicatas_legado_sapl} legadas de 2025 já cobertas pelo SAPL")
    print(f"Valor indicado: R$ {valor_texto(payload['metadata']['valorIndicadoTotal'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
