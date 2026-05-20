import type { Entidade, DiariaItem } from "@/data/entidades";

interface Props {
  entidade: Entidade;
}

export function Diarias({ entidade }: Props) {
  const info = entidade.diarias;
  if (!info) return null;

  return (
    <section
      id="diarias"
      aria-labelledby="diarias-title"
      style={{
        background: "var(--color-surface)",
        borderRadius: "var(--radius-lg)",
        padding: 24,
        marginTop: 16,
        boxShadow: "var(--shadow-sm)",
        border: "1px solid var(--color-border)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 18,
        }}
      >
        <div style={{ flex: 1, minWidth: 240 }}>
          <h3
            id="diarias-title"
            style={{ fontSize: 22, fontWeight: 800, margin: 0 }}
          >
            Diárias de viagem
          </h3>
          <p
            style={{
              color: "var(--color-text-muted)",
              fontSize: 14,
              marginTop: 4,
              maxWidth: 620,
            }}
          >
            Toda diária paga pela {entidade.nome} deve mostrar publicamente{" "}
            <strong>quem viajou, em que função, para onde, por quê e quanto recebeu</strong>.
            Veja abaixo a tabela legal e os campos a fiscalizar.
          </p>
        </div>

        <a
          href={info.urlConsulta}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            background: entidade.cor,
            color: "#ffffff",
            padding: "10px 16px",
            borderRadius: "var(--radius-md)",
            fontSize: 13,
            fontWeight: 700,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          Ver diárias no portal →
        </a>
      </div>

      {/* Tabela legal de valores por função */}
      <div
        style={{
          marginBottom: 22,
          background: entidade.corLight,
          borderRadius: "var(--radius-md)",
          padding: 16,
          border: `1px solid ${entidade.cor}25`,
        }}
      >
        <h4
          style={{
            fontSize: 14,
            fontWeight: 800,
            margin: 0,
            color: entidade.cor,
            textTransform: "uppercase",
            letterSpacing: 0.8,
            marginBottom: 12,
          }}
        >
          📜 Valor da diária por função (lei)
        </h4>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {info.tabelaValores.map((linha) => (
            <div
              key={linha.cargo}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 12,
                padding: "10px 14px",
                background: "var(--color-surface)",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border)",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {linha.cargo}
                </div>
                {linha.observacao && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--color-text-muted)",
                      marginTop: 2,
                    }}
                  >
                    {linha.observacao}
                  </div>
                )}
              </div>
              <div
                style={{
                  fontWeight: 800,
                  fontSize: 15,
                  color: entidade.cor,
                  whiteSpace: "nowrap",
                }}
              >
                {linha.valor}
              </div>
            </div>
          ))}
        </div>

        {info.acrescimoEspecial && (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              fontSize: 13,
              background: "var(--color-surface)",
              borderRadius: "var(--radius-sm)",
              borderLeft: `3px solid ${entidade.cor}`,
              lineHeight: 1.5,
            }}
          >
            <strong>Acréscimo:</strong> {info.acrescimoEspecial}
          </div>
        )}

        <div
          style={{
            marginTop: 10,
            fontSize: 12,
            color: "var(--color-text-muted)",
          }}
        >
          Fonte legal: {info.fonteLegal}
        </div>
      </div>

      {/* Exemplos com estrutura completa */}
      <h4 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>
        Como cada diária aparece no portal
      </h4>
      <p
        style={{
          fontSize: 13,
          color: "var(--color-text-muted)",
          marginBottom: 12,
          lineHeight: 1.5,
        }}
      >
        Os exemplos abaixo mostram a estrutura completa de uma diária pública.
        No portal oficial você terá o nome do servidor e o valor real.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {info.exemplos.map((ex, i) => (
          <DiariaCard key={i} item={ex} cor={entidade.cor} />
        ))}
      </div>

      <div
        style={{
          marginTop: 18,
          padding: 14,
          background: "#fff8e1",
          border: "1px solid #ffe082",
          borderRadius: "var(--radius-md)",
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        <strong>🚩 Sinais que pedem fiscalização:</strong>
        <ul style={{ listStylePosition: "inside", marginTop: 6, paddingLeft: 4 }}>
          <li>
            Mesma pessoa viajando com altíssima frequência para o mesmo destino
          </li>
          <li>
            Motivo da viagem genérico demais ("reunião", "evento") sem detalhe
          </li>
          <li>
            Diárias com valor acima do estabelecido na lei para aquela função
          </li>
          <li>
            Viagens em datas que coincidem com feriados ou fins de semana
          </li>
          <li>
            Diárias pagas a cargos comissionados em volume desproporcional
          </li>
        </ul>
        <div style={{ marginTop: 8 }}>
          Encontrou algo suspeito? Denuncie ao{" "}
          <strong>TCE-MG</strong> ou <strong>MP-MG</strong> — pode ser anônimo.
        </div>
      </div>
    </section>
  );
}

function DiariaCard({ item, cor }: { item: DiariaItem; cor: string }) {
  return (
    <article
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        background: "var(--color-surface-alt)",
        padding: 14,
        position: "relative",
      }}
    >
      {item.ilustrativo && (
        <span
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            fontSize: 10,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: 1,
            color: "var(--color-text-muted)",
            background: "var(--color-surface)",
            padding: "2px 7px",
            borderRadius: 999,
            border: "1px dashed var(--color-border-strong)",
          }}
          title="Exemplo ilustrativo — dados reais estão no portal oficial"
        >
          Exemplo
        </span>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 10,
        }}
      >
        <Campo rotulo="Servidor" valor={item.servidor} destaque={false} />
        <Campo
          rotulo="Função / Cargo"
          valor={item.funcao}
          destaque={true}
          cor={cor}
        />
        <Campo rotulo="Destino" valor={item.destino} destaque={false} />
        <Campo rotulo="Período" valor={item.diasOuPeriodo} destaque={false} />
        <Campo rotulo="Motivo" valor={item.motivo} destaque={false} />
        <Campo
          rotulo="Valor pago"
          valor={item.valor}
          destaque={true}
          cor={cor}
        />
      </div>
    </article>
  );
}

function Campo({
  rotulo,
  valor,
  destaque,
  cor,
}: {
  rotulo: string;
  valor: string;
  destaque: boolean;
  cor?: string;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: 1,
          color: "var(--color-text-muted)",
        }}
      >
        {rotulo}
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: destaque ? 800 : 600,
          color: destaque && cor ? cor : "var(--color-text)",
          marginTop: 2,
          lineHeight: 1.35,
        }}
      >
        {valor}
      </div>
    </div>
  );
}
