import { useRef, useState } from "react";
import { Modal } from "./Modal";
import {
  applyTheme,
  DEFAULT_THEME,
  parseTheme,
  PRESETS,
  saveTheme,
  THEME_KEYS,
  THEME_LABELS,
  type Theme,
} from "../lib/theme";

interface Props {
  current: Theme;
  onChange: (theme: Theme) => void;
  onClose: () => void;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function ThemeModal({ current, onChange, onClose }: Props) {
  const [theme, setTheme] = useState<Theme>(current);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // aplica ao vivo, persiste e avisa o App
  const update = (next: Theme) => {
    setTheme(next);
    setError(null);
    applyTheme(next);
    saveTheme(next);
    onChange(next);
  };

  const setColor = (key: (typeof THEME_KEYS)[number], value: string) => {
    if (!HEX.test(value)) {
      // deixa digitar hex parcial no campo de texto sem aplicar
      setTheme({ ...theme, colors: { ...theme.colors, [key]: value } });
      return;
    }
    update({ ...theme, name: theme.name, colors: { ...theme.colors, [key]: value.toLowerCase() } });
  };

  const importFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = parseTheme(String(reader.result ?? ""));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      update(result.theme);
    };
    reader.onerror = () => setError("não consegui ler o arquivo");
    reader.readAsText(file);
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(theme, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard indisponível */
    }
  };

  return (
    <Modal title="Tema" width={560} onClose={onClose}>
      <div className="modal-hint">
        As cores aplicam na hora e ficam salvas. Compartilhe copiando o JSON — outro raio importa
        pelo arquivo <span className="mono">.json</span>.
      </div>

      <div className="field-label">presets</div>
      <div className="fmt-row">
        {PRESETS.map((p) => (
          <button
            key={p.name}
            className={"fmt-btn" + (theme.name === p.name ? " active" : "")}
            onClick={() => update(structuredClone(p))}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="field-label" style={{ marginTop: 6 }}>cores</div>
      <div className="theme-grid">
        {THEME_KEYS.map((key) => (
          <label key={key} className="theme-row">
            <span className="theme-label">{THEME_LABELS[key]}</span>
            <input
              type="color"
              className="theme-swatch"
              value={HEX.test(theme.colors[key]) ? theme.colors[key] : "#000000"}
              onChange={(e) => setColor(key, e.target.value)}
            />
            <input
              className="inp theme-hex"
              value={theme.colors[key]}
              onChange={(e) => setColor(key, e.target.value.trim())}
              spellCheck={false}
            />
          </label>
        ))}
      </div>

      {error && <div className="err-box">{error}</div>}

      <div className="modal-foot" style={{ justifyContent: "space-between" }}>
        <button className="btn-danger-ghost" onClick={() => update(structuredClone(DEFAULT_THEME))}>
          restaurar padrão
        </button>
        <div style={{ display: "flex", gap: 9 }}>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importFile(f);
              e.target.value = "";
            }}
          />
          <button className="btn-ghost" onClick={copyJson}>
            {copied ? "JSON copiado ✓" : "copiar JSON do tema"}
          </button>
          <button className="btn-primary" onClick={() => fileRef.current?.click()}>
            importar .json
          </button>
        </div>
      </div>
    </Modal>
  );
}
