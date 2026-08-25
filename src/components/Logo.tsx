/** Identidade visual do raio (design "raio logo"). */

export function Bolt({ size = 20, ink = false }: { size?: number; ink?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      {!ink && (
        <defs>
          <linearGradient id="raioBolt" x1="30" y1="8" x2="70" y2="92" gradientUnits="userSpaceOnUse">
            <stop stopColor="#f7d074" />
            <stop offset="1" stopColor="#e0a63a" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M57 20 L34 54 H48 L43 80 L67 44 H52 L57 20 Z"
        fill={ink ? "var(--ground)" : "url(#raioBolt)"}
      />
    </svg>
  );
}

/** Símbolo: bolt dentro do quadrado arredondado com anel. */
export function Symbol({ size = 72 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="raioBoltS" x1="30" y1="8" x2="70" y2="92" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f7d074" />
          <stop offset="1" stopColor="#e0a63a" />
        </linearGradient>
        <linearGradient id="raioRing" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop stopColor="#e0a63a" stopOpacity=".55" />
          <stop offset="1" stopColor="#e0a63a" stopOpacity=".12" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="94" height="94" rx="26" fill="#17140f" stroke="url(#raioRing)" strokeWidth="1.5" />
      <path d="M57 20 L34 54 H48 L43 80 L67 44 H52 L57 20 Z" fill="url(#raioBoltS)" />
    </svg>
  );
}

/** Lockup horizontal: bolt + wordmark Righteous. */
export function Lockup({ boltSize = 20, fontSize = 19 }: { boltSize?: number; fontSize?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: Math.round(boltSize * 0.38) }}>
      <Bolt size={boltSize} />
      <span className="wordmark" style={{ fontSize }}>raio</span>
    </span>
  );
}
