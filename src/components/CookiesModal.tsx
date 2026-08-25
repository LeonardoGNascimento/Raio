import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { api, type CookieInfo } from "../api";

export function CookiesModal({ onClose }: { onClose: () => void }) {
  const [cookies, setCookies] = useState<CookieInfo[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = () =>
    api
      .listCookies()
      .then((c) => {
        setCookies(c);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));

  useEffect(() => {
    load();
  }, []);

  return (
    <Modal title="Cookies da sessão" width={640} onClose={onClose}>
      <div className="modal-hint">
        Cookies recebidos via <span className="mono">Set-Cookie</span> nesta sessão do app — são
        reenviados automaticamente para o mesmo host. Fechar o raio limpa tudo.
      </div>
      {loaded && cookies.length === 0 && (
        <div className="hint-block c-faint">nenhum cookie na sessão.</div>
      )}
      {cookies.length > 0 && (
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          {cookies.map((c, i) => (
            <div key={i} className="hdr-view-row">
              <span className="k" style={{ flex: "0 0 180px" }}>
                {c.domain}
                <span className="c-faint">{c.path}</span>
              </span>
              <span className="v">
                <span className="c-accent">{c.name}</span>
                <span className="c-faint"> = </span>
                {c.value}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="modal-foot" style={{ justifyContent: "space-between" }}>
        <button
          className="btn-danger-ghost"
          disabled={cookies.length === 0}
          onClick={async () => {
            await api.clearCookies();
            load();
          }}
        >
          limpar todos
        </button>
        <button className="btn-ghost" onClick={onClose}>Fechar</button>
      </div>
    </Modal>
  );
}
