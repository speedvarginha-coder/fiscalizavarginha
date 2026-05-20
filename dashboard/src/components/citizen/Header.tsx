export function Header() {
  return (
    <header
      style={{
        background: "var(--color-primary)",
        color: "#ffffff",
        boxShadow: "var(--shadow-md)",
        borderBottom: "4px solid var(--color-accent)",
      }}
    >
      <div
        className="container"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            aria-hidden="true"
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: "var(--color-accent)",
              color: "var(--color-primary-dark)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 18,
              letterSpacing: -0.5,
              flexShrink: 0,
            }}
          >
            FV
          </div>
          <div>
            <h1
              style={{
                fontSize: 22,
                fontWeight: 800,
                margin: 0,
                lineHeight: 1.1,
                color: "#ffffff",
              }}
            >
              Fiscaliza Varginha
            </h1>
            <p
              style={{
                fontSize: 13,
                margin: 0,
                opacity: 0.85,
                marginTop: 2,
              }}
            >
              Acompanhe para onde vai o dinheiro público
            </p>
          </div>
        </div>

        <nav style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <a
            href="#como-fiscalizar"
            style={{
              color: "#ffffff",
              padding: "8px 14px",
              borderRadius: "var(--radius-md)",
              fontSize: 14,
              fontWeight: 600,
              border: "1px solid rgba(255,255,255,0.3)",
            }}
          >
            Como fiscalizar
          </a>
          <a
            href="#diferencas"
            style={{
              color: "var(--color-primary-dark)",
              background: "var(--color-accent)",
              padding: "8px 14px",
              borderRadius: "var(--radius-md)",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            Entenda os poderes
          </a>
        </nav>
      </div>
    </header>
  );
}
