import type { Entidade } from "@/data/entidades";

interface Props {
  entidade: Entidade;
}

export function OndeVaiDinheiro({ entidade }: Props) {
  const areas = [...entidade.areasGasto].sort(
    (a, b) => b.percentual - a.percentual,
  );

  return (
    <section
      id="onde-vai-dinheiro"
      aria-labelledby="ovd-title"
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
          id="ovd-title"
          style={{ fontSize: 22, fontWeight: 800, margin: 0 }}
        >
          Para onde vai o dinheiro
        </h3>
        <p
          style={{
            color: "var(--color-text-muted)",
            fontSize: 14,
            marginTop: 4,
          }}
        >
          Distribuição estimada do orçamento por área. Passe o mouse sobre cada
          barra para entender o que está incluído.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {areas.map((area) => (
          <div key={area.area}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 14,
                  color: "var(--color-text)",
                }}
              >
                {area.area}
              </span>
              <span
                style={{
                  fontWeight: 800,
                  fontSize: 14,
                  color: area.cor,
                }}
              >
                {area.percentual}%
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={area.percentual}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${area.area}: ${area.percentual}%`}
              title={area.descricao}
              style={{
                width: "100%",
                height: 14,
                background: "var(--color-surface-alt)",
                borderRadius: 999,
                overflow: "hidden",
                border: "1px solid var(--color-border)",
              }}
            >
              <div
                style={{
                  width: `${area.percentual}%`,
                  height: "100%",
                  background: area.cor,
                  borderRadius: 999,
                  transition: "width 0.4s ease",
                }}
              />
            </div>
            <p
              style={{
                fontSize: 13,
                color: "var(--color-text-muted)",
                marginTop: 6,
                lineHeight: 1.4,
              }}
            >
              {area.descricao}
            </p>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 18,
          padding: 12,
          background: "var(--color-primary-light)",
          borderRadius: "var(--radius-md)",
          fontSize: 13,
          color: "var(--color-text)",
          borderLeft: "4px solid var(--color-primary)",
        }}
      >
        <strong>📊 Dado oficial:</strong> os percentuais reais estão no Portal
        da Transparência da {entidade.nome}. Esta página apresenta estimativas
        baseadas em médias de municípios similares — use-as como ponto de
        partida e confirme nos dados oficiais.
      </div>
    </section>
  );
}
