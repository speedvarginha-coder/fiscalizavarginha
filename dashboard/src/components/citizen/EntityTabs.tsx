import type { EntidadeId } from "@/data/entidades";
import { ENTIDADES } from "@/data/entidades";

interface EntityTabsProps {
  active: EntidadeId;
  onChange: (id: EntidadeId) => void;
}

export function EntityTabs({ active, onChange }: EntityTabsProps) {
  const ids: EntidadeId[] = ["prefeitura", "camara"];

  return (
    <div
      role="tablist"
      aria-label="Selecione o órgão a fiscalizar"
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
        margin: "24px 0 8px",
      }}
    >
      {ids.map((id) => {
        const ent = ENTIDADES[id];
        const isActive = active === id;
        return (
          <button
            key={id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(id)}
            style={{
              background: isActive ? ent.cor : "var(--color-surface)",
              color: isActive ? "#ffffff" : "var(--color-text)",
              border: `2px solid ${isActive ? ent.cor : "var(--color-border)"}`,
              borderRadius: "var(--radius-lg)",
              padding: "18px 20px",
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: 14,
              boxShadow: isActive ? "var(--shadow-md)" : "var(--shadow-sm)",
              transition: "all 0.15s ease",
            }}
          >
            <div
              aria-hidden="true"
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                background: isActive ? "rgba(255,255,255,0.2)" : ent.corLight,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
                flexShrink: 0,
              }}
            >
              {id === "prefeitura" ? "🏛️" : "⚖️"}
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  opacity: isActive ? 0.85 : 0.6,
                  fontWeight: 600,
                }}
              >
                Poder {ent.poder}
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>
                {ent.nome}
              </div>
              <div
                style={{
                  fontSize: 12,
                  opacity: isActive ? 0.9 : 0.7,
                  marginTop: 2,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {ent.nomeCompleto}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
