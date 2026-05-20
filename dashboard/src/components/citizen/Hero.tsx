import type { Entidade } from "@/data/entidades";

interface HeroProps {
  entidade: Entidade;
}

export function Hero({ entidade }: HeroProps) {
  return (
    <section
      aria-labelledby="hero-title"
      style={{
        background: "var(--color-surface)",
        borderRadius: "var(--radius-lg)",
        padding: 24,
        marginTop: 20,
        boxShadow: "var(--shadow-sm)",
        border: "1px solid var(--color-border)",
        borderLeft: `6px solid ${entidade.cor}`,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 24,
          alignItems: "flex-start",
          justifyContent: "space-between",
        }}
      >
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <span
            style={{
              display: "inline-block",
              fontSize: 12,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 1.2,
              color: entidade.cor,
              background: entidade.corLight,
              padding: "4px 10px",
              borderRadius: 999,
            }}
          >
            Poder {entidade.poder}
          </span>
          <h2
            id="hero-title"
            style={{
              fontSize: 28,
              fontWeight: 800,
              margin: "10px 0 8px",
              color: "var(--color-text)",
            }}
          >
            {entidade.nomeCompleto}
          </h2>
          <p
            style={{
              fontSize: 16,
              color: "var(--color-text-muted)",
              maxWidth: 640,
              lineHeight: 1.55,
            }}
          >
            {entidade.papel}
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(140px, 1fr))",
            gap: 12,
            flex: "0 1 320px",
          }}
        >
          <Stat label="Orçamento anual" value={entidade.orcamentoAnual} />
          <Stat label="Pessoal" value={entidade.servidoresAprox} />
          {entidade.chefe && (
            <div style={{ gridColumn: "1 / -1" }}>
              <Stat
                label={entidade.chefe.cargo}
                value={entidade.chefe.nome}
              />
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          marginTop: 20,
          flexWrap: "wrap",
        }}
      >
        <a
          href={entidade.portalTransparencia}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            background: entidade.cor,
            color: "#ffffff",
            padding: "12px 18px",
            borderRadius: "var(--radius-md)",
            fontWeight: 700,
            fontSize: 14,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            textDecoration: "none",
          }}
        >
          Abrir Portal da Transparência →
        </a>
        <a
          href={entidade.portalLicitacoes}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            background: "var(--color-surface-alt)",
            color: "var(--color-text)",
            padding: "12px 18px",
            borderRadius: "var(--radius-md)",
            fontWeight: 600,
            fontSize: 14,
            border: "1px solid var(--color-border)",
          }}
        >
          Ver licitações e contratos
        </a>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "var(--color-surface-alt)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 1,
          color: "var(--color-text-muted)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          marginTop: 4,
          color: "var(--color-text)",
        }}
      >
        {value}
      </div>
    </div>
  );
}
