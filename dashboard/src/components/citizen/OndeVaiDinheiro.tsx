import type { Entidade } from "@/data/entidades";
import { rateioFuncoesReais, periodoReal } from "@/data/loaderDadosReais";

interface Props {
  entidade: Entidade;
}

interface Fatia {
  area: string;
  percentual: number;
  descricao: string;
  cor: string;
  valorFormatado?: string;
}

export function OndeVaiDinheiro({ entidade }: Props) {
  const real = rateioFuncoesReais(entidade.id);
  const usandoReal = real !== null;
  const periodo = usandoReal ? periodoReal(entidade.id) : null;

  const fatias: Fatia[] = usandoReal
    ? real
    : [...entidade.areasGasto].sort((a, b) => b.percentual - a.percentual);

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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <h3 id="ovd-title" style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>
            Para onde vai o dinheiro
          </h3>
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: 1,
              padding: "3px 8px",
              borderRadius: 999,
              background: usandoReal
                ? "var(--color-success)"
                : "var(--color-warning)",
              color: "#ffffff",
            }}
          >
            {usandoReal ? "✓ Dado real" : "≈ Estimativa"}
          </span>
        </div>
        <p
          style={{
            color: "var(--color-text-muted)",
            fontSize: 14,
            marginTop: 4,
          }}
        >
          {usandoReal ? (
            <>
              Distribuição <strong>real</strong> das despesas pagas por função
              orçamentária{periodo ? ` (${periodo})` : ""}, extraída do Portal da
              Transparência. Passe o mouse sobre cada barra para detalhes.
            </>
          ) : (
            <>
              Distribuição estimada do orçamento por área. Passe o mouse sobre
              cada barra para entender o que está incluído.
            </>
          )}
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {fatias.map((area) => (
          <div key={area.area}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 6,
                gap: 10,
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
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  flexShrink: 0,
                }}
              >
                {area.valorFormatado && (
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--color-text-muted)",
                    }}
                  >
                    {area.valorFormatado}
                  </span>
                )}
                <span style={{ fontWeight: 800, fontSize: 14, color: area.cor }}>
                  {area.percentual}%
                </span>
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
        {usandoReal ? (
          <>
            <strong>📊 Por função, não por área administrativa:</strong> aqui o
            salário de cada setor já está somado à sua função (ex.: salário de
            médico entra em Saúde). É o valor efetivamente <em>pago</em> no
            período, conferível no Portal da Transparência da {entidade.nome}.
          </>
        ) : (
          <>
            <strong>📊 Dado oficial:</strong> os percentuais reais estão no
            Portal da Transparência da {entidade.nome}. Esta página apresenta
            estimativas baseadas em médias de municípios similares — use-as como
            ponto de partida e confirme nos dados oficiais.
          </>
        )}
      </div>
    </section>
  );
}
