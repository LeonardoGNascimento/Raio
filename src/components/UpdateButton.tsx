import { useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type Phase = "idle" | "available" | "downloading" | "ready" | "error";

/** Checa updates no GitHub Releases; aparece só quando há versão nova. */
export function UpdateButton() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [version, setVersion] = useState("");
  const [pct, setPct] = useState(0);
  const updateRef = useRef<Update | null>(null);

  useEffect(() => {
    let alive = true;
    const lookup = async () => {
      try {
        const update = await check();
        if (!alive || !update) return;
        updateRef.current = update;
        setVersion(update.version);
        setPhase("available");
      } catch {
        /* sem rede, dev mode ou release sem updater: silencioso */
      }
    };
    lookup();
    const timer = setInterval(lookup, 60 * 60 * 1000); // rechecagem por hora
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const install = async () => {
    const update = updateRef.current;
    if (!update) return;
    setPhase("downloading");
    setPct(0);
    let total = 0;
    let got = 0;
    try {
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        else if (ev.event === "Progress") {
          got += ev.data.chunkLength;
          if (total > 0) setPct(Math.min(99, Math.round((got / total) * 100)));
        } else if (ev.event === "Finished") setPct(100);
      });
      setPhase("ready");
    } catch (e) {
      console.error("update falhou:", e);
      setPhase("error");
      setTimeout(() => setPhase("available"), 4000);
    }
  };

  if (phase === "idle") return null;
  if (phase === "available")
    return (
      <button className="btn-ghost update-btn" onClick={install} title="baixar e instalar a nova versão">
        <span className="c-accent">↓</span> atualizar para v{version}
      </button>
    );
  if (phase === "downloading")
    return (
      <span className="btn-ghost update-btn" style={{ cursor: "default" }}>
        <span className="pulse-dot" style={{ width: 8, height: 8 }} /> baixando… {pct}%
      </span>
    );
  if (phase === "ready")
    return (
      <button className="btn-primary update-btn" onClick={() => void relaunch()} title="a nova versão entra ao reiniciar">
        reiniciar agora · v{version}
      </button>
    );
  return (
    <span className="btn-ghost update-btn c-err" style={{ cursor: "default" }}>
      falha ao atualizar — tento de novo
    </span>
  );
}
