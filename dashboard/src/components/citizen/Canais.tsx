import type { Entidade, CanalOficial } from "@/data/entidades";

interface Props {
  entidade: Entidade;
}

const TIPO_INFO: Record<
  CanalOficial["tipo"],
  { icone: string; rotulo: string; cor: string }
> = {
  ouvidoria: { icone: "📣", rotulo: "Ouvidoria", cor: "#1c7ed6" },
  esic: { icone: "📄", rotulo: "Acesso à Informação", cor: "#7048e8" },
  consulta: { icone: "🔎", rotulo: "Consulta de dados", cor: "#2b8a3e" },
  denuncia: { icone: "🚨", rotulo: "Denúncia formal", cor: "#c92a2a" },
};

export function Canais({ entidade }: Props) {
  return (
    <section
      id="canais"
      aria-labelledby="canais-title"
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
          id="canais-title"
          style={{ fontSize: 22, fontWeight: 800, margin: 0 }}
        >
          Canais oficiais para agir
        </h3>
        <p
          style={{
            color: "var(--color-text-muted)",
            fontSize: 14,
            marginTop: 4,
          }}
        >
          Use estes canais para consultar dados, pedir informações ou denunciar
          irregularidades na {entidade.nome}. Todos são gratuitos.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 12,
        }}
      >
        {entidade.canais.map((canal) => {
          const info = TIPO_INFO[canal.tipo];
          return (
            <a
              key={canal.nome}
              href={canal.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "block",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)",
                padding: 16,
                background: "var(--color-surface)",
                textDecoration: "none",
                color: "var(--color-text)",
                transition: "all 0.15s ease",
                boxShadow: "var(--shadow-sm)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = "var(--shadow-md)";
                e.currentTarget.style.borderColor = info.cor;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = "var(--shadow-sm)";
                e.currentTarget.style.borderColor = "var(--color-border)";
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <span style={{ fontSize: 22 }} aria-hidden="true">
                  {info.icone}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    color: info.cor,
                    background: `${info.cor}15`,
                    padding: "3px 8px",
                    borderRadius: 999,
                  }}
                >
                  {info.rotulo}
                </span>
              </div>
              <h4 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
                {canal.nome}
              </h4>
              <p
                style={{
                  fontSize: 13,
                  color: "var(--color-text-muted)",
                  marginTop: 6,
                  lineHeight: 1.5,
                }}
              >
                {canal.descricao}
              </p>
              <div
                style={{
                  marginTop: 10,
                  fontSize: 13,
                  fontWeight: 700,
                  color: info.cor,
                }}
              >
                Acessar →
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}
