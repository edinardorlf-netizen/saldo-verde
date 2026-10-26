import React, { useState, useEffect } from "react";
import { sb } from "./lib/supabase.js";
import { Icon } from "./shared.jsx";

/* ============================================================
   Botão "Enviar sugestão" (feedback dos testadores)
   As mensagens vão para a tabela public.feedback no Supabase.
   ============================================================ */

export const APP_VERSION = "0.9-teste";

const KINDS = [
  { id: "sugestao", emoji: "💡", label: "Sugestão" },
  { id: "problema", emoji: "🐞", label: "Problema" },
  { id: "elogio", emoji: "💚", label: "Elogio" },
];

const fcss = `
.fb-fab{position:fixed;right:max(18px, calc(14px + env(safe-area-inset-right,0px)));bottom:calc(22px + env(safe-area-inset-bottom,0px));z-index:35;
  border:0;border-radius:999px;background:var(--ink);color:#fff;height:46px;padding:0 16px 0 13px;display:inline-flex;align-items:center;gap:8px;
  font-weight:700;font-size:13.5px;box-shadow:0 10px 26px rgba(15,28,21,.28)}
.fb-fab:hover{background:#22352b}
@media (max-width:860px){.fb-fab{bottom:calc(84px + env(safe-area-inset-bottom,0px));height:42px;padding:0 13px}.fb-fab span{display:none}}
.fb-bg{position:fixed;inset:0;background:rgba(15,28,21,.45);z-index:70;display:flex;align-items:flex-end;justify-content:center;
  padding:calc(16px + env(safe-area-inset-top,0px)) env(safe-area-inset-right,0px) 0 env(safe-area-inset-left,0px)}
.fb-sheet{background:var(--surface);width:100%;max-width:520px;max-height:100%;overflow:auto;border-radius:22px 22px 0 0;
  padding:18px max(18px, env(safe-area-inset-right,0px)) calc(22px + env(safe-area-inset-bottom,0px)) max(18px, env(safe-area-inset-left,0px));
  box-shadow:0 -12px 40px rgba(0,0,0,.18);display:flex;flex-direction:column;gap:14px;overscroll-behavior:contain}
@media (min-width:720px){.fb-bg{align-items:center;padding:24px}.fb-sheet{border-radius:20px;padding:22px}}
.fb-h{display:flex;justify-content:space-between;align-items:center;gap:12px}
.fb-h h2{margin:0;font-size:18px;letter-spacing:-.015em}
.fb-x{border:0;background:var(--line-2);width:36px;height:36px;border-radius:10px;display:grid;place-items:center;flex:none}
.fb-kinds{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.fb-kinds button{border:1px solid var(--line);background:var(--surface);border-radius:12px;padding:10px 6px;font-weight:600;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:13px}
.fb-kinds button span{font-size:20px}
.fb-kinds button.on{border-color:var(--green);background:var(--green-soft);color:var(--green-ink)}
.fb-text{min-height:120px;resize:vertical;border:1px solid var(--line);border-radius:12px;padding:12px;font:inherit;width:100%;background:var(--surface)}
.fb-text:focus{outline:none;border-color:var(--green);box-shadow:0 0 0 3px var(--green-soft)}
.fb-rate{display:grid;grid-template-columns:repeat(11,minmax(0,1fr));gap:4px}
.fb-rate button{border:1px solid var(--line);background:var(--surface);border-radius:8px;height:34px;font-weight:600;font-size:12.5px;padding:0;font-variant-numeric:tabular-nums}
.fb-rate button.on{background:var(--green);border-color:var(--green);color:#fff}
.fb-scale{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:4px}
.fb-done{text-align:center;padding:18px 6px;display:flex;flex-direction:column;align-items:center;gap:8px}
.fb-done b{font-size:18px}
`;

export function FeedbackButton({ screen }) {
  const [open, setOpen] = useState(false);
  if (!sb) return null;
  return (
    <>
      <style>{fcss}</style>
      <button type="button" className="fb-fab" onClick={() => setOpen(true)} aria-label="Enviar sugestão">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /><path d="M8.5 11h7M8.5 14.5h4" />
        </svg>
        <span>Enviar sugestão</span>
      </button>
      {open && <FeedbackSheet screen={screen} onClose={() => setOpen(false)} />}
    </>
  );
}

function FeedbackSheet({ screen, onClose }) {
  const [kind, setKind] = useState("sugestao");
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState(null);
  const [name, setName] = useState(() => { try { return localStorage.getItem("saldo-verde-nome") || ""; } catch (e) { return ""; } });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sb.auth.getSession().then(({ data }) => {
      const n = data.session && data.session.user.user_metadata && data.session.user.user_metadata.name;
      if (n) setName((cur) => cur || n);
    });
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, []);

  const send = async (e) => {
    e.preventDefault();
    const text = message.trim();
    if (text.length < 3) return setErr("Escreva sua mensagem antes de enviar.");
    setBusy(true); setErr("");
    const { error } = await sb.from("feedback").insert({
      kind, message: text.slice(0, 2000), rating, name: name.trim().slice(0, 60) || null,
      screen: (screen || "").slice(0, 60), device: (navigator.userAgent || "").slice(0, 300), app_version: APP_VERSION,
    });
    setBusy(false);
    if (error) {
      return setErr(/fetch|network|load failed/i.test(error.message || "")
        ? "Sem conexão com o servidor agora. Confira a internet e tente de novo."
        : "Não foi possível enviar. Tente de novo em instantes.");
    }
    try { if (name.trim()) localStorage.setItem("saldo-verde-nome", name.trim()); } catch (e2) { /* ignora */ }
    setDone(true);
  };

  const placeholder = kind === "problema"
    ? "O que aconteceu? O que você estava tentando fazer?"
    : kind === "elogio" ? "O que você mais gostou?" : "O que faria o app ficar melhor para você?";

  return (
    <div className="fb-bg" onClick={onClose}>
      <form className="fb-sheet" onClick={(e) => e.stopPropagation()} onSubmit={send} noValidate role="dialog" aria-modal="true" aria-label="Enviar sugestão">
        <div className="fb-h"><h2>{done ? "Obrigado!" : "Enviar sugestão"}</h2><button type="button" className="fb-x" onClick={onClose} aria-label="Fechar"><Icon name="x" size={18} /></button></div>
        {done ? (
          <div className="fb-done">
            <span style={{ fontSize: 40 }}>💚</span>
            <b>Mensagem recebida</b>
            <p className="hint" style={{ maxWidth: "36ch" }}>Cada sugestão é lida e ajuda a decidir o que melhorar primeiro.</p>
            <div className="btnrow" style={{ justifyContent: "center", marginTop: 6 }}>
              <button type="button" className="btn ghost" onClick={() => { setDone(false); setMessage(""); setRating(null); }}>Enviar outra</button>
              <button type="button" className="btn sm" onClick={onClose}>Fechar</button>
            </div>
          </div>
        ) : (
          <>
            <p className="hint" style={{ margin: 0 }}>Achou um problema, sentiu falta de algo ou quer elogiar? Conte aqui.</p>
            <div className="fb-kinds" role="radiogroup" aria-label="Tipo de mensagem">
              {KINDS.map((k) => (
                <button type="button" key={k.id} className={kind === k.id ? "on" : ""} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}><span>{k.emoji}</span>{k.label}</button>
              ))}
            </div>
            <div className="field">
              <label htmlFor="fb-msg">Mensagem</label>
              <textarea id="fb-msg" className="fb-text" maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={placeholder} />
            </div>
            <div className="field">
              <span className="flabel">De 0 a 10, quanto você indicaria o app a um amigo? <span style={{ fontWeight: 400, color: "var(--muted)" }}>(opcional)</span></span>
              <div className="fb-rate">
                {Array.from({ length: 11 }, (_, i) => (
                  <button type="button" key={i} className={rating === i ? "on" : ""} aria-pressed={rating === i} onClick={() => setRating(rating === i ? null : i)}>{i}</button>
                ))}
              </div>
              <div className="fb-scale"><span>Nada provável</span><span>Com certeza</span></div>
            </div>
            <div className="field">
              <label htmlFor="fb-name">Seu nome <span style={{ fontWeight: 400, color: "var(--muted)" }}>(opcional)</span></label>
              <input id="fb-name" className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Para eu saber de quem é" />
            </div>
            {err && <p className="err">{err}</p>}
            <button className="btn" type="submit" disabled={busy}>{busy ? "Enviando…" : "Enviar"}</button>
          </>
        )}
      </form>
    </div>
  );
}
