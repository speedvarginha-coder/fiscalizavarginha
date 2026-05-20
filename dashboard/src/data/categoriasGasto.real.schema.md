# Schema — categoriasGasto.real.json

Arquivo gerado pelo scraper (`dashboard/scripts/scrape-betha.mjs`) ou
preenchido manualmente após consulta ao Portal da Transparência.

## Estrutura

```json
{
  "atualizadoEm": "2026-05-15T14:30:00Z",
  "fontePadrao": "Portal da Transparência — Betha Sistemas",
  "dados": {
    "prefeitura": {
      "<categoria_id>": {
        "valorTotalAno": 3214500.00,
        "valorFormatado": "R$ 3.214.500,00",
        "ano": 2026,
        "periodo": "Jan–Mai 2026",
        "qtdEmpenhos": 142,
        "fonteUrl": "https://transparencia.betha.cloud/#/...",
        "atualizadoEm": "2026-05-15"
      }
    },
    "camara": { }
  }
}
```

## Regras

1. **`<categoria_id>`** deve bater EXATAMENTE com o `id` em `categoriasGasto.ts`
   (ex: `combustivel`, `lanches`, `medicamentos`).
2. **`valorFormatado`** é o que aparece na UI. Use vírgula decimal e pontos
   de milhar (padrão BR).
3. **`fonteUrl`** deve ser link DIRETO para a consulta no portal (não o portal
   genérico) — permite ao cidadão clicar e ver os mesmos números.
4. **`atualizadoEm`** em ISO-8601. Mostrado como "Atualizado em DD/MM/AAAA"
   na interface.
5. Se um dado não está disponível ou é incerto, **NÃO inclua**. Melhor mostrar
   estimativa marcada como "≈" do que valor falso marcado como "real".

## Critério para virar "dado real"

Apenas valores que atendam aos três:

- Foram extraídos diretamente do Portal da Transparência oficial
- Vêm com URL fonte que o cidadão pode auditar manualmente
- Têm data e período explícitos (não vale "aproximadamente último ano")

Sem isso, mantenha como estimativa em `categoriasGasto.ts`.
