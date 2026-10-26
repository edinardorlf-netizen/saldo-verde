import React, { useState, useEffect } from "react";

/* ---------- Datas e números ---------- */
export const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
export const MS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export const pad = (n) => String(n).padStart(2, "0");
export const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const todayStr = () => { const d = new Date(); return `${ym(d)}-${pad(d.getDate())}`; };
export const addM = (key, n) => { const [y, m] = key.split("-").map(Number); return ym(new Date(y, m - 1 + n, 1)); };
export const monthIdx = (key) => Number(key.split("-")[1]) - 1;
export const yearOf = (key) => Number(key.split("-")[0]);
export const monthLabel = (key) => `${MONTHS[monthIdx(key)]} ${yearOf(key)}`;
export const shortMonth = (key) => `${MS[monthIdx(key)]}/${String(yearOf(key)).slice(2)}`;
export const r2 = (v) => Math.round(v * 100) / 100;
export const sum = (arr) => r2(arr.reduce((a, t) => a + Number(t.amount), 0));
export const brl = (v) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const money = (v, cur = "BRL") => {
  try { return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: cur }); }
  catch (e) { return `${cur} ${(v || 0).toFixed(2)}`; }
};
export const brlShort = (v) => (v >= 1000 ? `R$ ${(v / 1000).toFixed(1).replace(".", ",")} mil` : `R$ ${Math.round(v)}`);
export const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
export const fmtDate = (s) => { const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; };

export function parseMoney(s) {
  if (typeof s === "number") return s;
  let t = String(s).replace(/[^\d.,-]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return t !== "" && isFinite(n) ? r2(n) : NaN;
}

/* ---------- Ícones (SVG) ---------- */
export const Icon = ({ name, size = 20 }) => {
  const p = {
    home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" /><path d="M10 20v-5h4v5" /></>,
    plus: <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>,
    add: <path d="M12 5v14M5 12h14" />,
    card: <><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 10h19M6.5 15h4" /></>,
    list: <><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" /></>,
    bulb: <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z" /></>,
    users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.5 3.5 5.2" /></>,
    left: <path d="m15 18-6-6 6-6" />,
    right: <path d="m9 18 6-6-6-6" />,
    up: <><path d="M7 17 17 7" /><path d="M8 7h9v9" /></>,
    down: <><path d="M7 7l10 10" /><path d="M17 8v9H8" /></>,
    wallet: <><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H19v4" /><rect x="3" y="7" width="18" height="13" rx="2.5" /><path d="M16 13.5h2" /></>,
    check: <path d="m5 12 5 5L20 7" />,
    alert: <><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4M12 17h.01" /></>,
    x: <path d="M6 6l12 12M18 6 6 18" />,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
    share: <><path d="M12 15V3M8 7l4-4 4 4" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></>,
    swap: <><path d="M7 4 3 8l4 4M3 8h14" /><path d="m17 20 4-4-4-4M21 16H7" /></>,
    logout: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l5-5-5-5M15 12H4" /></>,
    cloud: <path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.2 9.3 4.4 4.4 0 0 0 7 18Z" />,
  }[name];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {p}
    </svg>
  );
};

/* ---------- Pequenos componentes ---------- */
export function HBar({ pct, color }) {
  return (
    <svg width="100%" height="10" aria-hidden="true">
      <rect x="0" y="0" width="100%" height="10" rx="5" fill="#EEF3EF" />
      <rect x="0" y="0" width={`${Math.max(pct, 1.5)}%`} height="10" rx="5" fill={color} />
    </svg>
  );
}

export function ConfirmX({ label = "Excluir", confirmLabel = "Confirmar", onConfirm }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button type="button" className={`xbtn${armed ? " confirm" : ""}`} onClick={(e) => { e.stopPropagation(); armed ? onConfirm() : setArmed(true); }}>
      {armed ? confirmLabel : label}
    </button>
  );
}
