export function Footer() {
  return (
    <footer
      style={{
        marginTop: 32,
        background: "var(--color-primary-dark)",
        color: "#ffffff",
        padding: "32px 0",
      }}
    >
      <div className="container">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 24,
          }}
        >
          <div>
            <h4 style={{ fontSize: 16, fontWeight: 800, marginBottom: 8, color: "#fff" }}>
              Fiscaliza Varginha
            </h4>
            <p style={{ fontSize: 13, opacity: 0.8, lineHeight: 1.55 }}>
              Iniciativa cidadã para tornar a transparência municipal mais fácil
              de entender. Este site não substitui os portais oficiais — ele
              traduz e organiza a informação pública.
            </p>
          </div>

          <div>
            <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: "#fff" }}>
              Base legal
            </h4>
            <ul style={{ listStyle: "none", fontSize: 13, opacity: 0.85, lineHeight: 1.8 }}>
              <li>Lei nº 12.527/2011 — Acesso à Informação</li>
              <li>Lei Complementar 101/2000 — LRF</li>
              <li>Lei nº 14.129/2021 — Governo Digital</li>
              <li>Constituição Federal, art. 37</li>
            </ul>
          </div>

          <div>
            <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: "#fff" }}>
              Fontes oficiais
            </h4>
            <ul style={{ listStyle: "none", fontSize: 13, lineHeight: 1.8 }}>
              <li>
                <a
                  href="https://www.varginha.mg.gov.br"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--color-accent)" }}
                >
                  Prefeitura de Varginha
                </a>
              </li>
              <li>
                <a
                  href="https://www.camaravarginha.mg.gov.br"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--color-accent)" }}
                >
                  Câmara Municipal
                </a>
              </li>
              <li>
                <a
                  href="https://www.tce.mg.gov.br"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--color-accent)" }}
                >
                  TCE-MG
                </a>
              </li>
              <li>
                <a
                  href="https://www.mpmg.mp.br"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--color-accent)" }}
                >
                  MP-MG
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.15)",
            marginTop: 24,
            paddingTop: 16,
            fontSize: 12,
            opacity: 0.7,
            textAlign: "center",
          }}
        >
          Valores e percentuais apresentados são estimativas com base em médias
          de municípios similares. Para dados oficiais, consulte sempre os
          portais da Prefeitura e da Câmara.
        </div>
      </div>
    </footer>
  );
}
