import React, { useState, useEffect } from "react";
import {
  MONTHS, MS, pad, ym, todayStr, addM, monthIdx, yearOf, monthLabel, shortMonth,
  r2, sum, brl, brlShort, uid, fmtDate, parseMoney, Icon, HBar, ConfirmX,
} from "./shared.jsx";
import { GroupsSection } from "./groups.jsx";

/* ============================================================
   Saldo Verde — controle financeiro pessoal
   React + hooks (useState/useEffect), gráficos em SVG puro,
   CSS em template string, dados persistidos em localStorage.
   ============================================================ */

const STORAGE_KEY = "saldo-verde-v1";

/* ---------- Categorias ---------- */
const CATS = {
  receita: [
    { id: "salario", emoji: "💼", name: "Salário" },
    { id: "freela", emoji: "💻", name: "Freelance" },
    { id: "rendimentos", emoji: "📈", name: "Rendimentos" },
    { id: "presente", emoji: "🎁", name: "Presente" },
    { id: "outros-r", emoji: "➕", name: "Outras receitas" },
  ],
  gasto: [
    { id: "moradia", emoji: "🏠", name: "Moradia" },
    { id: "mercado", emoji: "🛒", name: "Mercado" },
    { id: "transporte", emoji: "🚗", name: "Transporte" },
    { id: "restaurante", emoji: "🍽️", name: "Restaurantes" },
    { id: "saude", emoji: "💊", name: "Saúde" },
    { id: "educacao", emoji: "🎓", name: "Educação" },
    { id: "lazer", emoji: "🎬", name: "Lazer" },
    { id: "compras", emoji: "🛍️", name: "Compras" },
    { id: "assinaturas", emoji: "📱", name: "Assinaturas" },
    { id: "viagem", emoji: "✈️", name: "Viagem" },
    { id: "outros-g", emoji: "📦", name: "Outros gastos" },
  ],
};
const ALL_CATS = [...CATS.receita, ...CATS.gasto];
const catOf = (id) => ALL_CATS.find((c) => c.id === id) || { emoji: "📦", name: "Outros" };
const NEEDS = ["moradia", "mercado", "transporte", "saude", "educacao"];

const CARD_COLORS = ["#0E9F5A", "#1F3A5F", "#7A3FD1", "#D9480F", "#0B7285", "#C2255C", "#343A40", "#B08900"];

/* ---------- Utilitários: ver shared.jsx ---------- */

function shade(hex, amt) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  const mix = (c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `#${[r, g, b].map((x) => pad(x.toString(16))).join("")}`;
}

/* Mês da fatura em que entra a 1ª parcela: compras feitas depois do
   dia de fechamento do cartão caem na fatura do mês seguinte. */
function firstInvoiceMonth(dateStr, closingDay) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const key = `${y}-${pad(m)}`;
  return d > (closingDay || 31) ? addM(key, 1) : key;
}

/* Parcelamento inteligente: cada compra vira N parcelas, uma por mês.
   Centavos que sobram da divisão vão para a 1ª parcela. */
function expandInstallments(purchases) {
  const out = [];
  purchases.forEach((p) => {
    const base = Math.floor((p.total * 100) / p.n) / 100;
    const first = r2(p.total - base * (p.n - 1));
    const day = Math.min(Number(p.date.slice(8, 10)) || 1, 28);
    for (let i = 0; i < p.n; i++) {
      const month = addM(p.firstMonth, i);
      out.push({
        id: `${p.id}-${i}`, purchaseId: p.id, cardId: p.cardId, desc: p.desc, cat: p.cat,
        month, date: `${month}-${pad(day)}`, amount: i === 0 ? first : base, num: i + 1, n: p.n,
      });
    }
  });
  return out;
}

/* ---------- Persistência ---------- */
function useStored(key, init) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* armazenamento indisponível */ }
    return typeof init === "function" ? init() : init;
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignora */ }
  }, [key, value]);
  return [value, setValue];
}

/* ---------- Dados de exemplo (marcados como exemplo) ---------- */
function makeSample() {
  const cur = ym(new Date());
  let seed = 11;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const tx = [];
  const today = todayStr();
  const add = (type, desc, amount, cat, date, extra) => tx.push({ id: uid(), type, desc, amount: r2(amount), cat, date, status: "pago", ...extra });
  const start = addM(cur, -5);
  const rec = [
    { id: "r-sal", type: "receita", desc: "Salário", amount: 5200, cat: "salario", day: 5, start, count: null, end: null, skipped: [] },
    { id: "r-alu", type: "gasto", desc: "Aluguel", amount: 1450, cat: "moradia", day: 10, start, count: null, end: null, skipped: [] },
    { id: "r-sau", type: "gasto", desc: "Plano de saúde", amount: 310, cat: "saude", day: 12, start, count: null, end: null, skipped: [] },
    { id: "r-net", type: "gasto", desc: "Internet e celular", amount: 149.9, cat: "assinaturas", day: 15, start, count: null, end: null, skipped: [] },
    { id: "r-cur", type: "gasto", desc: "Curso de inglês", amount: 280, cat: "educacao", day: 20, start: addM(cur, -1), count: 6, end: null, skipped: [] },
  ];
  for (let k = -5; k <= 0; k++) {
    const m = addM(cur, k);
    const d = (day) => `${m}-${pad(day)}`;
    rec.forEach((r) => {
      if (m < r.start || (r.count && monthsBetween(r.start, m) >= r.count)) return;
      const date = d(Math.min(r.day, daysIn(m)));
      if (date <= today) add(r.type, r.desc, r.amount, r.cat, date, { recurId: r.id, recurMonth: m, paidDate: date });
    });
    if (k % 2 === 0) add("receita", "Projeto freelance", 600 + rnd() * 900, "freela", d(18));
    if (k === -2) add("receita", "Rendimento da poupança", 84.3, "rendimentos", d(1));
    add("gasto", "Supermercado do mês", 520 + rnd() * 250, "mercado", d(8));
    add("gasto", "Feira e padaria", 160 + rnd() * 120, "mercado", d(21));
    add("gasto", "Combustível", 210 + rnd() * 90, "transporte", d(14));
    add("gasto", "Jantar fora", 90 + rnd() * 160, "restaurante", d(19));
    if (k % 3 !== 0) add("gasto", "Cinema e passeios", 80 + rnd() * 120, "lazer", d(24));
  }
  const cards = [
    { id: "c1", name: "Cartão principal", bank: "Banco Horizonte", limit: 8000, color: "#0E9F5A", closing: 28, last4: "4821" },
    { id: "c2", name: "Cartão de viagens", bank: "Banco Atlântico", limit: 5000, color: "#1F3A5F", closing: 5, last4: "1307" },
  ];
  const p = (cardId, desc, total, n, cat, monthOffset, day) => {
    const date = `${addM(cur, monthOffset)}-${pad(day)}`;
    const card = cards.find((c) => c.id === cardId);
    return { id: uid(), cardId, desc, total, n, cat, date, firstMonth: firstInvoiceMonth(date, card.closing) };
  };
  const purchases = [
    p("c1", "Notebook", 3600, 10, "compras", -3, 12),
    p("c1", "Geladeira", 2400, 12, "moradia", -1, 3),
    p("c1", "Tênis de corrida", 459.9, 3, "compras", -1, 20),
    p("c2", "Passagens aéreas", 1800, 6, "viagem", 0, 2),
    p("c2", "Curso online", 960, 8, "educacao", -2, 4),
  ];
  tx.push({ id: uid(), type: "gasto", desc: "IPVA (parcela)", amount: 412.5, cat: "transporte", date: `${addM(cur, 1)}-${pad(8)}`, status: "previsto" });
  tx.push({ id: uid(), type: "receita", desc: "Reembolso do plano", amount: 180, cat: "outros-r", date: `${cur}-${pad(Math.min(28, daysIn(cur)))}`, status: "previsto" });
  return { tx, rec, cards, purchases, goal: 1000, sample: true };
}

const EMPTY = { tx: [], rec: [], cards: [], purchases: [], goal: 1000, sample: false };

/* ---------- Contas previstas e repetições ---------- */
const daysIn = (m) => new Date(yearOf(m), monthIdx(m) + 1, 0).getDate();
const monthsBetween = (a, b) => (yearOf(b) - yearOf(a)) * 12 + monthIdx(b) - monthIdx(a);
const isPaid = (t) => !t.virtual && t.status !== "previsto";
const addDays = (dateStr, n) => { const [y, m, d] = dateStr.split("-").map(Number); const x = new Date(y, m - 1, d + n); return `${ym(x)}-${pad(x.getDate())}`; };
const lastMonthOf = (r) => {
  const byCount = r.count ? addM(r.start, r.count - 1) : null;
  if (byCount && r.end) return byCount < r.end ? byCount : r.end;
  return byCount || r.end || null;
};

/* Ocorrências ainda não pagas das contas que se repetem, entre dois meses (inclusive). */
function virtualOccurrences(rules, tx, fromM, toM) {
  const out = [];
  (rules || []).forEach((r) => {
    const last = lastMonthOf(r);
    let m = r.start > fromM ? r.start : fromM;
    for (let guard = 0; m <= toM && guard < 240; guard++, m = addM(m, 1)) {
      if (last && m > last) break;
      if ((r.skipped || []).includes(m)) continue;
      if (tx.some((t) => t.recurId === r.id && t.recurMonth === m)) continue;
      out.push({
        id: `v-${r.id}-${m}`, virtual: true, recurId: r.id, recurMonth: m, type: r.type, desc: r.desc,
        amount: r.amount, cat: r.cat, date: `${m}-${pad(Math.min(r.day, daysIn(m)))}`, status: "previsto",
      });
    }
  });
  return out;
}

function dueLabel(date) {
  const t = todayStr();
  if (date < t) return { cls: "late", txt: `Atrasada desde ${fmtDate(date).slice(0, 5)}` };
  if (date === t) return { cls: "today", txt: "Vence hoje" };
  const days = Math.round((new Date(date) - new Date(t)) / 864e5);
  return { cls: "soon", txt: days <= 7 ? `Vence em ${days} ${days === 1 ? "dia" : "dias"}` : `Vence ${fmtDate(date).slice(0, 5)}` };
}

/* ---------- Estatísticas ---------- */
function monthStats(data, inst, m) {
  const all = [...data.tx.filter((t) => t.date.slice(0, 7) === m), ...virtualOccurrences(data.rec, data.tx, m, m)];
  const tx = all.filter(isPaid);
  const pend = all.filter((t) => !isPaid(t));
  const parcelas = inst.filter((i) => i.month === m);
  const rec = sum(tx.filter((t) => t.type === "receita"));
  const vista = sum(tx.filter((t) => t.type === "gasto"));
  const recPend = sum(pend.filter((t) => t.type === "receita"));
  const gastoPend = sum(pend.filter((t) => t.type === "gasto"));
  const parc = sum(parcelas);
  const saldo = r2(rec - vista - parc);
  return { all, tx, pend, parcelas, rec, vista, parc, recPend, gastoPend, gasto: r2(vista + parc), saldo, saldoPrev: r2(saldo + recPend - gastoPend) };
}

/* Ações sobre contas previstas, compartilhadas por Visão Geral, Lançar e Histórico. */
function billActions(setData) {
  return {
    pay: (item, amount) => setData((d) => (item.virtual
      ? { ...d, tx: [...d.tx, { id: uid(), type: item.type, desc: item.desc, amount, cat: item.cat, date: item.date, status: "pago", paidDate: todayStr(), recurId: item.recurId, recurMonth: item.recurMonth }] }
      : { ...d, tx: d.tx.map((t) => (t.id === item.id ? { ...t, amount, status: "pago", paidDate: todayStr() } : t)) })),
    skip: (item) => setData((d) => ({ ...d, rec: (d.rec || []).map((r) => (r.id === item.recurId ? { ...r, skipped: [...(r.skipped || []), item.recurMonth] } : r)) })),
    undo: (t) => setData((d) => (t.recurId
      ? { ...d, tx: d.tx.filter((x) => x.id !== t.id) }
      : { ...d, tx: d.tx.map((x) => (x.id === t.id ? { ...x, status: "previsto", paidDate: undefined } : x)) })),
    remove: (t) => setData((d) => ({ ...d, tx: d.tx.filter((x) => x.id !== t.id) })),
  };
}

/* Botão "Pagar/Receber" que permite ajustar o valor antes de confirmar. */
function PayInline({ item, onPay }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(String(item.amount).replace(".", ","));
  const income = item.type === "receita";
  if (!open) return <button type="button" className="btn sm paybtn" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>{income ? "Receber" : "Pagar"}</button>;
  const confirm = () => { const n = parseMoney(v); if (n > 0) { onPay(item, n); setOpen(false); } };
  return (
    <span className="payline" onClick={(e) => e.stopPropagation()}>
      <input className="input num" inputMode="decimal" aria-label="Valor" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && confirm()} autoFocus />
      <button type="button" className="btn sm" onClick={confirm}>OK</button>
      <button type="button" className="xbtn" onClick={() => setOpen(false)}>Cancelar</button>
    </span>
  );
}

/* ============================================================
   Estilos
   ============================================================ */
const css = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
:root{
  --bg:#F3F6F4; --surface:#FFFFFF; --ink:#0F1C15; --ink-2:#3B4A41; --muted:#6B7A71;
  --line:#E2E9E4; --line-2:#EEF3EF;
  --green:#0E9F5A; --green-ink:#0A7A45; --green-soft:#E4F5EC; --green-tint:#F2FAF5;
  --red:#D64545; --red-soft:#FCEBEB; --amber:#B7791F; --amber-soft:#FDF4E3;
  --shadow:0 1px 2px rgba(15,40,25,.05), 0 8px 24px rgba(15,40,25,.06);
  --radius:16px;
  --font:'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
*{box-sizing:border-box}
html,body{background:var(--bg)}
body{margin:0;font-family:var(--font);color:var(--ink);font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased}
button,input,select{font:inherit;color:inherit}
button{cursor:pointer}
:focus-visible{outline:2px solid var(--green);outline-offset:2px}
.num{font-variant-numeric:tabular-nums}

/* Layout */
.side{position:fixed;inset:0 auto 0 0;width:236px;background:var(--surface);border-right:1px solid var(--line);
  padding:calc(24px + env(safe-area-inset-top,0px)) 16px calc(20px + env(safe-area-inset-bottom,0px)) calc(16px + env(safe-area-inset-left,0px));
  display:flex;flex-direction:column;gap:28px;z-index:20}
.brand{display:flex;align-items:center;gap:10px;padding:0 8px;font-weight:800;font-size:17px;letter-spacing:-.02em}
.brand-mark{width:32px;height:32px;border-radius:10px;background:var(--green);display:grid;place-items:center}
.nav{display:flex;flex-direction:column;gap:4px}
.nav-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600;padding:0 12px 6px}
.nav button{display:flex;align-items:center;gap:12px;border:0;background:transparent;padding:10px 12px;border-radius:10px;
  color:var(--ink-2);font-weight:500;text-align:left;transition:background .15s,color .15s}
.nav button:hover{background:var(--line-2)}
.nav button.on{background:var(--green-soft);color:var(--green-ink);font-weight:600}
.nav svg{flex:none}
.side-foot{margin-top:auto;font-size:12px;color:var(--muted);padding:12px;border-radius:12px;background:var(--green-tint);border:1px solid var(--green-soft)}
.side-foot b{display:block;color:var(--ink);font-size:13px;margin-bottom:2px}

.main{margin-left:236px;padding-block:28px 56px;padding-left:max(32px, env(safe-area-inset-left,0px));padding-right:max(32px, env(safe-area-inset-right,0px));max-width:1440px}
.top{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:24px}
.top h1{margin:0;font-size:26px;letter-spacing:-.025em;font-weight:800;text-wrap:balance}
.top p{margin:4px 0 0;color:var(--muted)}
.picker{display:flex;align-items:center;gap:4px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:4px;box-shadow:var(--shadow)}
.picker button{border:0;background:transparent;width:34px;height:34px;border-radius:8px;display:grid;place-items:center;color:var(--ink-2)}
.picker button:hover{background:var(--line-2)}
.picker .lbl{min-width:132px;text-align:center;font-weight:600}
.picker .today{width:auto;padding:0 10px;font-size:12px;font-weight:600;color:var(--green-ink);background:var(--green-soft)}

.bnav{display:none}
@media (max-width:860px){
  .side{display:none}
  .main{margin-left:0;padding-block:20px calc(92px + env(safe-area-inset-bottom,0px));padding-left:max(16px, env(safe-area-inset-left,0px));padding-right:max(16px, env(safe-area-inset-right,0px))}
  .top h1{font-size:22px}
  .bnav{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:30;background:var(--surface);border-top:1px solid var(--line);
    padding:6px max(6px, env(safe-area-inset-right,0px)) calc(6px + env(safe-area-inset-bottom,0px)) max(6px, env(safe-area-inset-left,0px));justify-content:space-around}
  .bnav button{flex:1;min-width:0;border:0;background:transparent;display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 1px;border-radius:10px;font-size:10.5px;color:var(--muted);font-weight:500;white-space:nowrap}
  .bnav button.on{color:var(--green-ink);background:var(--green-soft);font-weight:600}
}

/* Blocos */
.stack{display:flex;flex-direction:column;gap:18px}
.card{background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow);padding:20px;min-width:0}
.card-h{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.card-h h2{margin:0;font-size:15px;font-weight:700;letter-spacing:-.01em}
.card-h small{color:var(--muted)}
.grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:18px}
.grid2{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(0,1fr);gap:18px}
.grid2.even{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
@media (max-width:1180px){.grid2,.grid2.even{grid-template-columns:minmax(0,1fr)}}

.banner{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--amber-soft);border:1px solid #F3DFB5;color:#6B4A12;border-radius:12px;padding:12px 16px;margin-bottom:20px}
.banner p{margin:0;flex:1;min-width:220px}
.banner .btns{display:flex;gap:8px;flex-wrap:wrap}

/* KPI */
.kpi{display:flex;flex-direction:column;gap:10px}
.kpi-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.kpi-label{display:flex;align-items:center;gap:8px;color:var(--muted);font-weight:500}
.kpi-ico{width:30px;height:30px;border-radius:9px;display:grid;place-items:center}
.kpi-val{font-size:26px;font-weight:800;letter-spacing:-.025em}
.kpi-row{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}
.delta{font-size:12px;font-weight:600;padding:3px 8px;border-radius:999px;white-space:nowrap}
.delta.up{background:var(--green-soft);color:var(--green-ink)}
.delta.down{background:var(--red-soft);color:var(--red)}
.delta.flat{background:var(--line-2);color:var(--muted)}
.kpi-sub{font-size:12px;color:var(--muted)}
.spark{flex:none}

/* Cartões bancários */
.ccards{display:flex;gap:14px;overflow-x:auto;padding:2px 2px 8px;scroll-snap-type:x mandatory}
.ccard{flex:none;width:272px;max-width:100%;aspect-ratio:1.586;border-radius:16px;color:#fff;padding:18px;display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden;scroll-snap-align:start;box-shadow:0 10px 24px rgba(0,0,0,.14)}
.ccard::before,.ccard::after{content:"";position:absolute;border-radius:50%;background:rgba(255,255,255,.09)}
.ccard::before{width:220px;height:220px;right:-80px;top:-110px}
.ccard::after{width:160px;height:160px;right:-30px;bottom:-100px}
.ccard>*{position:relative;z-index:1}
.ccard-top{display:flex;justify-content:space-between;align-items:center;font-weight:600;font-size:13px;opacity:.95}
.ccard-num{font-size:15px;letter-spacing:.12em;font-variant-numeric:tabular-nums;opacity:.92}
.ccard-bottom{display:flex;flex-direction:column;gap:7px}
.ccard-row{display:flex;justify-content:space-between;align-items:flex-end;gap:8px;font-size:12px}
.ccard-row b{font-size:15px;display:block}
.ccard-row span{opacity:.8}
.meter{height:6px;border-radius:99px;background:rgba(255,255,255,.25);overflow:hidden}
.meter i{display:block;height:100%;background:#fff;border-radius:99px}
.ccard.add{background:var(--green-tint);border:1.5px dashed #B9DEC9;color:var(--green-ink);box-shadow:none;align-items:center;justify-content:center;gap:8px;font-weight:600;cursor:pointer}
.ccard.add::before,.ccard.add::after{display:none}

/* Ações rápidas */
.quick{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:16px}
@media (max-width:560px){.quick{grid-template-columns:repeat(2,minmax(0,1fr))}}
.quick button{border:1px solid var(--line);background:var(--surface);border-radius:12px;padding:12px 8px;display:flex;flex-direction:column;align-items:center;gap:6px;font-weight:600;font-size:12.5px;color:var(--ink-2);transition:border-color .15s, background .15s}
.quick button:hover{border-color:#B9DEC9;background:var(--green-tint)}
.quick .qi{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;font-size:17px}

/* Meta */
.goal-val{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.goal-val b{font-size:24px;font-weight:800;letter-spacing:-.02em}
.goal-val span{color:var(--muted)}
.bar{height:12px;border-radius:99px;background:var(--line-2);overflow:hidden;margin:12px 0 8px}
.bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#34C17D,var(--green));transition:width .4s}
.goal-ctl{display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap}
.goal-ctl input[type=range]{flex:1;min-width:140px;accent-color:var(--green)}
.goal-ctl .money{width:120px}

/* Barras por categoria */
.cbars{display:flex;flex-direction:column;gap:12px}
.cbar{display:grid;grid-template-columns:minmax(0,150px) minmax(0,1fr) auto;align-items:center;gap:12px}
.cbar-name{display:flex;align-items:center;gap:8px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cbar-val{font-weight:600;font-variant-numeric:tabular-nums;text-align:right;min-width:86px}
.cbar-val small{display:block;color:var(--muted);font-weight:500;font-size:11px}
@media (max-width:480px){.cbar{grid-template-columns:minmax(0,1fr) auto}.cbar svg{grid-column:1/-1;order:3}}

/* Listas */
.list{display:flex;flex-direction:column}
.row{display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid var(--line-2)}
.row:first-child{border-top:0}
.row-ico{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;font-size:17px;flex:none;background:var(--line-2)}
.row-main{flex:1;min-width:0}
.row-main b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row-main span{font-size:12px;color:var(--muted)}
.row-amt{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.row-amt.in{color:var(--green-ink)}
.row-amt.out{color:var(--ink)}
.tag{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:2px 7px;border-radius:99px;background:var(--line-2);color:var(--ink-2);margin-left:6px;vertical-align:1px}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none}
.empty{color:var(--muted);text-align:center;padding:28px 12px;border:1.5px dashed var(--line);border-radius:12px}
.empty b{display:block;color:var(--ink-2);margin-bottom:4px}

/* Alerta de compromissos */
.alert{border-radius:14px;padding:14px 16px;display:flex;gap:12px;align-items:flex-start;margin-bottom:14px}
.alert.ok{background:var(--green-tint);border:1px solid var(--green-soft)}
.alert.warn{background:var(--amber-soft);border:1px solid #F3DFB5}
.alert b{display:block;font-size:15px}
.alert p{margin:2px 0 0;font-size:13px;color:var(--ink-2)}
.fut svg text{font-family:var(--font)}

/* Formulários */
.form{display:flex;flex-direction:column;gap:14px}
.field{display:flex;flex-direction:column;gap:6px;min-width:0}
.field>label,.flabel{font-size:12px;font-weight:600;color:var(--ink-2)}
.input,select.input{height:42px;border:1px solid var(--line);border-radius:10px;padding:0 12px;background:var(--surface);width:100%;transition:border-color .15s, box-shadow .15s}
.input:focus{outline:none;border-color:var(--green);box-shadow:0 0 0 3px var(--green-soft)}
.fgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
@media (max-width:520px){.fgrid{grid-template-columns:minmax(0,1fr)}}
.seg{display:inline-flex;background:var(--line-2);border-radius:11px;padding:4px;gap:4px}
.seg button{border:0;background:transparent;padding:8px 14px;border-radius:8px;font-weight:600;color:var(--muted)}
.seg button.on{background:var(--surface);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.08)}
.seg button.on.r{color:var(--green-ink)}
.seg button.on.g{color:var(--red)}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:6px 12px;font-size:13px;font-weight:500;display:inline-flex;gap:6px;align-items:center}
.chip:hover{border-color:#B9DEC9}
.chip.on{background:var(--green-soft);border-color:var(--green);color:var(--green-ink);font-weight:600}
.btn{border:0;border-radius:11px;height:44px;padding:0 18px;font-weight:700;background:var(--green);color:#fff;transition:background .15s}
.btn:hover{background:var(--green-ink)}
.btn.ghost{background:var(--surface);color:var(--ink-2);border:1px solid var(--line);height:36px;padding:0 12px;font-weight:600;font-size:13px}
.btn.ghost:hover{background:var(--line-2)}
.btn.sm{height:34px;padding:0 12px;font-size:13px}
.btn.danger{background:var(--red)}
.err{color:var(--red);font-size:13px;font-weight:500;margin:0}
.hint{font-size:12px;color:var(--muted);margin:0}
.preview{background:var(--green-tint);border:1px solid var(--green-soft);border-radius:12px;padding:12px 14px}
.preview b{font-size:16px}
.pmonths{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.pmonths span{font-size:11.5px;font-weight:600;background:var(--surface);border:1px solid var(--green-soft);border-radius:7px;padding:3px 7px;color:var(--green-ink);font-variant-numeric:tabular-nums}
.swatches{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.sw{width:30px;height:30px;border-radius:50%;border:2px solid transparent;box-shadow:inset 0 0 0 2px rgba(255,255,255,.6)}
.sw.on{border-color:var(--ink)}
.colorin{width:38px;height:32px;border:1px solid var(--line);border-radius:8px;padding:2px;background:var(--surface)}
.xbtn{border:0;background:transparent;color:var(--muted);font-size:12px;font-weight:600;padding:6px 8px;border-radius:8px;white-space:nowrap}
.xbtn:hover{background:var(--red-soft);color:var(--red)}
.xbtn.confirm{background:var(--red);color:#fff}

/* Contas previstas */
.row.pending .row-amt{color:var(--muted)}
.row-acts{display:flex;align-items:center;gap:4px;flex:none}
.paybtn{height:30px;padding:0 12px;font-size:12.5px}
.payline{display:flex;align-items:center;gap:6px;flex:none}
.payline .input{width:104px;height:34px;padding:0 8px;text-align:right}
.due{font-weight:600;border-radius:6px;padding:1px 6px;font-size:11.5px}
.due.late{background:var(--red-soft);color:var(--red)}
.due.today{background:var(--amber-soft);color:var(--amber)}
.due.soon{background:var(--line-2);color:var(--ink-2)}
@media (max-width:560px){.row.pending,.row:has(.row-acts){flex-wrap:wrap}.row-acts{margin-left:50px}}

/* Timeline */
.scrollx{overflow-x:auto;margin:0 -4px;padding:0 4px}
.timeline{width:100%;min-width:600px;height:auto;display:block}
.timeline text{font-family:var(--font)}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--ink-2);margin-top:6px}
.legend span{display:inline-flex;align-items:center;gap:6px}
.prog{height:6px;background:var(--line-2);border-radius:99px;overflow:hidden;margin-top:6px}
.prog i{display:block;height:100%;border-radius:99px}

/* Histórico */
.sumrow{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.pill{font-size:12.5px;font-weight:600;padding:6px 10px;border-radius:9px;background:var(--line-2);font-variant-numeric:tabular-nums}
.pill.in{background:var(--green-soft);color:var(--green-ink)}
.pill.out{background:var(--red-soft);color:var(--red)}

/* Dicas */
.tips{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}
.tip h3{margin:0 0 6px;font-size:17px;letter-spacing:-.015em}
.tip p{margin:0 0 10px;color:var(--ink-2);max-width:62ch}
.tip ul{margin:0;padding-left:18px;color:var(--ink-2);display:flex;flex-direction:column;gap:6px}
.tip-ico{width:42px;height:42px;border-radius:12px;background:var(--green-soft);display:grid;place-items:center;font-size:21px;margin-bottom:12px}
.split{display:flex;flex-direction:column;gap:10px;margin:12px 0}
.split-row{display:grid;grid-template-columns:110px minmax(0,1fr) auto;gap:10px;align-items:center;font-size:13px}
.split-row b{font-variant-numeric:tabular-nums;font-weight:600}
.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:700;color:var(--green-ink)}

.toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(24px + env(safe-area-inset-bottom,0px));background:var(--ink);color:#fff;padding:11px 18px;border-radius:12px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.2);z-index:50;display:flex;gap:8px;align-items:center}
@media (max-width:860px){.toast{bottom:calc(84px + env(safe-area-inset-bottom,0px))}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

/* ============================================================
   Ícones (SVG)
   ============================================================ */
const TABS = [
  { id: "overview", label: "Visão Geral", short: "Visão", icon: "home", title: "Visão geral", sub: "Como está o seu dinheiro neste mês" },
  { id: "launch", label: "Lançar", short: "Lançar", icon: "plus", title: "Lançar", sub: "Registre receitas, gastos e compras no cartão" },
  { id: "cards", label: "Cartões", short: "Cartões", icon: "card", title: "Cartões", sub: "Limites, cores e parcelas futuras de cada cartão" },
  { id: "history", label: "Histórico", short: "Histórico", icon: "list", title: "Histórico", sub: "Tudo o que entrou e saiu no mês selecionado" },
  { id: "groups", label: "Grupos", short: "Grupos", icon: "users", title: "Grupos", sub: "Despesas divididas com a família e em viagens", shared: true },
  { id: "tips", label: "Dicas", short: "Dicas", icon: "bulb", title: "Dicas financeiras", sub: "Estratégias simples para organizar e fazer o dinheiro render" },
];

/* ============================================================
   Gráficos em SVG puro
   ============================================================ */
function Sparkline({ values, color, id }) {
  const w = 124, h = 44, p = 5;
  const max = Math.max(...values), min = Math.min(...values, 0);
  const span = max - min || 1;
  const x = (i) => p + (i * (w - 2 * p)) / (values.length - 1);
  const y = (v) => h - p - ((v - min) / span) * (h - 2 * p);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = `M${pts.join(" L")}`;
  const area = `${line} L${x(values.length - 1)},${h - p} L${x(0)},${h - p} Z`;
  const last = values.length - 1;
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Últimos 6 meses">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={p} x2={w - p} y1={h - p} y2={h - p} stroke="#E2E9E4" strokeWidth="1" />
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(values[last])} r="3.5" fill="#fff" stroke={color} strokeWidth="2" />
    </svg>
  );
}

function CategoryBars({ items, total }) {
  if (!items.length) return <div className="empty"><b>Nenhum gasto neste mês</b>Lance um gasto para ver a divisão por categoria.</div>;
  const max = items[0].v;
  return (
    <div className="cbars">
      {items.map((it, i) => (
        <div className="cbar" key={it.cat}>
          <div className="cbar-name"><span>{catOf(it.cat).emoji}</span>{catOf(it.cat).name}</div>
          <HBar pct={(it.v / max) * 100} color={i === 0 ? "#0E9F5A" : i < 3 ? "#4CBF86" : "#A6DCBF"} />
          <div className="cbar-val">{brl(it.v)}<small>{Math.round((it.v / total) * 100)}% do total</small></div>
        </div>
      ))}
    </div>
  );
}

function FutureChart({ months }) {
  const W = 340, H = 150, pt = 22, pb = 26, pl = 4, pr = 4;
  const max = Math.max(...months.map((m) => m.v), 1);
  const bw = (W - pl - pr) / months.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Parcelas nos próximos meses" style={{ display: "block", maxWidth: 520 }}>
      <line x1={pl} x2={W - pr} y1={H - pb} y2={H - pb} stroke="#E2E9E4" />
      {months.map((m, i) => {
        const h = (m.v / max) * (H - pt - pb);
        const x = pl + i * bw + bw * 0.2, w = bw * 0.6;
        return (
          <g key={m.key}>
            <rect x={x} y={H - pb - h} width={w} height={Math.max(h, m.v ? 2 : 0)} rx="4" fill={i === 0 ? "#0E9F5A" : "#9ED8B9"} />
            {m.v > 0 && <text x={x + w / 2} y={H - pb - h - 6} textAnchor="middle" fontSize="10" fontWeight="600" fill="#3B4A41">{brlShort(m.v)}</text>}
            <text x={x + w / 2} y={H - 8} textAnchor="middle" fontSize="10.5" fill="#6B7A71">{shortMonth(m.key)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Timeline({ cards, inst, start, months = 12 }) {
  const keys = Array.from({ length: months }, (_, i) => addM(start, i));
  const stacks = keys.map((k) => cards.map((c) => ({ c, v: sum(inst.filter((i) => i.month === k && i.cardId === c.id)) })));
  const totals = stacks.map((s) => s.reduce((a, b) => a + b.v, 0));
  const max = Math.max(...totals, 1);
  const W = 660, H = 250, pt = 28, pb = 40, pl = 6, pr = 6;
  const bw = (W - pl - pr) / months;
  const plotH = H - pt - pb;
  return (
    <div className="scrollx">
      <svg className="timeline" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Parcelas por mês">
        {[0.5, 1].map((f) => (
          <line key={f} x1={pl} x2={W - pr} y1={H - pb - plotH * f} y2={H - pb - plotH * f} stroke="#EEF3EF" strokeDasharray="3 4" />
        ))}
        <line x1={pl} x2={W - pr} y1={H - pb} y2={H - pb} stroke="#E2E9E4" />
        {keys.map((k, i) => {
          const x = pl + i * bw + bw * 0.2, w = bw * 0.6;
          let y = H - pb;
          return (
            <g key={k}>
              {stacks[i].map(({ c, v }) => {
                if (!v) return null;
                const h = (v / max) * plotH;
                y -= h;
                return <rect key={c.id} x={x} y={y} width={w} height={h} fill={c.color} />;
              })}
              {totals[i] > 0 && <text x={x + w / 2} y={y - 7} textAnchor="middle" fontSize="10.5" fontWeight="600" fill="#3B4A41">{brlShort(totals[i])}</text>}
              <text x={x + w / 2} y={H - pb + 17} textAnchor="middle" fontSize="11" fontWeight={i === 0 ? 700 : 500} fill={i === 0 ? "#0A7A45" : "#6B7A71"}>{MS[monthIdx(k)]}</text>
              {(i === 0 || monthIdx(k) === 0) && <text x={x + w / 2} y={H - pb + 31} textAnchor="middle" fontSize="10" fill="#6B7A71">{yearOf(k)}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ============================================================
   Componentes de UI
   ============================================================ */
function CardVisual({ card, used, onClick }) {
  const pct = Math.min(100, card.limit ? (used / card.limit) * 100 : 0);
  return (
    <div className="ccard" onClick={onClick}
      style={{ background: `linear-gradient(135deg, ${shade(card.color, 0.12)} 0%, ${card.color} 45%, ${shade(card.color, -0.42)} 100%)` }}>
      <div className="ccard-top">
        <span>{card.bank || "Cartão de crédito"}</span>
        <svg width="34" height="24" viewBox="0 0 34 24" aria-hidden="true">
          <rect x="0.5" y="0.5" width="33" height="23" rx="5" fill="#E9C46A" stroke="rgba(0,0,0,.15)" />
          <path d="M0.5 8h11M0.5 16h11M22.5 8h11M22.5 16h11M11.5 0.5v23M22.5 0.5v23" stroke="rgba(0,0,0,.18)" fill="none" />
        </svg>
      </div>
      <div className="ccard-num">•••• •••• •••• {card.last4 || "0000"}</div>
      <div className="ccard-bottom">
        <div className="ccard-row">
          <div><span>{card.name}</span><b className="num">{brl(Math.max(card.limit - used, 0))}</b></div>
          <span className="num">{Math.round(pct)}% usado</span>
        </div>
        <div className="meter"><i style={{ width: `${pct}%` }} /></div>
      </div>
    </div>
  );
}

function CatChips({ type, value, onChange }) {
  return (
    <div className="chips" role="radiogroup">
      {CATS[type].map((c) => (
        <button type="button" key={c.id} className={`chip${value === c.id ? " on" : ""}`} onClick={() => onChange(c.id)} aria-pressed={value === c.id}>
          <span>{c.emoji}</span>{c.name}
        </button>
      ))}
    </div>
  );
}

function TxRow({ t, cards, onDelete, actions }) {
  const c = catOf(t.cat);
  const isInst = !!t.purchaseId;
  const card = isInst ? cards.find((k) => k.id === t.cardId) : null;
  const income = t.type === "receita";
  const pending = !isInst && !isPaid(t);
  const due = pending ? dueLabel(t.date) : null;
  return (
    <div className={`row${pending ? " pending" : ""}`}>
      <div className="row-ico" style={{ background: income ? "var(--green-soft)" : "var(--line-2)" }}>{c.emoji}</div>
      <div className="row-main">
        <b>{t.desc}
          {isInst && <span className="tag"><i className="dot" style={{ background: card ? card.color : "#999" }} />{t.num}/{t.n}</span>}
          {t.recurId && <span className="tag" title="Repete todo mês">🔁</span>}
        </b>
        <span>
          {pending && <span className={`due ${due.cls}`}>{income ? due.txt.replace("Vence", "Previsto").replace("Atrasada", "Atrasado") : due.txt}</span>}
          {pending ? " · " : ""}{c.name} · {isInst ? `${card ? card.name : "Cartão"} · fatura de ${shortMonth(t.month)}` : fmtDate(t.date)}
        </span>
      </div>
      <div className={`row-amt ${income ? "in" : "out"}`}>{income ? "+ " : "− "}{brl(t.amount)}</div>
      {actions}
      {onDelete && onDelete}
    </div>
  );
}

function BillList({ items, cards, acts, emptyText }) {
  if (!items.length) return <div className="empty">{emptyText}</div>;
  return (
    <div className="list">
      {items.map((t) => (
        <TxRow key={t.id} t={t} cards={cards} actions={
          <div className="row-acts">
            <PayInline item={t} onPay={acts.pay} />
            {t.virtual ? <ConfirmX label="Pular" confirmLabel="Pular este mês?" onConfirm={() => acts.skip(t)} /> : <ConfirmX onConfirm={() => acts.remove(t)} />}
          </div>
        } />
      ))}
    </div>
  );
}

/* ============================================================
   Aba: Visão Geral
   ============================================================ */
function Overview({ data, setData, inst, sel, go }) {
  const st = monthStats(data, inst, sel);
  const acts = billActions(setData);
  const last6 = Array.from({ length: 6 }, (_, i) => addM(sel, i - 5));
  const series = last6.map((m) => monthStats(data, inst, m));
  const prev = series[4];
  const delta = (cur, before, inverse) => {
    if (!before) return { cls: "flat", txt: "sem base" };
    const d = ((cur - before) / Math.abs(before)) * 100;
    if (Math.abs(d) < 0.5) return { cls: "flat", txt: "igual ao mês anterior" };
    const good = inverse ? d < 0 : d > 0;
    return { cls: good ? "up" : "down", txt: `${d > 0 ? "+" : ""}${d.toFixed(0)}% vs ${MS[monthIdx(addM(sel, -1))]}` };
  };

  const kpis = [
    { label: "Receitas", value: st.rec, values: series.map((s) => s.rec), color: "#0E9F5A", bg: "var(--green-soft)", icon: "up", d: delta(st.rec, prev.rec), sub: st.recPend > 0 ? `+ ${brl(st.recPend)} ainda a receber` : `${st.tx.filter((t) => t.type === "receita").length} entradas` },
    { label: "Gastos", value: st.gasto, values: series.map((s) => s.gasto), color: "#D64545", bg: "var(--red-soft)", icon: "down", d: delta(st.gasto, prev.gasto, true), sub: st.gastoPend > 0 ? `${brl(st.gastoPend)} ainda a pagar · ${brl(st.parc)} no cartão` : `${brl(st.vista)} à vista · ${brl(st.parc)} no cartão` },
    { label: "Saldo", value: st.saldo, values: series.map((s) => s.saldo), color: "#1F3A5F", bg: "#E8EEF6", icon: "wallet", d: delta(st.saldo, prev.saldo), sub: st.pend.length ? `Previsto no fim do mês: ${brl(st.saldoPrev)}` : st.saldo >= 0 ? "Sobrou dinheiro no mês" : "Gastos acima das receitas" },
  ];

  /* categorias */
  const byCat = {};
  [...st.tx.filter((t) => t.type === "gasto"), ...st.parcelas].forEach((t) => { byCat[t.cat] = r2((byCat[t.cat] || 0) + t.amount); });
  const catItems = Object.entries(byCat).map(([cat, v]) => ({ cat, v })).sort((a, b) => b.v - a.v);

  /* compromissos futuros */
  const futureMonths = Array.from({ length: 6 }, (_, i) => { const key = addM(sel, i + 1); return { key, v: r2(sum(inst.filter((x) => x.month === key)) + monthStats(data, [], key).gastoPend) }; });
  const futureAll = r2(futureMonths.reduce((a, m) => a + m.v, 0));
  const instNext = sum(inst.filter((x) => x.month === addM(sel, 1)));
  const lastMonthWithInst = inst.filter((x) => x.month > sel).reduce((a, x) => (x.month > a ? x.month : a), "");
  const avgRec = series.reduce((a, s) => a + s.rec, 0) / 6 || 0;
  const heavy = instNext > avgRec * 0.3 && avgRec > 0;

  /* meta */
  const saved = Math.max(st.saldo, 0);
  const goalPct = data.goal ? Math.min(100, (saved / data.goal) * 100) : 0;
  const setGoal = (g) => setData((d) => ({ ...d, goal: Math.max(0, Math.round(g)) }));

  /* uso dos cartões */
  const usedOf = (cardId) => sum(inst.filter((x) => x.cardId === cardId && x.month >= sel));

  const recent = [...st.tx, ...st.parcelas].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 7);

  /* contas a pagar e receber: atrasadas e dos próximos 30 dias */
  const today = todayStr();
  const limit = addDays(today, 30);
  const upcoming = [
    ...data.tx.filter((t) => t.status === "previsto"),
    ...virtualOccurrences(data.rec, data.tx, addM(ym(new Date()), -12), limit.slice(0, 7)),
  ].filter((t) => t.date <= limit).sort((a, b) => (a.date < b.date ? -1 : 1));
  const lateCount = upcoming.filter((t) => t.date < today).length;
  const upPay = sum(upcoming.filter((t) => t.type === "gasto"));
  const upRec = sum(upcoming.filter((t) => t.type === "receita"));

  return (
    <div className="stack">
      <div className="grid3">
        {kpis.map((k, i) => (
          <div className="card kpi" key={k.label}>
            <div className="kpi-top">
              <div className="kpi-label"><span className="kpi-ico" style={{ background: k.bg, color: k.color }}><Icon name={k.icon} size={17} /></span>{k.label}</div>
              <span className={`delta ${k.d.cls}`}>{k.d.txt}</span>
            </div>
            <div className="kpi-row">
              <div>
                <div className="kpi-val num" style={i === 2 && k.value < 0 ? { color: "var(--red)" } : null}>{brl(k.value)}</div>
                <div className="kpi-sub">{k.sub}</div>
              </div>
              <Sparkline values={k.values} color={k.color} id={`sp${i}`} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid2">
        <div className="card">
          <div className="card-h"><h2>Seus cartões</h2><button className="btn ghost" onClick={() => go("cards")}>Gerenciar</button></div>
          <div className="ccards">
            {data.cards.map((c) => <CardVisual key={c.id} card={c} used={usedOf(c.id)} onClick={() => go("cards")} />)}
            <div className="ccard add" role="button" tabIndex={0} onClick={() => go("cards")} onKeyDown={(e) => e.key === "Enter" && go("cards")}>
              <Icon name="plus" size={26} />Adicionar cartão
            </div>
          </div>
          <div className="quick">
            <button onClick={() => go("launch", "receita")}><span className="qi" style={{ background: "var(--green-soft)" }}>💰</span>Nova receita</button>
            <button onClick={() => go("launch", "gasto")}><span className="qi" style={{ background: "var(--red-soft)" }}>🧾</span>Novo gasto</button>
            <button onClick={() => go("launch", "cartao")}><span className="qi" style={{ background: "#E8EEF6" }}>💳</span>Compra no cartão</button>
            <button onClick={() => go("history")}><span className="qi" style={{ background: "var(--amber-soft)" }}>📋</span>Ver histórico</button>
          </div>
        </div>

        <div className="card">
          <div className="card-h"><h2>Meta de poupança</h2><small>{monthLabel(sel)}</small></div>
          <div className="goal-val"><b className="num">{brl(saved)}</b><span className="num">de {brl(data.goal)}</span></div>
          <div className="bar" role="progressbar" aria-valuenow={Math.round(goalPct)} aria-valuemin="0" aria-valuemax="100"><i style={{ width: `${goalPct}%` }} /></div>
          <p className="hint">
            {goalPct >= 100 ? "🎉 Meta batida! Considere transferir o excedente para sua reserva." :
              st.saldo <= 0 ? "Neste mês os gastos superaram as receitas. Reveja as maiores categorias ao lado." :
                `Faltam ${brl(data.goal - saved)} para bater a meta · ${Math.round(goalPct)}% concluído`}
          </p>
          <div className="goal-ctl">
            <input id="goal-range" type="range" min="0" max="10000" step="50" value={data.goal} onChange={(e) => setGoal(Number(e.target.value))} aria-label="Ajustar meta" />
            <input id="goal-input" className="input money num" inputMode="numeric" value={data.goal} onChange={(e) => { const v = parseMoney(e.target.value); if (!isNaN(v)) setGoal(v); }} aria-label="Valor da meta" />
          </div>
          {st.rec > 0 && <p className="hint" style={{ marginTop: 10 }}>Pela regra 50-30-20, guardar 20% da receita deste mês seria {brl(st.rec * 0.2)}.
            {" "}<button className="xbtn" style={{ color: "var(--green-ink)" }} onClick={() => setGoal(st.rec * 0.2)}>Usar como meta</button></p>}
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="card-h"><h2>Gastos por categoria</h2><small className="num">Total {brl(st.gasto)}</small></div>
          <CategoryBars items={catItems} total={st.gasto} />
        </div>
        <div className="card fut">
          <div className="card-h"><h2>Compromissos futuros</h2><small>Parcelas e contas previstas</small></div>
          <div className={`alert ${heavy ? "warn" : "ok"}`}>
            <span style={{ color: heavy ? "var(--amber)" : "var(--green)" }}><Icon name={heavy ? "alert" : "check"} size={22} /></span>
            <div>
              <b className="num">{brl(futureAll)} nos próximos 6 meses</b>
              <p>
                {futureAll === 0 ? "Nada previsto para os próximos meses. Seu orçamento está livre." :
                  `${brl(futureMonths[0].v)} já previstos para ${MONTHS[monthIdx(futureMonths[0].key)].toLowerCase()}, somando parcelas do cartão e contas a pagar${lastMonthWithInst ? `. Há parcelas até ${shortMonth(lastMonthWithInst)}` : ""}.`}
                {heavy && ` Só as parcelas de ${MONTHS[monthIdx(futureMonths[0].key)].toLowerCase()} (${brl(instNext)}) passam de 30% da sua receita média. Evite novos parcelamentos por enquanto.`}
              </p>
            </div>
          </div>
          <FutureChart months={futureMonths} />
        </div>
      </div>

      <div className="grid2 even">
        <div className="card">
          <div className="card-h">
            <h2>Contas a pagar e receber</h2>
            <small className="num">Próximos 30 dias{lateCount ? ` · ${lateCount} ${lateCount === 1 ? "atrasada" : "atrasadas"}` : ""}</small>
          </div>
          {upcoming.length > 0 && (
            <div className="sumrow">
              <span className="pill out">A pagar {brl(upPay)}</span>
              <span className="pill in">A receber {brl(upRec)}</span>
            </div>
          )}
          <BillList items={upcoming.slice(0, 8)} cards={data.cards} acts={acts} emptyText="Nenhuma conta prevista para os próximos 30 dias. Em “Lançar”, marque um lançamento como “A pagar” ou faça ele se repetir todo mês." />
          {upcoming.length > 8 && <button className="linkbtn" style={{ marginTop: 8 }} onClick={() => go("history")}>Ver todas no histórico</button>}
        </div>
        <div className="card">
          <div className="card-h"><h2>Últimas transações</h2><button className="btn ghost" onClick={() => go("history")}>Ver todas</button></div>
          {recent.length ? <div className="list">{recent.map((t) => <TxRow key={t.id} t={t} cards={data.cards} />)}</div> :
            <div className="empty"><b>Nada lançado em {monthLabel(sel)}</b>Use “Lançar” para registrar a primeira movimentação.</div>}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Aba: Lançar
   ============================================================ */
function Launch({ data, setData, sel, preset, notify, go }) {
  const isCurrent = sel === ym(new Date());
  const defDate = isCurrent ? todayStr() : `${sel}-01`;

  /* à vista */
  const [kind, setKind] = useState(preset === "receita" ? "receita" : "gasto");
  const [f, setF] = useState({ desc: "", amount: "", date: defDate, cat: "", status: defDate > todayStr() ? "previsto" : "pago", repeat: "nao", count: "12" });
  const [err, setErr] = useState("");
  const acts = billActions(setData);

  /* cartão */
  const [c, setC] = useState({ cardId: data.cards[0] ? data.cards[0].id : "", desc: "", total: "", n: 1, date: defDate, cat: "" });
  const [cErr, setCErr] = useState("");

  useEffect(() => {
    if (preset === "cartao") {
      const el = document.getElementById("form-cartao");
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [preset]);

  const submitTx = (e) => {
    e.preventDefault();
    const amount = parseMoney(f.amount);
    if (!f.desc.trim()) return setErr("Dê uma descrição, por exemplo “Salário” ou “Mercado”.");
    if (!(amount > 0)) return setErr("Informe um valor maior que zero.");
    if (!f.cat) return setErr("Escolha uma categoria.");
    if (!f.date) return setErr("Escolha a data.");
    const count = f.repeat === "n" ? Math.round(Number(f.count)) : null;
    if (f.repeat === "n" && !(count >= 2 && count <= 120)) return setErr("Escolha entre 2 e 120 meses de repetição.");
    const base = { type: kind, desc: f.desc.trim(), amount, cat: f.cat };
    if (f.repeat === "nao") {
      setData((d) => ({ ...d, tx: [...d.tx, { id: uid(), ...base, date: f.date, status: f.status, ...(f.status === "pago" ? { paidDate: todayStr() } : {}) }] }));
    } else {
      const rule = { id: uid(), ...base, day: Number(f.date.slice(8, 10)), start: f.date.slice(0, 7), count, end: null, skipped: [] };
      const firstPaid = f.status === "pago" ? [{ id: uid(), ...base, date: f.date, status: "pago", paidDate: todayStr(), recurId: rule.id, recurMonth: rule.start }] : [];
      setData((d) => ({ ...d, rec: [...(d.rec || []), rule], tx: [...d.tx, ...firstPaid] }));
    }
    setF({ ...f, desc: "", amount: "", cat: "", repeat: "nao" });
    setErr("");
    const word = kind === "receita" ? "Receita" : "Gasto";
    notify(f.repeat !== "nao" ? `${word} de ${brl(amount)} vai se repetir todo mês` : f.status === "previsto" ? `${word} de ${brl(amount)} agendado` : `${word} de ${brl(amount)} ${kind === "receita" ? "lançada" : "lançado"}`);
  };
  const setDate = (date) => setF({ ...f, date, status: date > todayStr() ? "previsto" : f.status });
  const rules = data.rec || [];
  const updRule = (id, patch) => setData((d) => ({ ...d, rec: (d.rec || []).map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const delRule = (id) => setData((d) => ({ ...d, rec: (d.rec || []).filter((r) => r.id !== id) }));

  const card = data.cards.find((k) => k.id === c.cardId);
  const total = parseMoney(c.total);
  const n = Math.max(1, Math.min(48, Number(c.n) || 1));
  const first = card && c.date ? firstInvoiceMonth(c.date, card.closing) : null;
  const preview = total > 0 && first ? expandInstallments([{ id: "pv", cardId: c.cardId, desc: "", cat: "", total, n, date: c.date, firstMonth: first }]) : [];

  const submitCard = (e) => {
    e.preventDefault();
    if (!card) return setCErr("Cadastre um cartão primeiro.");
    if (!c.desc.trim()) return setCErr("Descreva a compra.");
    if (!(total > 0)) return setCErr("Informe o valor total da compra.");
    if (!c.cat) return setCErr("Escolha uma categoria.");
    setData((d) => ({ ...d, purchases: [...d.purchases, { id: uid(), cardId: card.id, desc: c.desc.trim(), total, n, cat: c.cat, date: c.date, firstMonth: first }] }));
    setC({ ...c, desc: "", total: "", n: 1, cat: "" });
    setCErr("");
    notify(n > 1 ? `Compra lançada em ${n}x de ${brl(preview[1] ? preview[1].amount : total / n)}` : `Compra de ${brl(total)} lançada`);
  };

  return (
    <div className="stack">
    <div className="grid2 even">
      <form className="card form" onSubmit={submitTx} noValidate>
        <div className="card-h" style={{ marginBottom: 0 }}><h2>Receita ou gasto à vista</h2></div>
        <div className="seg" role="tablist">
          <button type="button" className={kind === "receita" ? "on r" : ""} onClick={() => { setKind("receita"); setF({ ...f, cat: "" }); }}>💰 Receita</button>
          <button type="button" className={kind === "gasto" ? "on g" : ""} onClick={() => { setKind("gasto"); setF({ ...f, cat: "" }); }}>🧾 Gasto</button>
        </div>
        <div className="field">
          <label htmlFor="tx-desc">Descrição</label>
          <input id="tx-desc" className="input" value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} placeholder={kind === "receita" ? "Ex.: Salário de outubro" : "Ex.: Compras no mercado"} />
        </div>
        <div className="fgrid">
          <div className="field">
            <label htmlFor="tx-amount">Valor (R$)</label>
            <input id="tx-amount" className="input num" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0,00" />
          </div>
          <div className="field">
            <label htmlFor="tx-date">Data</label>
            <input id="tx-date" className="input" type="date" value={f.date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <span className="flabel">Categoria</span>
          <CatChips type={kind} value={f.cat} onChange={(cat) => setF({ ...f, cat })} />
        </div>
        <div className="fgrid">
          <div className="field">
            <span className="flabel">Situação</span>
            <div className="seg">
              <button type="button" className={f.status === "pago" ? "on r" : ""} onClick={() => setF({ ...f, status: "pago" })}>{kind === "receita" ? "Recebido" : "Pago"}</button>
              <button type="button" className={f.status === "previsto" ? "on" : ""} onClick={() => setF({ ...f, status: "previsto" })}>{kind === "receita" ? "A receber" : "A pagar"}</button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="tx-repeat">Repetir</label>
            <select id="tx-repeat" className="input" value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value })}>
              <option value="nao">Não repete</option>
              <option value="sempre">Todo mês, sem data para acabar</option>
              <option value="n">Todo mês, por alguns meses</option>
            </select>
          </div>
          {f.repeat === "n" && (
            <div className="field">
              <label htmlFor="tx-count">Quantos meses</label>
              <input id="tx-count" className="input num" inputMode="numeric" value={f.count} onChange={(e) => setF({ ...f, count: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
            </div>
          )}
        </div>
        {f.repeat !== "nao" && f.date && (
          <p className="hint">
            Repete todo dia {Number(f.date.slice(8, 10))}, a partir de {shortMonth(f.date.slice(0, 7))}
            {f.repeat === "n" && Number(f.count) >= 2 ? ` até ${shortMonth(addM(f.date.slice(0, 7), Number(f.count) - 1))}` : ""}.
            {f.status === "pago" ? " Este mês já entra como pago; os próximos ficam previstos." : " Todos os meses ficam previstos até você marcar como pago."}
          </p>
        )}
        {err && <p className="err">{err}</p>}
        <button className="btn" type="submit">{f.repeat !== "nao" ? "Criar lançamento que se repete" : f.status === "previsto" ? (kind === "receita" ? "Agendar receita" : "Agendar gasto") : kind === "receita" ? "Lançar receita" : "Lançar gasto"}</button>
      </form>

      <form id="form-cartao" className="card form" onSubmit={submitCard} noValidate>
        <div className="card-h" style={{ marginBottom: 0 }}><h2>💳 Compra no cartão de crédito</h2></div>
        {!data.cards.length ? (
          <div className="empty"><b>Você ainda não tem cartões</b>Cadastre um cartão para lançar compras parceladas.
            <div style={{ marginTop: 12 }}><button type="button" className="btn sm" onClick={() => go("cards")}>Cadastrar cartão</button></div></div>
        ) : (
          <>
            <div className="fgrid">
              <div className="field">
                <label htmlFor="cc-card">Cartão</label>
                <select id="cc-card" className="input" value={c.cardId} onChange={(e) => setC({ ...c, cardId: e.target.value })}>
                  {data.cards.map((k) => <option key={k.id} value={k.id}>{k.name}{k.last4 ? ` •${k.last4}` : ""}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="cc-date">Data da compra</label>
                <input id="cc-date" className="input" type="date" value={c.date} onChange={(e) => setC({ ...c, date: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="cc-desc">Descrição</label>
              <input id="cc-desc" className="input" value={c.desc} onChange={(e) => setC({ ...c, desc: e.target.value })} placeholder="Ex.: Smartphone novo" />
            </div>
            <div className="fgrid">
              <div className="field">
                <label htmlFor="cc-total">Valor total (R$)</label>
                <input id="cc-total" className="input num" inputMode="decimal" value={c.total} onChange={(e) => setC({ ...c, total: e.target.value })} placeholder="0,00" />
              </div>
              <div className="field">
                <label htmlFor="cc-n">Parcelas</label>
                <select id="cc-n" className="input" value={n} onChange={(e) => setC({ ...c, n: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, i) => i + 1).map((k) => <option key={k} value={k}>{k === 1 ? "À vista (1x)" : `${k}x`}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <span className="flabel">Categoria</span>
              <CatChips type="gasto" value={c.cat} onChange={(cat) => setC({ ...c, cat })} />
            </div>
            {preview.length > 0 && (
              <div className="preview">
                <div><b className="num">{n}x de {brl(preview[preview.length - 1].amount)}</b>
                  {preview[0].amount !== preview[preview.length - 1].amount && <span className="hint"> (1ª parcela {brl(preview[0].amount)})</span>}</div>
                <p className="hint" style={{ marginTop: 4 }}>
                  Da fatura de {shortMonth(preview[0].month)} até {shortMonth(preview[preview.length - 1].month)}.
                  {card && card.closing ? ` Este cartão fecha no dia ${card.closing}; compras depois disso entram na fatura seguinte.` : ""}
                </p>
                <div className="pmonths">{preview.slice(0, 24).map((p) => <span key={p.id}>{p.num}ª · {shortMonth(p.month)}</span>)}</div>
              </div>
            )}
            {cErr && <p className="err">{cErr}</p>}
            <button className="btn" type="submit">Lançar compra no cartão</button>
          </>
        )}
      </form>
    </div>

    <div className="card">
      <div className="card-h"><h2>Lançamentos que se repetem</h2><small>{rules.length ? `${rules.length} ativos` : ""}</small></div>
      {rules.length ? (
        <div className="list">
          {rules.map((r) => <RuleRow key={r.id} r={r} tx={data.tx} onUpdate={(patch) => { updRule(r.id, patch); notify("Lançamento atualizado"); }} onDelete={() => { delRule(r.id); notify("Repetição excluída. O que já foi pago continua no histórico."); }} />)}
        </div>
      ) : <div className="empty"><b>Nada se repete ainda</b>Ao lançar aluguel, salário ou internet, escolha “Repetir todo mês” e o app prevê os próximos meses sozinho.</div>}
    </div>
    </div>
  );
}

function RuleRow({ r, tx, onUpdate, onDelete }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(String(r.amount).replace(".", ","));
  const c = catOf(r.cat);
  const income = r.type === "receita";
  const last = lastMonthOf(r);
  const paidCount = tx.filter((t) => t.recurId === r.id).length;
  const curM = ym(new Date());
  const ended = last && last < curM;
  const save = () => { const n = parseMoney(v); if (n > 0) { onUpdate({ amount: n }); setEdit(false); } };
  return (
    <div className="row" style={{ flexWrap: "wrap" }}>
      <div className="row-ico" style={{ background: income ? "var(--green-soft)" : "var(--line-2)" }}>{c.emoji}</div>
      <div className="row-main">
        <b>{r.desc}{ended && <span className="tag">Encerrado</span>}</b>
        <span>Todo dia {r.day} · desde {shortMonth(r.start)}{last ? ` até ${shortMonth(last)}` : " · sem data para acabar"} · {paidCount} {income ? (paidCount === 1 ? "recebido" : "recebidos") : (paidCount === 1 ? "pago" : "pagos")}</span>
      </div>
      {!edit ? (
        <>
          <div className={`row-amt ${income ? "in" : "out"}`}>{income ? "+ " : "− "}{brl(r.amount)}</div>
          <div className="row-acts">
            <button type="button" className="xbtn" style={{ color: "var(--ink-2)" }} onClick={() => setEdit(true)}>Alterar valor</button>
            {!ended && (!last || last > curM) && <ConfirmX label="Encerrar" confirmLabel="Parar depois deste mês?" onConfirm={() => onUpdate({ end: curM })} />}
            <ConfirmX onConfirm={onDelete} confirmLabel="Excluir repetição?" />
          </div>
        </>
      ) : (
        <span className="payline">
          <input className="input num" inputMode="decimal" aria-label="Novo valor" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} autoFocus />
          <button type="button" className="btn sm" onClick={save}>Salvar</button>
          <button type="button" className="xbtn" onClick={() => setEdit(false)}>Cancelar</button>
        </span>
      )}
    </div>
  );
}

/* ============================================================
   Aba: Cartões
   ============================================================ */
function Cards({ data, setData, inst, sel, notify }) {
  const [f, setF] = useState({ name: "", bank: "", limit: "", closing: "", last4: "", color: CARD_COLORS[0] });
  const [err, setErr] = useState("");
  const usedOf = (id) => sum(inst.filter((x) => x.cardId === id && x.month >= sel));

  const submit = (e) => {
    e.preventDefault();
    const limit = parseMoney(f.limit);
    const closing = Number(f.closing);
    if (!f.name.trim()) return setErr("Dê um nome ao cartão, por exemplo “Cartão principal”.");
    if (!(limit > 0)) return setErr("Informe o limite total do cartão.");
    if (f.closing && !(closing >= 1 && closing <= 31)) return setErr("O dia de fechamento deve estar entre 1 e 31.");
    const card = { id: uid(), name: f.name.trim(), bank: f.bank.trim(), limit, closing: closing || 31, last4: f.last4.replace(/\D/g, "").slice(-4), color: f.color };
    setData((d) => ({ ...d, cards: [...d.cards, card] }));
    setF({ name: "", bank: "", limit: "", closing: "", last4: "", color: CARD_COLORS[(data.cards.length + 1) % CARD_COLORS.length] });
    setErr("");
    notify(`Cartão “${card.name}” cadastrado`);
  };

  const removeCard = (id) => {
    setData((d) => ({ ...d, cards: d.cards.filter((c) => c.id !== id), purchases: d.purchases.filter((p) => p.cardId !== id) }));
    notify("Cartão excluído");
  };

  const previewCard = { name: f.name || "Nome do cartão", bank: f.bank || "Seu banco", limit: parseMoney(f.limit) || 0, last4: f.last4.slice(-4) || "0000", color: f.color };
  const active = data.purchases.filter((p) => addM(p.firstMonth, p.n - 1) >= sel).sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className="stack">
      <div className="card">
        <div className="card-h"><h2>Parcelas por mês</h2><small>Próximos 12 meses a partir de {monthLabel(sel).toLowerCase()}</small></div>
        {data.cards.length && inst.some((x) => x.month >= sel) ? (
          <>
            <Timeline cards={data.cards} inst={inst} start={sel} />
            <div className="legend">{data.cards.map((c) => <span key={c.id}><i className="dot" style={{ background: c.color }} />{c.name}</span>)}</div>
          </>
        ) : <div className="empty"><b>Sem parcelas a partir deste mês</b>Compras parceladas aparecem aqui distribuídas mês a mês.</div>}
      </div>

      <div className="grid2">
        <div className="card">
          <div className="card-h"><h2>Meus cartões</h2><small>{data.cards.length} {data.cards.length === 1 ? "cartão" : "cartões"}</small></div>
          {data.cards.length ? (
            <div className="stack" style={{ gap: 20 }}>
              {data.cards.map((c) => {
                const used = usedOf(c.id);
                const thisMonth = sum(inst.filter((x) => x.cardId === c.id && x.month === sel));
                return (
                  <div key={c.id} style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                    <CardVisual card={c} used={used} />
                    <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 6 }}>
                      <div className="row" style={{ padding: "4px 0", borderTop: 0 }}><div className="row-main"><span>Limite total</span></div><b className="num">{brl(c.limit)}</b></div>
                      <div className="row" style={{ padding: "4px 0" }}><div className="row-main"><span>Fatura de {shortMonth(sel)}</span></div><b className="num">{brl(thisMonth)}</b></div>
                      <div className="row" style={{ padding: "4px 0" }}><div className="row-main"><span>Comprometido (parcelas abertas)</span></div><b className="num">{brl(used)}</b></div>
                      <div className="row" style={{ padding: "4px 0" }}><div className="row-main"><span>Fecha todo dia</span></div><b className="num">{c.closing}</b></div>
                      <div><ConfirmX label="Excluir cartão" confirmLabel="Excluir cartão e suas compras?" onConfirm={() => removeCard(c.id)} /></div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <div className="empty"><b>Nenhum cartão cadastrado</b>Use o formulário ao lado para adicionar o primeiro.</div>}
        </div>

        <form className="card form" onSubmit={submit} noValidate>
          <div className="card-h" style={{ marginBottom: 0 }}><h2>Novo cartão</h2></div>
          <CardVisual card={previewCard} used={0} />
          <div className="fgrid">
            <div className="field"><label htmlFor="nc-name">Nome</label><input id="nc-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Cartão principal" /></div>
            <div className="field"><label htmlFor="nc-bank">Banco</label><input id="nc-bank" className="input" value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })} placeholder="Nome do banco" /></div>
            <div className="field"><label htmlFor="nc-limit">Limite (R$)</label><input id="nc-limit" className="input num" inputMode="decimal" value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value })} placeholder="5.000,00" /></div>
            <div className="field"><label htmlFor="nc-closing">Dia de fechamento</label><input id="nc-closing" className="input num" inputMode="numeric" value={f.closing} onChange={(e) => setF({ ...f, closing: e.target.value.replace(/\D/g, "").slice(0, 2) })} placeholder="Ex.: 25" /></div>
            <div className="field"><label htmlFor="nc-last4">Final do cartão</label><input id="nc-last4" className="input num" inputMode="numeric" value={f.last4} onChange={(e) => setF({ ...f, last4: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="1234" /></div>
          </div>
          <div className="field">
            <span className="flabel">Cor do cartão</span>
            <div className="swatches">
              {CARD_COLORS.map((col) => <button type="button" key={col} className={`sw${f.color === col ? " on" : ""}`} style={{ background: col }} onClick={() => setF({ ...f, color: col })} aria-label={`Cor ${col}`} />)}
              <input id="nc-color" type="color" className="colorin" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} aria-label="Cor personalizada" />
            </div>
          </div>
          {err && <p className="err">{err}</p>}
          <button className="btn" type="submit">Cadastrar cartão</button>
        </form>
      </div>

      <div className="card">
        <div className="card-h"><h2>Compras parceladas em aberto</h2><small>Situação em {monthLabel(sel).toLowerCase()}</small></div>
        {active.length ? (
          <div className="list">
            {active.map((p) => {
              const card = data.cards.find((k) => k.id === p.cardId);
              const done = Math.max(0, Math.min(p.n, inst.filter((x) => x.purchaseId === p.id && x.month <= sel).length));
              const remaining = sum(inst.filter((x) => x.purchaseId === p.id && x.month > sel));
              return (
                <div className="row" key={p.id}>
                  <div className="row-ico">{catOf(p.cat).emoji}</div>
                  <div className="row-main">
                    <b>{p.desc}<span className="tag"><i className="dot" style={{ background: card ? card.color : "#999" }} />{card ? card.name : "Cartão"}</span></b>
                    <span className="num">{done} de {p.n} parcelas até {shortMonth(sel)} · restam {brl(remaining)} · termina em {shortMonth(addM(p.firstMonth, p.n - 1))}</span>
                    <div className="prog"><i style={{ width: `${(done / p.n) * 100}%`, background: card ? card.color : "#0E9F5A" }} /></div>
                  </div>
                  <div className="row-amt num">{brl(p.total)}</div>
                </div>
              );
            })}
          </div>
        ) : <div className="empty"><b>Nenhuma compra parcelada em aberto</b>Lance uma compra no cartão na aba “Lançar”.</div>}
      </div>
    </div>
  );
}

/* ============================================================
   Aba: Histórico
   ============================================================ */
function History({ data, setData, inst, sel, notify }) {
  const [filter, setFilter] = useState("todas");
  const st = monthStats(data, inst, sel);
  const acts = billActions(setData);
  const txs = st.all
    .filter((t) => filter === "todas" || (filter === "previstos" ? !isPaid(t) : t.type === filter))
    .sort((a, b) => (!isPaid(a) !== !isPaid(b) ? (isPaid(a) ? 1 : -1) : isPaid(a) ? (a.date < b.date ? 1 : -1) : (a.date < b.date ? -1 : 1)));
  const parcelas = [...st.parcelas].sort((a, b) => (a.date < b.date ? 1 : -1));

  const delTx = (id) => { setData((d) => ({ ...d, tx: d.tx.filter((t) => t.id !== id) })); notify("Lançamento excluído"); };
  const delPurchase = (pid) => { setData((d) => ({ ...d, purchases: d.purchases.filter((p) => p.id !== pid) })); notify("Compra e parcelas excluídas"); };

  const byCard = data.cards.map((c) => ({ c, v: sum(st.parcelas.filter((p) => p.cardId === c.id)) })).filter((x) => x.v > 0);

  return (
    <div className="grid2 even">
      <div className="card">
        <div className="card-h">
          <h2>À vista</h2>
          <div className="seg">
            {["todas", "receita", "gasto", "previstos"].map((k) => (
              <button key={k} type="button" className={filter === k ? `on${k === "receita" ? " r" : k === "gasto" ? " g" : ""}` : ""} onClick={() => setFilter(k)}>
                {k === "todas" ? "Todas" : k === "receita" ? "Receitas" : k === "gasto" ? "Gastos" : "Previstos"}
              </button>
            ))}
          </div>
        </div>
        <div className="sumrow">
          <span className="pill in">Recebido {brl(st.rec)}</span>
          <span className="pill out">Pago {brl(st.vista)}</span>
          {st.recPend > 0 && <span className="pill">A receber {brl(st.recPend)}</span>}
          {st.gastoPend > 0 && <span className="pill">A pagar {brl(st.gastoPend)}</span>}
        </div>
        {txs.length ? (
          <div className="list">
            {txs.map((t) => (
              <TxRow key={t.id} t={t} cards={data.cards} actions={
                !isPaid(t) ? (
                  <div className="row-acts">
                    <PayInline item={t} onPay={(item, v) => { acts.pay(item, v); notify(item.type === "receita" ? "Marcado como recebido" : "Marcado como pago"); }} />
                    {t.virtual ? <ConfirmX label="Pular" confirmLabel="Pular este mês?" onConfirm={() => { acts.skip(t); notify("Mês pulado"); }} />
                      : <ConfirmX onConfirm={() => delTx(t.id)} />}
                  </div>
                ) : t.recurId ? (
                  <ConfirmX label="Desfazer" confirmLabel="Voltar para previsto?" onConfirm={() => { acts.undo(t); notify("Voltou para previsto"); }} />
                ) : (
                  <div className="row-acts">
                    {t.paidDate && <ConfirmX label="Desfazer" confirmLabel="Voltar para previsto?" onConfirm={() => { acts.undo(t); notify("Voltou para previsto"); }} />}
                    <ConfirmX onConfirm={() => delTx(t.id)} />
                  </div>
                )
              } />
            ))}
          </div>
        ) : <div className="empty"><b>{filter === "previstos" ? `Nada previsto em ${monthLabel(sel).toLowerCase()}` : `Nenhum lançamento à vista em ${monthLabel(sel)}`}</b>Troque o mês no seletor acima ou lance algo novo.</div>}
      </div>

      <div className="card">
        <div className="card-h"><h2>Parcelas do cartão</h2><small>Faturas de {monthLabel(sel).toLowerCase()}</small></div>
        <div className="sumrow">
          <span className="pill out">Total {brl(st.parc)}</span>
          {byCard.map(({ c, v }) => <span className="pill" key={c.id}><i className="dot" style={{ background: c.color, marginRight: 6 }} />{c.name} {brl(v)}</span>)}
        </div>
        {parcelas.length ? (
          <div className="list">
            {parcelas.map((t) => <TxRow key={t.id} t={t} cards={data.cards} onDelete={<ConfirmX confirmLabel="Excluir compra toda?" onConfirm={() => delPurchase(t.purchaseId)} />} />)}
          </div>
        ) : <div className="empty"><b>Nenhuma parcela neste mês</b>Compras no cartão aparecem aqui no mês de cada fatura.</div>}
      </div>
    </div>
  );
}

/* ============================================================
   Aba: Dicas
   ============================================================ */
function Tips({ data, inst, sel }) {
  const st = monthStats(data, inst, sel);
  const gastos = [...st.tx.filter((t) => t.type === "gasto"), ...st.parcelas];
  const needs = sum(gastos.filter((t) => NEEDS.includes(t.cat)));
  const wants = r2(st.gasto - needs);
  const save = Math.max(r2(st.rec - st.gasto), 0);
  const base = st.rec || 1;
  const rows = [
    { label: "Necessidades", ideal: 50, real: needs, color: "#1F3A5F" },
    { label: "Desejos", ideal: 30, real: wants, color: "#B7791F" },
    { label: "Poupança", ideal: 20, real: save, color: "#0E9F5A" },
  ];
  const last6 = Array.from({ length: 6 }, (_, i) => monthStats(data, inst, addM(sel, i - 5)).gasto);
  const avgGasto = last6.reduce((a, b) => a + b, 0) / 6;

  return (
    <div className="stack">
      <div className="tips">
        <div className="card tip">
          <div className="tip-ico">⚖️</div>
          <span className="eyebrow">Orçamento</span>
          <h3>Regra 50-30-20</h3>
          <p>Divida a renda líquida em três partes: 50% para necessidades (moradia, mercado, transporte, saúde), 30% para desejos (lazer, restaurantes, compras) e 20% para poupar ou quitar dívidas.</p>
          {st.rec > 0 ? (
            <>
              <div className="split">
                {rows.map((r) => {
                  const pct = (r.real / base) * 100;
                  return (
                    <div className="split-row" key={r.label}>
                      <span>{r.label}</span>
                      <HBar pct={Math.min(pct, 100)} color={r.color} />
                      <b>{Math.round(pct)}% <span style={{ color: "var(--muted)", fontWeight: 500 }}>/ {r.ideal}%</span></b>
                    </div>
                  );
                })}
              </div>
              <p className="hint">Seu mês de {MONTHS[monthIdx(sel)].toLowerCase()} comparado ao ideal, com base nos lançamentos do app.</p>
            </>
          ) : <p className="hint">Lance a receita do mês para ver sua divisão real.</p>}
        </div>

        <div className="card tip">
          <div className="tip-ico">🛟</div>
          <span className="eyebrow">Segurança</span>
          <h3>Fundo de emergência</h3>
          <p>É o dinheiro para imprevistos: perda de renda, conserto do carro, uma despesa médica. O alvo comum é de 6 meses do seu custo de vida; para autônomos, 12 meses.</p>
          {avgGasto > 0 && (
            <div className="preview" style={{ margin: "4px 0 12px" }}>
              <span className="hint">Seu gasto médio dos últimos 6 meses é {brl(avgGasto)}.</span>
              <div style={{ marginTop: 4 }}><b className="num">Meta: {brl(avgGasto * 6)}</b></div>
            </div>
          )}
          <ul>
            <li>Guarde em aplicação com liquidez diária e baixo risco.</li>
            <li>Comece com uma meta menor, como 1 mês de gastos, e vá subindo.</li>
            <li>Usou a reserva? Priorize recompor antes de novos objetivos.</li>
          </ul>
        </div>

        <div className="card tip">
          <div className="tip-ico">🌱</div>
          <span className="eyebrow">Investimentos</span>
          <h3>Como investir com pouco</h3>
          <p>Não é preciso ter muito para começar. O que faz diferença é a constância e deixar o tempo trabalhar a seu favor com juros compostos.</p>
          <ul>
            <li><b>Tesouro Selic:</b> título público, aceita aportes a partir de cerca de R$ 30 e tem liquidez diária.</li>
            <li><b>CDB com liquidez diária:</b> prefira os que rendem 100% do CDI ou mais e têm garantia do FGC.</li>
            <li><b>Automatize:</b> agende uma transferência no dia do salário, antes de gastar.</li>
            <li>Só pense em renda variável depois da reserva de emergência pronta.</li>
          </ul>
        </div>

        <div className="card tip">
          <div className="tip-ico">💳</div>
          <span className="eyebrow">Cartão de crédito</span>
          <h3>Parcelamento consciente</h3>
          <p>Cada parcela é um pedaço do salário de um mês futuro. Some as parcelas antes de assumir uma nova.</p>
          <ul>
            <li>Mantenha as parcelas abaixo de 30% da renda mensal.</li>
            <li>Nunca pague só o mínimo da fatura: os juros do rotativo estão entre os mais altos do mercado.</li>
            <li>Compre logo após o fechamento para ganhar quase 40 dias até o vencimento.</li>
            <li>Peça desconto à vista; muitas vezes compensa mais que parcelar.</li>
          </ul>
        </div>

        <div className="card tip">
          <div className="tip-ico">🔍</div>
          <span className="eyebrow">Hábitos</span>
          <h3>Pequenos vazamentos</h3>
          <p>Assinaturas esquecidas, delivery frequente e tarifas bancárias somam muito no ano.</p>
          <ul>
            <li>Revise as assinaturas a cada 3 meses e cancele o que não usa.</li>
            <li>Use a regra das 48 horas antes de compras por impulso.</li>
            <li>Defina um teto mensal para restaurantes e lazer.</li>
          </ul>
        </div>

        <div className="card tip">
          <div className="tip-ico">🎯</div>
          <span className="eyebrow">Objetivos</span>
          <h3>Metas com prazo</h3>
          <p>Transforme desejos em metas com valor e data. “Viajar” vira “R$ 6.000 até dezembro de 2027”, ou R$ 430 por mês.</p>
          <ul>
            <li>Separe uma conta ou caixinha para cada objetivo.</li>
            <li>Acompanhe a meta de poupança na Visão Geral todo mês.</li>
            <li>Comemore marcos no caminho para manter a motivação.</li>
          </ul>
        </div>
      </div>
      <p className="hint">Conteúdo educativo e geral. Para decisões específicas de investimento, consulte um profissional certificado.</p>
    </div>
  );
}

/* ============================================================
   App
   ============================================================ */
export default function App() {
  const [data, setData] = useStored(STORAGE_KEY, makeSample);
  const [tab, setTab] = useState(() => {
    try { return new URLSearchParams(location.search).get("convite") ? "groups" : "overview"; } catch (e) { return "overview"; }
  });
  const [preset, setPreset] = useState("");
  const [sel, setSel] = useState(ym(new Date()));
  const [toast, setToast] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    try { window.scrollTo(0, 0); } catch (e) { /* ignora */ }
  }, [tab]);

  const inst = expandInstallments(data.purchases || []);
  if (!data.rec) data.rec = [];
  const go = (t, p = "") => { setPreset(p); setTab(t); };
  const meta = TABS.find((t) => t.id === tab);
  const cur = ym(new Date());

  const body = {
    overview: <Overview data={data} setData={setData} inst={inst} sel={sel} go={go} />,
    launch: <Launch key={preset || "x"} data={data} setData={setData} sel={sel} preset={preset} notify={setToast} go={go} />,
    cards: <Cards data={data} setData={setData} inst={inst} sel={sel} notify={setToast} />,
    history: <History data={data} setData={setData} inst={inst} sel={sel} notify={setToast} />,
    tips: <Tips data={data} inst={inst} sel={sel} />,
    groups: <GroupsSection sel={sel} setSel={setSel} notify={setToast} />,
  }[tab];

  return (
    <div className="app">
      <style>{css}</style>

      <aside className="side">
        <div className="brand">
          <span className="brand-mark">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17 10 11l4 4 6-7" /><path d="M15 8h5v5" /></svg>
          </span>
          Saldo Verde
        </div>
        <nav className="nav" aria-label="Seções">
          <div className="nav-label">Pessoal</div>
          {TABS.filter((t) => !t.shared).map((t) => (
            <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => go(t.id)} aria-current={tab === t.id ? "page" : undefined}>
              <Icon name={t.icon} />{t.label}
            </button>
          ))}
          <div className="nav-label" style={{ marginTop: 14 }}>Compartilhado</div>
          {TABS.filter((t) => t.shared).map((t) => (
            <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => go(t.id)} aria-current={tab === t.id ? "page" : undefined}>
              <Icon name={t.icon} />{t.label}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <b>Seus dados, do seu jeito</b>
          O controle pessoal fica só neste aparelho. Os grupos sincronizam pela nuvem.
        </div>
      </aside>

      <main className="main">
        {tab !== "groups" && <header className="top">
          <div>
            <h1>{meta.title}</h1>
            <p>{meta.sub}</p>
          </div>
          <div className="picker" aria-label="Selecionar mês">
            <button onClick={() => setSel(addM(sel, -1))} aria-label="Mês anterior"><Icon name="left" size={18} /></button>
            <span className="lbl num">{monthLabel(sel)}</span>
            <button onClick={() => setSel(addM(sel, 1))} aria-label="Próximo mês"><Icon name="right" size={18} /></button>
            {sel !== cur && <button className="today" onClick={() => setSel(cur)}>Hoje</button>}
          </div>
        </header>}

        {data.sample && tab !== "groups" && (
          <div className="banner">
            <p>📝 Você está vendo <b>dados de exemplo</b> para explorar o app. Quando quiser, apague tudo e comece com seus próprios lançamentos.</p>
            <div className="btns">
              <button className={`btn sm${confirmClear ? " danger" : ""}`}
                onClick={() => { if (confirmClear) { setData(EMPTY); setConfirmClear(false); setToast("Pronto! Comece lançando sua primeira receita."); } else setConfirmClear(true); }}>
                {confirmClear ? "Confirmar: apagar exemplos" : "Começar do zero"}
              </button>
              <button className="btn ghost" onClick={() => setData((d) => ({ ...d, sample: false }))}>Manter e ocultar aviso</button>
            </div>
          </div>
        )}

        {body}
      </main>

      <nav className="bnav" aria-label="Seções">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => go(t.id)}>
            <Icon name={t.icon} size={21} />{t.short}
          </button>
        ))}
      </nav>

      {toast && <div className="toast" role="status"><Icon name="check" size={18} />{toast}</div>}
    </div>
  );
}
