import base64
import io
import json
import sys
import tempfile
import unittest
import urllib.error
import zipfile
from pathlib import Path
from unittest.mock import call, patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "painel-cidadao"))

import coletor  # noqa: E402
import coletor_betha  # noqa: E402


class ObrasDeduplicationTests(unittest.TestCase):
    def test_same_work_is_deduplicated_and_most_complete_record_wins(self):
        linked = {
            "endereco.csv": {
                "logradouro": "Avenida Otávio Marques de Paiva",
                "bairro": "Santa Luiza",
                "municipio": "VARGINHA",
            },
            "contrato.csv": {
                "numero": "16",
                "ano": "2024",
                "valor": "1768769.05",
                "nomeContratado": "PAVICAN LTDA",
            },
            "licitacao.csv": {"numeroLicitacao": "623", "modalidade": "Pregão eletrônico"},
        }
        base = {
            "dataInicio": "2024-01-05",
            "dataPrevistaConclusao": "2024-08-06",
            "dataUltimaMedicao": "2024-03-07",
            "descricaoObra": "Prestação dos serviços de infraestrutura em diversas vias públicas",
            "nomeFornecedor": "PAVICAN LTDA",
            "valorEfetivo": "1097017.44",
            "percentualExecutado": "62.02",
            "endereco": "endereco.csv",
            "contratos": "contrato.csv",
        }
        incompleta = {**base, "idObra": "85", "situacaoAtual": "em andamento"}
        completa = {
            **base,
            "idObra": "82",
            "situacaoAtual": "concluída",
            "dataEfetivaConclusao": "2024-09-24",
            "valorPrevisto": "1768769.05",
            "licitacoes": "licitacao.csv",
        }

        obras = coletor._normaliza_obras_publicas([incompleta, completa], linked)

        self.assertEqual(len(obras), 1)
        self.assertEqual(obras[0]["id_obra"], "82")
        self.assertEqual(obras[0]["situacao"], "concluída")

    def test_same_contract_with_different_objects_is_preserved(self):
        linked = {
            "endereco-a.csv": {"logradouro": "Rua A", "municipio": "VARGINHA"},
            "endereco-b.csv": {"logradouro": "Rua B", "municipio": "VARGINHA"},
            "contrato.csv": {
                "numero": "124",
                "ano": "2022",
                "valor": "200000",
                "nomeContratado": "EMPRESA TESTE",
            },
        }
        rows = [
            {
                "idObra": "17",
                "dataInicio": "2022-01-01",
                "descricaoObra": "Instalação de passarelas",
                "valorEfetivo": "123600",
                "endereco": "endereco-a.csv",
                "contratos": "contrato.csv",
            },
            {
                "idObra": "18",
                "dataInicio": "2022-01-01",
                "descricaoObra": "Cercamento do terminal",
                "valorEfetivo": "58740.40",
                "endereco": "endereco-b.csv",
                "contratos": "contrato.csv",
            },
        ]

        obras = coletor._normaliza_obras_publicas(rows, linked)

        self.assertEqual(len(obras), 2)


class BethaTextSearchNormalizationTests(unittest.TestCase):
    def test_prefeitura_daily_accepts_nested_creditor_and_infers_year(self):
        rows = [{
            "valorPagoEmpenho": 532.33,
            "credor": {"nomeCredor": "SERVIDOR EXEMPLO"},
            "numeroEmpenho": 1214,
            "dataEmpenho": "2026-01-30",
            "descricaoOrgao": "SECRETARIA MUNICIPAL DE SAUDE",
        }]

        result = coletor._normaliza_diarias_prefeitura(rows, {})

        self.assertEqual(result[0]["funcionario"], "SERVIDOR EXEMPLO")
        self.assertEqual(result[0]["ano"], "2026")
        self.assertEqual(result[0]["valor_total"], 532.33)
        self.assertEqual(result[0]["secretaria"], "SECRETARIA MUNICIPAL DE SAUDE")


class FakeResponse:
    def __init__(self, body, status=200, headers=None):
        self.body = body
        self.status = status
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.body if isinstance(self.body, bytes) else self.body.encode("utf-8")


def http_401():
    return urllib.error.HTTPError("https://betha.invalid", 401, "Unauthorized", None, None)


def csv_zip_base64() -> str:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("959_contratos.csv", "numero,ano\n1,2026\n")
    return base64.b64encode(output.getvalue()).decode("ascii")


class AtomicWriteTests(unittest.TestCase):
    def test_atomic_write_retries_transient_windows_file_lock(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            target = Path(tmp_dir) / "chunk.json"
            target.write_text('{"old": true}', encoding="utf-8")
            real_replace = coletor.os.replace
            attempts = 0

            def flaky_replace(source, destination):
                nonlocal attempts
                attempts += 1
                if attempts < 3:
                    error = PermissionError("arquivo ocupado")
                    error.winerror = 5
                    raise error
                return real_replace(source, destination)

            with patch.object(coletor.os, "replace", side_effect=flaky_replace), \
                    patch.object(coletor.time, "sleep") as sleep:
                coletor._write_json_atomic(target, {"new": True})

            self.assertEqual(json.loads(target.read_text(encoding="utf-8")), {"new": True})
            self.assertEqual(attempts, 3)
            self.assertEqual(sleep.call_count, 2)
            self.assertEqual(list(Path(tmp_dir).glob(".*.tmp*")), [])

    def test_rejected_quarantine_is_never_used_as_valid_preservation_source(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            data_dir = root / "painel-cidadao" / "data"
            valid = root / "private" / "backups" / "coleta-20260808-100000" / "data" / "chunks"
            rejected = root / "private" / "backups" / "rejeitada-20260808-110000" / "data" / "chunks"
            (data_dir / "chunks").mkdir(parents=True)
            valid.mkdir(parents=True)
            rejected.mkdir(parents=True)
            (valid / "prefeitura.json").write_text(
                json.dumps({"frota": [{"placa": "VALIDA"}]}), encoding="utf-8"
            )
            (rejected / "prefeitura.json").write_text(
                json.dumps({"frota": [{"placa": "REJEITADA"}]}), encoding="utf-8"
            )

            with patch.object(coletor, "DATA", data_dir):
                rows, source = coletor._load_last_nonempty_list("prefeitura.json", "frota")

            self.assertEqual(rows, [{"placa": "VALIDA"}])
            self.assertIn("coleta-20260808-100000", source)


class SaplCoverageTests(unittest.TestCase):
    def test_empty_amendment_result_preserves_last_valid_publication(self):
        previous = [
            {"ano": 2025, "numero": "1", "valor_brl": 100.0},
            {"ano": 2025, "numero": "2", "valor_brl": 250.5},
        ]
        collected = {
            "resumo": {"emendas_qtd": 0, "emendas_valor_total_brl": 0},
            "vereadores": [],
            "emendas": [],
            "camara_anos": {"2025": {"materias": [{}, {}]}},
        }

        with patch.object(coletor, "_load_existing", return_value=previous):
            result = coletor._preserva_emendas_sapl_se_coleta_vazia(collected)

        self.assertEqual(result["emendas"], previous)
        self.assertEqual(result["resumo"]["emendas_qtd"], 2)
        self.assertEqual(result["resumo"]["emendas_valor_total_brl"], 350.5)
        self.assertEqual(
            result["resumo"]["emendas_status_coleta"],
            "preservada_por_resposta_sapl_incompleta",
        )

    def test_legitimate_nonempty_result_is_not_replaced(self):
        current = [{"ano": 2025, "numero": "3", "valor_brl": 90.0}]
        collected = {"resumo": {}, "emendas": current}

        with patch.object(
            coletor,
            "_load_existing",
            return_value=[{"ano": 2025, "numero": "1", "valor_brl": 100.0}],
        ):
            result = coletor._preserva_emendas_sapl_se_coleta_vazia(collected)

        self.assertEqual(result["emendas"], current)


def sapl_page(results, next_url=None):
    return {"results": results, "pagination": {"links": {"next": next_url}}}


class SaplPaginationTruncationTests(unittest.TestCase):
    """Varredura que morre no meio nao pode voltar como se fosse completa.

    Em 20/08/2026 o SAPL oscilou, a paginacao parou na metade e o resumo saiu
    com 500 materias no lugar de 1584 — sem 'Emenda Impositiva'. O teste de
    integridade pegou e o ciclo inteiro foi revertido, de hora em hora.
    """

    def test_failure_after_first_page_raises_instead_of_returning_partial(self):
        pages = [sapl_page([{"id": 1}], "https://sapl.invalid/?page=2"), TimeoutError("timed out")]

        def fake_get(_url, timeout=20, attempts=4):
            item = pages.pop(0)
            if isinstance(item, Exception):
                raise item
            return item

        with patch.object(coletor, "_http_get_json", side_effect=fake_get):
            with self.assertRaises(coletor.SaplTruncado):
                coletor._sapl_paginate("https://sapl.invalid/?page=1", strict=True)

    def test_failure_on_first_page_returns_empty_so_caller_uses_fallback(self):
        with patch.object(coletor, "_http_get_json", side_effect=TimeoutError("timed out")):
            out = coletor._sapl_paginate("https://sapl.invalid/?page=1", strict=True)

        self.assertEqual(out, [])

    def test_non_strict_callers_keep_tolerant_behaviour(self):
        pages = [sapl_page([{"id": 1}], "https://sapl.invalid/?page=2"), TimeoutError("timed out")]

        def fake_get(_url, timeout=20, attempts=4):
            item = pages.pop(0)
            if isinstance(item, Exception):
                raise item
            return item

        with patch.object(coletor, "_http_get_json", side_effect=fake_get):
            out = coletor._sapl_paginate("https://sapl.invalid/?page=1")

        self.assertEqual(out, [{"id": 1}])

    def test_complete_crawl_returns_every_page(self):
        pages = [
            sapl_page([{"id": 1}], "https://sapl.invalid/?page=2"),
            sapl_page([{"id": 2}], None),
        ]

        with patch.object(coletor, "_http_get_json", side_effect=lambda *a, **k: pages.pop(0)):
            out = coletor._sapl_paginate("https://sapl.invalid/?page=1", strict=True)

        self.assertEqual(out, [{"id": 1}, {"id": 2}])


class HttpRetryTests(unittest.TestCase):
    def test_transient_timeout_is_retried_before_giving_up(self):
        responses = [TimeoutError("timed out"), FakeResponse(json.dumps({"ok": True}))]

        def fake_urlopen(_req, timeout=None):
            item = responses.pop(0)
            if isinstance(item, Exception):
                raise item
            return item

        with patch.object(coletor.urllib.request, "urlopen", side_effect=fake_urlopen), \
                patch.object(coletor.time, "sleep"):
            data = coletor._http_get_json("https://sapl.invalid/api", timeout=5)

        self.assertEqual(data, {"ok": True})
        self.assertEqual(responses, [])

    def test_attempts_one_keeps_fast_fail_for_per_item_loops(self):
        with patch.object(coletor.urllib.request, "urlopen", side_effect=TimeoutError("x")) as opened, \
                patch.object(coletor.time, "sleep"):
            with self.assertRaises(TimeoutError):
                coletor._http_get_json("https://sapl.invalid/api", timeout=3, attempts=1)

        self.assertEqual(opened.call_count, 1)


class FolhaPreservadaTests(unittest.TestCase):
    """Base de folha preservada nao pode reviver resumo fora do contrato.

    Quando a coleta da Betha vem parcial, o coletor troca o bloco da Prefeitura
    pelo anterior — inclusive o resumo salvo naquela epoca, que nunca passa por
    _resumo(). Era assim que 303.818 linhas de uma consulta ANUAL (sem
    competencia na linha) voltavam ao ar como R$ 914,9 mi de folha MENSAL, com
    competencia_referencia null e sem marcar competencia_indeterminada.
    """

    def _coleta_parcial(self, servidores_antigos):
        parcial = {
            "camara": {"servidores": [], "resumo": {}},
            "prefeitura": {"servidores": [{"nome": "UNICO"}], "resumo": {}},
        }
        anterior = {
            "prefeitura": {
                "servidores": servidores_antigos,
                # resumo fora do contrato, como o que estava publicado
                "resumo": {
                    "competencia_referencia": None,
                    "servidores_qtd": len(servidores_antigos),
                    "folha_bruta_total": 914884645.14,
                },
                "competencia": "13/2026",
            }
        }
        with patch.object(coletor, "_load_existing", return_value=anterior), \
                patch("coletor_pessoal.coletar", return_value=parcial):
            return coletor._processa_pessoal()

    def test_base_sem_competencia_marca_indeterminada_e_zera_campos_mensais(self):
        antigos = [{"nome": f"SERVIDOR {i}", "vencimentos": 1000.0} for i in range(1500)]

        resultado = self._coleta_parcial(antigos)
        resumo = resultado["prefeitura"]["resumo"]

        self.assertEqual(resultado["prefeitura"]["status_cobertura"], "preservada_por_cobertura")
        self.assertTrue(resumo["competencia_indeterminada"])
        self.assertIsNone(resumo["competencia_referencia"])
        for campo in (
            "servidores_qtd", "vinculos_qtd", "pessoas_qtd", "comissionados_qtd",
            "folha_bruta_total", "folha_bruta_comissionados",
            "maior_vencimento_comissionado",
        ):
            self.assertIsNone(resumo[campo], f"{campo} nao pode ter valor sem competencia")
        # linhas preservadas continuam contadas, e o orgao nao carimba mes algum
        self.assertEqual(resumo["linhas_todas_competencias"], len(antigos))
        self.assertIsNone(resultado["prefeitura"]["competencia"])
        self.assertIn("competencia", resultado["observacao"].lower())

    def test_base_com_competencia_mantem_numeros_do_mes(self):
        # 1500 linhas em 06/2026 e 1400 em 07/2026: a regra de 80% aceita as
        # duas e fica com a mais recente.
        antigos = (
            [{"nome": f"A{i}", "competencia": "06/2026", "vencimentos": 100.0} for i in range(1500)]
            + [{"nome": f"B{i}", "competencia": "07/2026", "vencimentos": 200.0} for i in range(1400)]
        )

        resultado = self._coleta_parcial(antigos)
        resumo = resultado["prefeitura"]["resumo"]

        self.assertFalse(resumo.get("competencia_indeterminada"))
        self.assertEqual(resumo["competencia_referencia"], "07/2026")
        self.assertEqual(resumo["servidores_qtd"], 1400)
        self.assertAlmostEqual(resumo["folha_bruta_total"], 1400 * 200.0, places=2)
        self.assertEqual(resumo["linhas_todas_competencias"], len(antigos))
        self.assertEqual(resultado["prefeitura"]["competencia"], "07/2026")


class SaplOfflineFallbackPathTests(unittest.TestCase):
    """Os fallbacks apontavam para C:/Users/Desktop/Desktop e ficaram orfaos
    quando o projeto mudou para D:. Fallback que nao existe nao salva ninguem."""

    def test_manual_export_paths_resolve_on_disk(self):
        self.assertTrue(coletor.CSV_SAPL.exists(), f"ausente: {coletor.CSV_SAPL}")
        self.assertTrue(coletor.JSON_SAPL_2026.exists(), f"ausente: {coletor.JSON_SAPL_2026}")


class BethaTokenRefreshTests(unittest.TestCase):
    def test_stale_caller_token_reuses_fresh_cached_token(self):
        response = FakeResponse(csv_zip_base64())
        with patch.object(
            coletor_betha,
            "_dados_abertos_sem_token",
            side_effect=http_401(),
        ), patch.object(
            coletor_betha.urllib.request,
            "urlopen",
            side_effect=[http_401(), response],
        ), patch.object(
            coletor_betha,
            "get_token",
            return_value="cached-fresh-token",
        ) as get_token:
            result = coletor_betha.baixar_dados_abertos(
                "stale-caller-token",
                coletor_betha.CONSULTA_CONTRATOS,
                ano="2026",
            )

        self.assertEqual(len(result["main"]), 1)
        get_token.assert_called_once_with(
            force=False,
            portal_hash=coletor_betha.PORTAL_HASH,
        )

    def test_rejected_cached_token_forces_one_browser_refresh(self):
        response = FakeResponse(csv_zip_base64())
        with patch.object(
            coletor_betha,
            "_dados_abertos_sem_token",
            side_effect=http_401(),
        ), patch.object(
            coletor_betha.urllib.request,
            "urlopen",
            side_effect=[http_401(), http_401(), response],
        ), patch.object(
            coletor_betha,
            "get_token",
            side_effect=["cached-token", "browser-token"],
        ) as get_token:
            result = coletor_betha.baixar_dados_abertos(
                "stale-caller-token",
                coletor_betha.CONSULTA_CONTRATOS,
                ano="2026",
            )

        self.assertEqual(len(result["main"]), 1)
        self.assertEqual(
            get_token.call_args_list,
            [
                call(force=False, portal_hash=coletor_betha.PORTAL_HASH),
                call(force=True, portal_hash=coletor_betha.PORTAL_HASH),
            ],
        )


class BethaExportFormatTests(unittest.TestCase):
    def test_direct_csv_is_accepted(self):
        payload, mode, name = coletor_betha._decode_export_payload(
            "numero,ano\n1,2026\n"
        )
        result = coletor_betha._parse_export(payload, 83043, name)

        self.assertEqual(mode, "csv-direto")
        self.assertEqual(result["main"][0]["numero"], "1")

    def test_signed_betha_url_can_return_csv(self):
        url = (
            "https://s3.sa-east-1.amazonaws.com/transparencia.betha.cloud/"
            "dados-abertos/83043_contratos.csv?X-Amz-Signature=teste"
        )
        response = FakeResponse(
            b"numero,ano\n2,2026\n",
            headers={"Content-Type": "text/csv"},
        )
        with patch.object(coletor_betha.urllib.request, "urlopen", return_value=response):
            payload, mode, name = coletor_betha._decode_export_payload(url)
        result = coletor_betha._parse_export(payload, 83043, name)

        self.assertEqual(mode, "url")
        self.assertEqual(name, "83043_contratos.csv")
        self.assertEqual(result["main"][0]["numero"], "2")

    def test_external_export_host_is_rejected(self):
        with self.assertRaises(coletor_betha.BethaExportError):
            coletor_betha._decode_export_payload("https://example.com/export.csv")

    def test_unavailable_export_falls_back_to_text_search(self):
        signed_url = (
            "https://s3.sa-east-1.amazonaws.com/transparencia.betha.cloud/"
            "dados-abertos/83043_contratos.csv?X-Amz-Signature=teste"
        )
        with patch.object(
            coletor_betha,
            "_dados_abertos_sem_token",
            return_value=signed_url,
        ), patch.object(
            coletor_betha,
            "_download_export_url",
            side_effect=coletor_betha.BethaExportError("HTTP 404"),
        ), patch.object(
            coletor_betha,
            "get_token",
            return_value="fresh-token",
        ), patch.object(
            coletor_betha,
            "baixar_busca_textual",
            return_value=[{"numero": "3", "ano": "2026"}],
        ):
            result = coletor_betha.baixar_dados_abertos(
                "token",
                coletor_betha.CONSULTA_CONTRATOS,
                ano="2026",
            )

        self.assertEqual(result["coleta_status"], "partial")
        self.assertEqual(result["coleta_modo"], "busca-textual-fallback")
        self.assertEqual(result["main"][0]["numero"], "3")


class FastWatchTests(unittest.TestCase):
    def test_fast_watch_preserves_existing_contracts_without_historical_queries(self):
        previous_contract = {
            "numero": "42",
            "ano": "2022",
            "cnpj": "123",
            "contratado": "Fornecedor",
            "valor": 100.0,
        }
        with patch.object(coletor_betha, "get_token", return_value="token"), \
                patch.object(coletor_betha, "todos_credores", return_value=[]), \
                patch.object(coletor_betha, "top_fornecedores", return_value=[]), \
                patch.object(coletor_betha, "total_pago", return_value=0), \
                patch.object(coletor_betha, "cruzar_emendas", return_value=[]), \
                patch.object(coletor, "_baixar_dados_abertos_safe", return_value=[]) as download, \
                patch.object(coletor, "_baixar_dados_abertos_full_safe", return_value=([], {}, {})), \
                patch.object(coletor, "_load_existing", return_value={"contratos": [previous_contract]}):
            result = coletor._processa_prefeitura([], vigia_rapida=True)

        self.assertEqual(result["contratos"], [previous_contract])
        labels = [args[2] for args, _kwargs in download.call_args_list]
        self.assertFalse(any("vigentes (" in label for label in labels))


class BethaEmptyContractsTests(unittest.TestCase):
    def test_camara_preserves_last_nonempty_contract_list(self):
        previous = [{"numero": "7", "ano": "2026", "valor": 500.0}]
        with patch.object(coletor_betha, "get_token", return_value="token"), \
                patch.object(coletor_betha, "todos_credores_generico", return_value=[]), \
                patch.object(coletor_betha, "baixar_dados_abertos", return_value={"main": []}), \
                patch.object(coletor, "_load_last_nonempty_list", return_value=(previous, "backup.json")):
            result = coletor._processa_camara_betha()

        self.assertEqual(result["contratos"], previous)
        self.assertEqual(
            result["contratos_status_coleta"],
            "preservada_por_resposta_betha_vazia",
        )

    def test_full_prefeitura_preserves_previous_when_contract_response_is_partial(self):
        previous = [
            {"numero": str(index), "ano": "2026", "valor": float(index)}
            for index in range(200)
        ]
        with patch.object(coletor_betha, "get_token", return_value="token"), \
                patch.object(coletor_betha, "todos_credores", return_value=[]), \
                patch.object(coletor_betha, "top_fornecedores", return_value=[]), \
                patch.object(coletor_betha, "total_pago", return_value=0), \
                patch.object(coletor_betha, "cruzar_emendas", return_value=[]), \
                patch.object(coletor, "_baixar_dados_abertos_safe", return_value=[]), \
                patch.object(coletor, "_baixar_dados_abertos_full_safe", return_value=([], {}, {})), \
                patch.object(coletor, "_load_last_nonempty_list", return_value=(previous, "backup.json")):
            result = coletor._processa_prefeitura([], vigia_rapida=False)

        self.assertEqual(result["contratos"], previous)
        self.assertEqual(
            result["contratos_status_coleta"],
            "preservada_por_resposta_betha_parcial",
        )

    def test_prefeitura_preserves_works_when_betha_returns_empty(self):
        previous_work = [{"id_obra": "82", "descricao": "Obra preservada"}]

        def previous_list(_name, field):
            if field == "obras_publicas":
                return previous_work, "backup.json"
            return [], None

        with patch.object(coletor_betha, "get_token", return_value="token"), \
                patch.object(coletor_betha, "todos_credores", return_value=[]), \
                patch.object(coletor_betha, "top_fornecedores", return_value=[]), \
                patch.object(coletor_betha, "total_pago", return_value=0), \
                patch.object(coletor_betha, "cruzar_emendas", return_value=[]), \
                patch.object(coletor, "_baixar_dados_abertos_safe", return_value=[]), \
                patch.object(coletor, "_baixar_dados_abertos_full_safe", return_value=([], {}, {})), \
                patch.object(coletor, "_load_last_nonempty_list", side_effect=previous_list):
            result = coletor._processa_prefeitura([], vigia_rapida=True)

        self.assertEqual(result["obras_publicas"], previous_work)
        self.assertEqual(
            result["obras_status_coleta"],
            "preservada_por_resposta_betha_vazia",
        )


if __name__ == "__main__":
    unittest.main()
