import { ENTIDADES } from "@/data/entidades";

export function Diferencas() {
  const prefeitura = ENTIDADES.prefeitura;
  const camara = ENTIDADES.camara;

  return (
    <section
      id="diferencas"
      aria-labelledby="dif-title"
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
          id="dif-title"
          style={{ fontSize: 22, fontWeight: 800, margin: 0 }}
        >
          Quem faz o quê? Prefeitura vs. Câmara
        </h3>
        <p
          style={{
            color: "var(--color-text-muted)",
            fontSize: 14,
            marginTop: 4,
          }}
        >
          Antes de cobrar, é importante saber quem é responsável pelo quê. Os
          dois órgãos têm papéis diferentes — e isso muda quem você precisa
          fiscalizar.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        {/* Prefeitura */}
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderTop: `4px solid ${prefeitura.cor}`,
            borderRadius: "var(--radius-md)",
            padding: 18,
            background: prefeitura.corLight,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <span style={{ fontSize: 28 }} aria-hidden="true">
              🏛️
            </span>
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  color: prefeitura.cor,
                  letterSpacing: 1,
                }}
              >
                Poder Executivo
              </div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>
                Prefeitura — Faz acontecer
              </div>
            </div>
          </div>

          <ListaCheck titulo="O que faz" itens={prefeitura.oQueFaz} cor="success" />
          <ListaCheck
            titulo="O que NÃO faz"
            itens={prefeitura.oQueNaoFaz}
            cor="danger"
          />
        </div>

        {/* Câmara */}
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderTop: `4px solid ${camara.cor}`,
            borderRadius: "var(--radius-md)",
            padding: 18,
            background: camara.corLight,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <span style={{ fontSize: 28 }} aria-hidden="true">
              ⚖️
            </span>
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  color: camara.cor,
                  letterSpacing: 1,
                }}
              >
                Poder Legislativo
              </div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>
                Câmara — Faz as leis e fiscaliza
              </div>
            </div>
          </div>

          <ListaCheck titulo="O que faz" itens={camara.oQueFaz} cor="success" />
          <ListaCheck
            titulo="O que NÃO faz"
            itens={camara.oQueNaoFaz}
            cor="danger"
          />
        </div>
      </div>

      <div
        style={{
          marginTop: 18,
          padding: 14,
          background: "var(--color-surface-alt)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          fontSize: 14,
          lineHeight: 1.55,
        }}
      >
        <strong>💡 Resumo simples:</strong> A <strong>Prefeitura</strong> usa o
        dinheiro para prestar serviços. A <strong>Câmara</strong> aprova como
        esse dinheiro pode ser usado e fiscaliza se foi usado direito. Quando
        uma obra está atrasada, cobre a Prefeitura. Quando uma lei municipal
        precisa mudar, cobre a Câmara.
      </div>
    </section>
  );
}

function ListaCheck({
  titulo,
  itens,
  cor,
}: {
  titulo: string;
  itens: string[];
  cor: "success" | "danger";
}) {
  const corValor = cor === "success" ? "var(--color-success)" : "var(--color-danger)";
  const simbolo = cor === "success" ? "✓" : "✕";

  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          color: corValor,
          marginBottom: 8,
        }}
      >
        {titulo}
      </div>
      <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
        {itens.map((item, i) => (
          <li
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontSize: 14,
              lineHeight: 1.45,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                color: corValor,
                fontWeight: 800,
                flexShrink: 0,
                width: 16,
                textAlign: "center",
              }}
            >
              {simbolo}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
