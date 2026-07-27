# Leis orçamentárias de Varginha - exercícios 2024 a 2026

Acervo local das leis e dos anexos orçamentários oficiais do Município de
Varginha-MG, baixado em 2026-07-25.

## Escopo

| Exercício | LDO | LOA | PPA aplicável |
|---|---|---|---|
| 2024 | Lei 7.124/2023 | Lei 7.219/2023 | Lei 6.888/2021 - PPA 2022-2025 |
| 2025 | Lei 7.282/2024 | Lei 7.330/2024 | Lei 6.888/2021 - PPA 2022-2025 |
| 2026 | Lei 7.417/2025 | Lei 7.510/2025 | Lei 7.473/2025 - PPA 2026-2029 |

O PPA não é anual. Por isso, os três exercícios são cobertos por dois planos:
o PPA 2022-2025 e o PPA 2026-2029.

## Organização

- `exercicio-2024/`: LDO 2024 e LOA 2024, com textos integrais e anexos.
- `exercicio-2025/`: LDO 2025 e LOA 2025, com textos integrais e anexos.
- `exercicio-2026/`: LDO 2026 e LOA 2026, com textos integrais e anexos.
- `PPA/`: PPA 2022-2025 e PPA 2026-2029, com textos integrais e anexos
  disponíveis.
- O diretório do PPA 2026-2029 também contém o Projeto de Lei nº 45/2025
  original, com 141 páginas, e o relatório `LEITURA-INTEGRAL-PROJETO-LEI-45-2025.md`.
- `pagina-oficial.html`: cópia da página oficial consultada em cada pasta.
- `arquivos-baixados.csv`: inventário dos arquivos e de suas URLs de origem.

## Fontes oficiais

### Prefeitura de Varginha

- LDO 2024: https://www.varginha.mg.gov.br/portal/leis_decretos/36151/
- LOA 2024: https://www.varginha.mg.gov.br/portal/leis_decretos/39151/
- LDO 2025: https://www.varginha.mg.gov.br/portal/leis_decretos/39921/
- LOA 2025: https://www.varginha.mg.gov.br/portal/leis_decretos/43407/
- LDO 2026: https://www.varginha.mg.gov.br/portal/leis_decretos/43314/
- LOA 2026: https://www.varginha.mg.gov.br/portal/leis_decretos/43940/
- PPA 2022-2025: https://www.varginha.mg.gov.br/portal/leis_decretos/33855/
- PPA 2026-2029: https://www.varginha.mg.gov.br/portal/leis_decretos/43682/
- Projeto de Lei nº 45/2025 (PPA 2026-2029, 141 páginas):
  https://sapl.varginha.mg.leg.br/media/sapl/public/materialegislativa/2025/4514/projetodelei45-2025.pdf

### SAPL da Câmara Municipal

O SAPL foi usado para os textos integrais quando a página da Prefeitura
publicava somente os anexos ou não oferecia PDF separado da lei.

- Portal: https://sapl.varginha.mg.leg.br/

## Verificação

- 74 arquivos PDF.
- 1.272 páginas.
- 214,29 MB.
- Todos os PDFs foram abertos com `pypdf`, possuem assinatura `%PDF-` e pelo
  menos uma página.
- A primeira página dos oito instrumentos principais foi renderizada e
  conferida visualmente.
- As 141 páginas do Projeto de Lei nº 45/2025 foram processadas por OCR em
  português, tiveram a orientação conferida visualmente e os totais foram
  reconciliados com os anexos oficiais da lei sancionada.

Observação: no cadastro da Prefeitura, o PPA 2026-2029 aparece no cabeçalho
como publicado em 05/11/2025, enquanto o texto da Lei 7.473 registra
20/10/2025. Este acervo usa a data constante no próprio texto legal e no SAPL.
