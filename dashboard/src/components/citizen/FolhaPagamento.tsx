import type { Entidade } from "@/data/entidades";

interface Props {
  entidade: Entidade;
}

export function FolhaPagamento({ entidade }: Props) {
  const links = entidade.linksFolha ?? [];
  if (links.length === 0) return null;

  return (
    <section
      id="folha"
      aria-labelledby="folha-title"
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
          id="folha-title"
          style={{ fontSize: 22, fontWeight: 800, margin: 0 }}
        >
          Salários, folha e diárias
        </h3>
        <p
          style={{
            color: "var(--color-text-muted)",
            fontSize: 14,
            marginTop: 4,
            maxWidth: 580,
          }}
        >
          Por lei, todo salário e diária pagos com dinheiro público são
          informações abertas. Consulte abaixo, mês a mês, da {entidade.nome}.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 12,
        }}
      >
        {links.map((link) => (
          <a
            key={link.titulo}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              padding: 16,
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              background: "var(--color-surface-alt)",
              textDecoration: "none",
              color: "var(--color-text)",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = entidade.cor;
              e.currentTarget.style.boxShadow = "var(--shadow-md)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--color-border)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span style={{ fontSize: 22 }} aria-hidden="true">
                💰
              </span>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 15,
                }}
              >
                {link.titulo}
              </span>
            </div>
            <p
              style={{
                fontSize: 13,
                color: "var(--color-text-muted)",
                lineHeight: 1.5,
              }}
            >
              {link.descricao}
            </p>
            <span
              style={{
                marginTop: "auto",
                fontSize: 13,
                fontWeight: 700,
                color: entidade.cor,
              }}
            >
              Consultar →
            </span>
          </a>
        ))}
      </div>

      <div
        style={{
          marginTop: 16,
          padding: 14,
          background: "#fff8e1",
          border: "1px solid #ffe082",
          borderRadius: "var(--radius-md)",
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        <strong>⚠️ Sinais de alerta:</strong> cargos comissionados em excesso,
        diárias frequentes para o mesmo destino, horas extras altíssimas,
        salários muito acima do teto constitucional. Tudo isso pode (e deve)
        ser denunciado ao TCE-MG.
      </div>
    </section>
  );
}
