import type { Entidade, Vereador } from "@/data/entidades";

interface Props {
  entidade: Entidade;
}

// Cores básicas dos principais partidos (para o chip)
const CORES_PARTIDO: Record<string, string> = {
  AVANTE: "#00a99d",
  PSD: "#f57c00",
  UNIÃO: "#ffeb3b",
  PSDB: "#0288d1",
  SD: "#fdd835",
  PL: "#1565c0",
  DC: "#5d4037",
  MOBILIZA: "#43a047",
  PV: "#388e3c",
  PP: "#1976d2",
};

function corPartido(partido: string): string {
  return CORES_PARTIDO[partido] ?? "#6a7280";
}

function iniciais(nome: string): string {
  const partes = nome.split(" ").filter(Boolean);
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export function Vereadores({ entidade }: Props) {
  if (!entidade.vereadores || entidade.vereadores.length === 0) return null;

  // Mesa Diretora primeiro, demais em ordem alfabética
  const mesa = entidade.vereadores.filter((v) => v.cargoMesa);
  const demais = entidade.vereadores
    .filter((v) => !v.cargoMesa)
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const ordenados = [...mesa, ...demais];

  return (
    <section
      id="vereadores"
      aria-labelledby="ver-title"
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
        <h3 id="ver-title" style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>
          Os 15 vereadores
        </h3>
        <p
          style={{
            color: "var(--color-text-muted)",
            fontSize: 14,
            marginTop: 4,
          }}
        >
          Eleitos pelo povo de Varginha para legislar e fiscalizar a Prefeitura.
          Mesa Diretora 2025-2026 destacada no início.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        {ordenados.map((v) => (
          <VereadorCard key={v.nome} vereador={v} cor={entidade.cor} />
        ))}
      </div>

      <div
        style={{
          marginTop: 18,
          padding: 14,
          background: "var(--color-camara-light)",
          borderRadius: "var(--radius-md)",
          fontSize: 13,
          lineHeight: 1.55,
          borderLeft: "4px solid var(--color-camara)",
        }}
      >
        <strong>💡 Você sabia?</strong> Você pode acompanhar as votações de
        cada vereador, presença nas sessões e os projetos de lei que cada um
        apresenta. Tudo isso é público no Portal da Câmara.
      </div>
    </section>
  );
}

function VereadorCard({ vereador, cor }: { vereador: Vereador; cor: string }) {
  const corBadge = corPartido(vereador.partido);

  return (
    <article
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 12,
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        background: vereador.cargoMesa ? "var(--color-camara-light)" : "var(--color-surface)",
        borderLeft: vereador.cargoMesa ? `4px solid ${cor}` : "1px solid var(--color-border)",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: cor,
          color: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 800,
          fontSize: 15,
          flexShrink: 0,
        }}
      >
        {iniciais(vereador.nome)}
      </div>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontWeight: 700,
            fontSize: 14,
            color: "var(--color-text)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={vereador.nome}
        >
          {vereador.nome}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 4,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: 0.8,
              color: "#fff",
              background: corBadge,
              padding: "2px 7px",
              borderRadius: 999,
            }}
          >
            {vereador.partido}
          </span>
          {vereador.cargoMesa && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: cor,
              }}
            >
              {vereador.cargoMesa}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
