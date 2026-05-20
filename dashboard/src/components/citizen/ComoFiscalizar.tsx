import type { Entidade } from "@/data/entidades";

interface Props {
  entidade: Entidade;
}

const PASSOS = [
  {
    n: 1,
    titulo: "Abra o Portal da Transparência",
    descricao:
      "Lá estão TODAS as despesas: salários, contratos, diárias, obras. Por lei, qualquer cidadão pode consultar.",
    acao: "Acessar portal",
  },
  {
    n: 2,
    titulo: "Olhe as despesas do mês",
    descricao:
      "Filtre por data e por área (Saúde, Educação, Obras). Veja onde o dinheiro está sendo gasto agora.",
    acao: "Ver despesas",
  },
  {
    n: 3,
    titulo: "Confira contratos e licitações",
    descricao:
      "Cada contrato deve mostrar: empresa contratada, valor, prazo e objeto. Compare com o que está sendo entregue na rua.",
    acao: "Ver contratos",
  },
  {
    n: 4,
    titulo: "Compare salários e diárias",
    descricao:
      "Cargos comissionados, viagens, horas extras. Tudo deve estar público. Diárias frequentes são um alerta.",
    acao: "Ver folha",
  },
  {
    n: 5,
    titulo: "Use o e-SIC para o que faltar",
    descricao:
      "Não achou alguma informação? Faça um pedido pelo e-SIC (Lei de Acesso à Informação). Devem responder em até 20 dias.",
    acao: "Abrir e-SIC",
  },
  {
    n: 6,
    titulo: "Denuncie irregularidades",
    descricao:
      "Encontrou algo errado? Encaminhe ao MP-MG, TCE-MG ou Câmara (se for a Prefeitura). Sua denúncia pode ser anônima.",
    acao: "Ver canais",
  },
];

export function ComoFiscalizar({ entidade }: Props) {
  return (
    <section
      id="como-fiscalizar"
      aria-labelledby="cf-title"
      style={{
        background: "var(--color-surface)",
        borderRadius: "var(--radius-lg)",
        padding: 24,
        marginTop: 16,
        boxShadow: "var(--shadow-sm)",
        border: "1px solid var(--color-border)",
      }}
    >
      <div style={{ marginBottom: 18 }}>
        <h3
          id="cf-title"
          style={{ fontSize: 22, fontWeight: 800, margin: 0 }}
        >
          Como fiscalizar em 6 passos
        </h3>
        <p
          style={{
            color: "var(--color-text-muted)",
            fontSize: 14,
            marginTop: 4,
          }}
        >
          Você não precisa ser advogado nem contador. Siga estes passos para
          acompanhar o dinheiro da {entidade.nome} de Varginha.
        </p>
      </div>

      <ol
        style={{
          listStyle: "none",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 14,
        }}
      >
        {PASSOS.map((passo) => (
          <li
            key={passo.n}
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              padding: 16,
              background: "var(--color-surface-alt)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: entidade.cor,
                  color: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 800,
                  flexShrink: 0,
                }}
              >
                {passo.n}
              </span>
              <h4 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
                {passo.titulo}
              </h4>
            </div>
            <p
              style={{
                fontSize: 13.5,
                color: "var(--color-text-muted)",
                lineHeight: 1.5,
              }}
            >
              {passo.descricao}
            </p>
          </li>
        ))}
      </ol>

      <div
        style={{
          marginTop: 18,
          padding: 14,
          background: "#fff8e1",
          border: "1px solid #ffe082",
          borderRadius: "var(--radius-md)",
          fontSize: 14,
          lineHeight: 1.55,
        }}
      >
        <strong>⚠️ Importante:</strong> a Lei de Acesso à Informação (Lei
        12.527/2011) garante o seu direito de pedir qualquer documento público.
        Não precisa justificar o motivo do pedido. Se houver recusa indevida,
        recorra ao Ministério Público.
      </div>
    </section>
  );
}
