import React, { useState, useEffect } from "react";
import { sb, appUrl } from "./lib/supabase.js";
import {
  MONTHS, MS, pad, ym, todayStr, addM, monthIdx, yearOf, monthLabel, shortMonth,
  r2, money, fmtDate, parseMoney, Icon, HBar, ConfirmX,
} from "./shared.jsx";

/* ============================================================
   Grupos compartilhados: Casa/Família e Viagem
   ============================================================ */

export const GCATS = {
  casa: [
    { id: "moradia", emoji: "🏠", name: "Moradia" },
    { id: "contas", emoji: "💡", name: "Contas da casa" },
    { id: "mercado", emoji: "🛒", name: "Mercado" },
    { id: "limpeza", emoji: "🧽", name: "Limpeza" },
    { id: "filhos", emoji: "🧸", name: "Filhos" },
    { id: "escola", emoji: "🎒", name: "Escola" },
    { id: "saude", emoji: "💊", name: "Saúde" },
    { id: "transporte", emoji: "🚗", name: "Transporte" },
    { id: "pets", emoji: "🐾", name: "Pets" },
    { id: "lazer", emoji: "🎬", name: "Lazer" },
    { id: "mesada", emoji: "🪙", name: "Mesada" },
    { id: "outros", emoji: "📦", name: "Outros" },
  ],
  viagem: [
    { id: "hospedagem", emoji: "🏨", name: "Hospedagem" },
    { id: "transporte", emoji: "✈️", name: "Passagens e transporte" },
    { id: "refeicoes", emoji: "🍽️", name: "Refeições" },
    { id: "mercado", emoji: "🛒", name: "Mercado" },
    { id: "passeios", emoji: "🎟️", name: "Passeios" },
    { id: "combustivel", emoji: "⛽", name: "Combustível" },
    { id: "compras", emoji: "🛍️", name: "Compras" },
    { id: "outros", emoji: "📦", name: "Outros" },
  ],
};
const gcat = (kind, id) => (GCATS[kind] || []).find((c) => c.id === id) || { emoji: "📦", name: "Outros" };
const CURRENCIES = [["BRL", "Real (R$)"], ["USD", "Dólar (US$)"], ["EUR", "Euro (€)"], ["ARS", "Peso argentino"], ["CLP", "Peso chileno"], ["UYU", "Peso uruguaio"], ["GBP", "Libra (£)"]];
const EMOJIS = { casa: ["🏠", "🏡", "👨‍👩‍👧", "💚", "🐾"], viagem: ["✈️", "🏖️", "🏔️", "🚗", "🗺️", "🎒"] };
const AV = ["#0E9F5A", "#1F3A5F", "#7A3FD1", "#D9480F", "#0B7285", "#C2255C", "#B08900", "#343A40"];
const INVITE_KEY = "saldo-verde-convite";

/* ---------- Cálculos (funções puras) ---------- */

/* Divide um valor entre pessoas. Centavos que sobram vão para quem tem a maior fração. */
export function computeSplits(amount, ids, mode, weights = {}, manual = {}, cur = "BRL") {
  if (!(amount > 0)) return { splits: [], error: "Informe o valor da despesa." };
  if (!ids.length) return { splits: [], error: "Escolha quem divide esta despesa." };
  if (mode === "valor") {
    const splits = ids.map((id) => ({ member_id: id, amount: r2(parseMoney(manual[id] ?? "") || 0) }));
    const diff = r2(amount - splits.reduce((a, s) => a + s.amount, 0));
    const error = Math.abs(diff) < 0.01 ? "" : diff > 0 ? `Faltam ${money(diff, cur)} para fechar a divisão.` : `A divisão passou ${money(-diff, cur)} do valor.`;
    return { splits, diff, error };
  }
  const w = ids.map((id) => (mode === "proporcao" ? Math.max(0, Number(String(weights[id] ?? 0).replace(",", ".")) || 0) : 1));
  const tw = w.reduce((a, b) => a + b, 0);
  if (tw <= 0) return { splits: [], error: "Defina a proporção de pelo menos uma pessoa." };
  const cents = Math.round(amount * 100);
  const raw = w.map((x) => (cents * x) / tw);
  const base = raw.map(Math.floor);
  const rest = cents - base.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - base[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < rest; k++) base[order[k % order.length][1]] += 1;
  return { splits: ids.map((id, i) => ({ member_id: id, amount: base[i] / 100 })), diff: 0, error: "" };
}

/* Saldo de cada pessoa: positivo = tem a receber; negativo = deve. */
export function balancesOf(members, expenses, settlements) {
  const b = {};
  members.forEach((m) => { b[m.id] = 0; });
  expenses.forEach((e) => {
    if (e.status === "previsto") return;
    b[e.paid_by] = (b[e.paid_by] || 0) + Number(e.amount);
    (e.expense_splits || []).forEach((s) => { b[s.member_id] = (b[s.member_id] || 0) - Number(s.amount); });
  });
  settlements.forEach((s) => {
    b[s.from_member] = (b[s.from_member] || 0) + Number(s.amount);
    b[s.to_member] = (b[s.to_member] || 0) - Number(s.amount);
  });
  Object.keys(b).forEach((k) => { b[k] = r2(b[k]); });
  return b;
}

/* Menor conjunto prático de transferências para zerar todos os saldos. */
export function simplify(bal) {
  const cred = Object.entries(bal).filter(([, v]) => v > 0.004).map(([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v);
  const deb = Object.entries(bal).filter(([, v]) => v < -0.004).map(([id, v]) => ({ id, v: -v })).sort((a, b) => b.v - a.v);
  const out = [];
  let i = 0, j = 0;
  while (i < deb.length && j < cred.length) {
    const x = r2(Math.min(deb[i].v, cred[j].v));
    if (x > 0) out.push({ from: deb[i].id, to: cred[j].id, amount: x });
    deb[i].v = r2(deb[i].v - x);
    cred[j].v = r2(cred[j].v - x);
    if (deb[i].v < 0.005) i++;
    if (cred[j].v < 0.005) j++;
  }
  return out;
}

const mk = (d) => String(d || "").slice(0, 7);
const daysInM = (m) => new Date(yearOf(m), monthIdx(m) + 1, 0).getDate();
const ruleLast = (r) => {
  const byCount = r.months ? addM(mk(r.start_month), r.months - 1) : null;
  const end = r.end_month ? mk(r.end_month) : null;
  if (byCount && end) return byCount < end ? byCount : end;
  return byCount || end || null;
};

/* Meses ainda não pagos das contas fixas do grupo, entre dois meses (inclusive). */
export function groupVirtuals(recurring, expenses, fromM, toM) {
  const out = [];
  (recurring || []).forEach((r) => {
    const start = mk(r.start_month);
    const last = ruleLast(r);
    const skipped = (r.skipped || []).map(mk);
    let m = start > fromM ? start : fromM;
    for (let guard = 0; m <= toM && guard < 240; guard++, m = addM(m, 1)) {
      if (last && m > last) break;
      if (skipped.includes(m)) continue;
      if (expenses.some((e) => e.recurring_id === r.id && mk(e.occurrence) === m)) continue;
      out.push({
        id: `v-${r.id}-${m}`, virtual: true, rule: r, recurring_id: r.id, occurrence: `${m}-01`, status: "previsto",
        description: r.description, amount: Number(r.amount), category: r.category, paid_by: r.paid_by, for_member: r.for_member,
        date: `${m}-${pad(Math.min(r.day, daysInM(m)))}`, expense_splits: [],
      });
    }
  });
  return out;
}

function dueTxt(date) {
  const t = todayStr();
  if (date < t) return { cls: "late", txt: "Atrasada" };
  if (date === t) return { cls: "today", txt: "Vence hoje" };
  const days = Math.round((new Date(date) - new Date(t)) / 864e5);
  return { cls: "soon", txt: days <= 7 ? `Vence em ${days} ${days === 1 ? "dia" : "dias"}` : `Vence ${fmtDate(date).slice(0, 5)}` };
}

function errMsg(e) {
  const m = (e && (e.message || e.error_description)) || String(e || "");
  if (/Invalid login/i.test(m)) return "E-mail ou senha incorretos.";
  if (/Email not confirmed/i.test(m)) return "Confirme seu e-mail pelo link que enviamos antes de entrar.";
  if (/already registered|already been registered|already exists/i.test(m)) return "Este e-mail já tem conta. Use “Entrar”.";
  if (/Password should be|at least 6/i.test(m)) return "A senha precisa ter pelo menos 6 caracteres.";
  if (/invalid.*email|Unable to validate email/i.test(m)) return "Confira o e-mail digitado.";
  if (/Failed to fetch|NetworkError|network|Load failed/i.test(m)) return "Não foi possível falar com o servidor do app. Confira a internet e, se ela estiver ok, feche e abra o app de novo.";
  if (/rate limit|too many/i.test(m)) return "Muitas tentativas seguidas. Aguarde alguns minutos.";
  if (/expenses_recurring_id_occurrence_key|duplicate key/i.test(m)) return "Essa conta já foi registrada como paga por alguém do grupo.";
  if (/foreign key/i.test(m)) return "Esta pessoa tem despesas ou pagamentos no grupo e não pode ser removida.";
  if (/row-level security|permission denied/i.test(m)) return "Você não tem permissão para fazer isso neste grupo.";
  return m || "Algo deu errado. Tente de novo.";
}

const initials = (name) => (name || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
const colorFor = (members, id) => AV[Math.max(0, members.findIndex((m) => m.id === id)) % AV.length];

function Avatar({ name, color, sm }) {
  return <span className={`avatar${sm ? " sm" : ""}`} style={{ background: color }} aria-hidden="true">{initials(name)}</span>;
}

/* ---------- Estilos da área de grupos ---------- */
const gcss = `
.g-wrap{display:flex;flex-direction:column;gap:18px}
.g-top{display:flex;flex-direction:column;gap:14px}
.g-bar{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;flex-wrap:wrap}
.back{border:0;background:transparent;color:var(--green-ink);font-weight:600;display:inline-flex;align-items:center;gap:2px;padding:4px 8px 4px 0;align-self:flex-start}
.g-title{display:flex;align-items:center;gap:14px;min-width:0}
.g-title h1{margin:0;font-size:24px;font-weight:800;letter-spacing:-.025em;text-wrap:balance}
.g-title p{margin:2px 0 0;color:var(--muted)}
.g-emoji{width:52px;height:52px;border-radius:16px;background:var(--surface);box-shadow:var(--shadow);display:grid;place-items:center;font-size:26px;flex:none}
.g-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.g-tabs{overflow-x:auto;max-width:100%}
.g-tabs .seg{white-space:nowrap}
.g-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.g-item{display:flex;gap:14px;align-items:center;text-align:left;border:0;width:100%;transition:transform .15s}
.g-item:hover{transform:translateY(-1px)}
.g-item .g-emoji{box-shadow:none;background:var(--green-tint)}
.g-item b{display:block;font-size:15px}
.g-item small{color:var(--muted)}
.g-pos{font-size:12.5px;font-weight:600;margin-top:3px}
.pos{color:var(--green-ink)}.neg{color:var(--red)}.zero{color:var(--muted)}
.avatar{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:700;font-size:13px;flex:none}
.avatar.sm{width:26px;height:26px;font-size:10.5px}
.mine{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.mine b{font-size:22px;font-weight:800;letter-spacing:-.02em;display:block}
.mine small{color:var(--muted)}
.day{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);padding:14px 0 2px}
.day:first-child{padding-top:0}
.row.click{cursor:pointer}
.row.click:hover .row-main b{color:var(--green-ink)}
.row-side{text-align:right;flex:none}
.row-side b{display:block;font-variant-numeric:tabular-nums}
.row-side small{display:block;font-size:11.5px;font-weight:600;font-variant-numeric:tabular-nums}
.bal{display:grid;grid-template-columns:auto minmax(0,1fr) minmax(90px,38%) auto;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--line-2)}
.bal:first-child{border-top:0}
.bal-name b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bal-name small{color:var(--muted);font-size:12px}
.bal-val{font-weight:700;font-variant-numeric:tabular-nums;text-align:right;min-width:92px}
@media (max-width:520px){.bal{grid-template-columns:auto minmax(0,1fr) auto}.bal svg{display:none}}
.transfer{display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid var(--line);border-radius:12px;flex-wrap:wrap}
.transfer .who{display:flex;align-items:center;gap:8px;flex:1;min-width:210px;font-weight:600;flex-wrap:wrap}
.transfer .who span{color:var(--muted);font-weight:500}
.transfers{display:flex;flex-direction:column;gap:10px}
.code-box{display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--green-tint);border:1.5px dashed #B9DEC9;border-radius:14px;padding:14px 16px;flex-wrap:wrap}
.code-box code{font-size:24px;font-weight:800;letter-spacing:.18em;color:var(--green-ink);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.btnrow{display:flex;gap:8px;flex-wrap:wrap}
.sheet-bg{position:fixed;inset:0;background:rgba(15,28,21,.45);z-index:60;display:flex;align-items:flex-end;justify-content:center;
  padding:calc(16px + env(safe-area-inset-top,0px)) max(0px, env(safe-area-inset-right,0px)) 0 max(0px, env(safe-area-inset-left,0px))}
.sheet{background:var(--surface);width:100%;max-width:600px;max-height:100%;overflow:auto;border-radius:22px 22px 0 0;
  padding:18px max(18px, env(safe-area-inset-right,0px)) calc(22px + env(safe-area-inset-bottom,0px)) max(18px, env(safe-area-inset-left,0px));box-shadow:0 -12px 40px rgba(0,0,0,.18);overscroll-behavior:contain}
@media (min-width:720px){.sheet-bg{align-items:center;padding:24px}.sheet{border-radius:20px;padding:22px}}
.sheet-h{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}
.sheet-h h2{margin:0;font-size:18px;letter-spacing:-.015em}
.iconbtn{border:0;background:var(--line-2);width:36px;height:36px;border-radius:10px;display:grid;place-items:center;flex:none}
.who-list{display:flex;flex-direction:column;gap:6px}
.who-row{display:flex;gap:10px;align-items:center;padding:8px 10px;border:1px solid var(--line);border-radius:11px;cursor:pointer}
.who-row.off{opacity:.55}
.who-row input[type=checkbox]{width:18px;height:18px;accent-color:var(--green);flex:none;margin:0}
.who-row .nm{flex:1;min-width:0;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.who-row .mini{width:92px;height:34px;padding:0 8px;text-align:right}
.who-amt{font-weight:600;font-variant-numeric:tabular-nums;min-width:84px;text-align:right}
.auth{max-width:460px;margin:0 auto;width:100%}
.auth-hero{display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px;margin-bottom:6px}
.auth-hero h1{margin:0;font-size:24px;font-weight:800;letter-spacing:-.025em}
.auth-hero p{margin:0;color:var(--muted);max-width:40ch}
.perks{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:6px 0 4px}
.perk{background:var(--surface);border-radius:12px;padding:10px 12px;font-size:12.5px;color:var(--ink-2);box-shadow:var(--shadow)}
.perk b{display:block;font-size:13px;color:var(--ink)}
.linkbtn{border:0;background:transparent;color:var(--green-ink);font-weight:600;padding:4px 0;text-decoration:underline;text-underline-offset:3px}
.toggle{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:500;cursor:pointer}
.toggle input{width:18px;height:18px;accent-color:var(--green);margin:0}
.pchips{display:flex;flex-wrap:wrap;gap:8px}
.pchip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:99px;padding:4px 5px 4px 12px;font-size:13px;background:var(--surface)}
.pchip button{border:0;background:var(--line-2);border-radius:99px;font-size:11px;padding:4px 9px;font-weight:600;color:var(--ink-2)}
.pchip button.on{background:var(--amber-soft);color:var(--amber)}
.addline{display:flex;gap:8px}
.addline .input{flex:1}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
.tile{background:var(--bg);border-radius:12px;padding:12px 14px;min-width:0}
.tile small{color:var(--muted);display:block;font-size:12px}
.tile b{font-size:19px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.mrow{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--line-2);flex-wrap:wrap}
.mrow:first-child{border-top:0}
.mrow .row-main{min-width:150px}
.medit{flex-basis:100%;display:flex;flex-direction:column;gap:10px;background:var(--bg);border-radius:12px;padding:12px}
.emojis{display:flex;gap:6px;flex-wrap:wrap}
.emojis button{width:42px;height:42px;border-radius:11px;border:1px solid var(--line);background:var(--surface);font-size:20px}
.emojis button.on{border-color:var(--green);background:var(--green-soft)}
.note{background:var(--bg);border-radius:12px;padding:12px 14px;font-size:13px;color:var(--ink-2)}
`;

/* ============================================================
   Sessão de login
   ============================================================ */
function useSession() {
  const [session, setSession] = useState(undefined);
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    if (!sb) { setSession(null); return; }
    let alive = true;
    sb.auth.getSession().then(({ data }) => { if (alive) setSession(data.session || null); });
    const { data: sub } = sb.auth.onAuthStateChange((ev, s) => {
      setSession(s || null);
      if (ev === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);
  return [session, recovery, setRecovery];
}

/* ============================================================
   Entrada da seção
   ============================================================ */
export function GroupsSection({ sel, setSel, notify }) {
  const [session, recovery, setRecovery] = useSession();
  const [openId, setOpenId] = useState(null);
  const [invite, setInvite] = useState(() => {
    try {
      const q = new URLSearchParams(location.search).get("convite");
      if (q) {
        localStorage.setItem(INVITE_KEY, q.toUpperCase());
        history.replaceState(null, "", location.pathname + location.hash);
        return q.toUpperCase();
      }
      return localStorage.getItem(INVITE_KEY) || "";
    } catch (e) { return ""; }
  });
  const clearInvite = () => { try { localStorage.removeItem(INVITE_KEY); } catch (e) { /* ignora */ } setInvite(""); };

  return (
    <>
      <style>{gcss}</style>
      {!sb ? <NoCloud /> :
        session === undefined ? <div className="card empty">Carregando…</div> :
          recovery && session ? <NewPassword onDone={() => setRecovery(false)} notify={notify} /> :
            !session ? <AuthScreen invite={invite} /> :
              openId ? <GroupView key={openId} id={openId} session={session} sel={sel} setSel={setSel} onBack={() => setOpenId(null)} notify={notify} /> :
                <GroupsHome session={session} onOpen={setOpenId} notify={notify} invite={invite} clearInvite={clearInvite} />}
    </>
  );
}

function NoCloud() {
  return (
    <div className="g-wrap">
      <div className="top" style={{ marginBottom: 0 }}><div><h1>Grupos</h1><p>Divida despesas da casa e de viagens</p></div></div>
      <div className="card empty" style={{ textAlign: "left" }}>
        <b>A conexão com a nuvem ainda não foi configurada</b>
        Para usar grupos compartilhados, preencha o endereço e a chave pública do projeto no arquivo <code>config.js</code>.
        Seu controle pessoal continua funcionando normalmente.
      </div>
    </div>
  );
}

/* ============================================================
   Login, cadastro e recuperação de senha
   ============================================================ */
function AuthScreen({ invite }) {
  const [mode, setMode] = useState("entrar");
  const [f, setF] = useState({ name: "", email: "", pass: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setInfo("");
    const email = f.email.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr("Digite um e-mail válido.");
    if (mode !== "esqueci" && f.pass.length < 6) return setErr("A senha precisa ter pelo menos 6 caracteres.");
    if (mode === "criar" && !f.name.trim()) return setErr("Diga como você quer ser chamado nos grupos.");
    setBusy(true);
    try {
      if (mode === "entrar") {
        const { error } = await sb.auth.signInWithPassword({ email, password: f.pass });
        if (error) throw error;
      } else if (mode === "criar") {
        const { data, error } = await sb.auth.signUp({ email, password: f.pass, options: { data: { name: f.name.trim() }, emailRedirectTo: appUrl() } });
        if (error) throw error;
        if (!data.session) setInfo(`Enviamos um link de confirmação para ${email}. Abra o e-mail, toque no link e depois entre aqui.`);
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
        if (error) throw error;
        setInfo(`Se existir uma conta com ${email}, você vai receber um link para criar uma nova senha.`);
      }
    } catch (e2) { setErr(errMsg(e2)); }
    setBusy(false);
  };

  return (
    <div className="auth g-wrap">
      <div className="auth-hero">
        <span className="g-emoji">👨‍👩‍👧</span>
        <h1>Grupos compartilhados</h1>
        <p>{invite ? "Você recebeu um convite. Entre ou crie sua conta para participar do grupo." : "Divida as despesas da casa e das viagens e veja na hora quem pagou o quê."}</p>
      </div>
      {!invite && (
        <div className="perks">
          <div className="perk"><b>🏠 Casa e família</b>Contas divididas por igual ou pela renda de cada um.</div>
          <div className="perk"><b>✈️ Viagens</b>Cada gasto dividido só entre quem participou.</div>
          <div className="perk"><b>🤝 Acertos</b>O app calcula quem paga quem para todos ficarem quites.</div>
        </div>
      )}
      <form className="card form" onSubmit={submit} noValidate>
        {mode !== "esqueci" ? (
          <div className="seg" style={{ alignSelf: "flex-start" }}>
            <button type="button" className={mode === "entrar" ? "on" : ""} onClick={() => { setMode("entrar"); setErr(""); setInfo(""); }}>Entrar</button>
            <button type="button" className={mode === "criar" ? "on" : ""} onClick={() => { setMode("criar"); setErr(""); setInfo(""); }}>Criar conta</button>
          </div>
        ) : <div className="card-h" style={{ marginBottom: 0 }}><h2>Criar nova senha</h2></div>}
        {mode === "criar" && (
          <div className="field"><label htmlFor="au-name">Seu nome</label>
            <input id="au-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Como os outros vão te ver" autoComplete="name" /></div>
        )}
        <div className="field"><label htmlFor="au-email">E-mail</label>
          <input id="au-email" className="input" type="email" inputMode="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="voce@email.com" /></div>
        {mode !== "esqueci" && (
          <div className="field"><label htmlFor="au-pass">Senha</label>
            <input id="au-pass" className="input" type="password" autoComplete={mode === "criar" ? "new-password" : "current-password"} value={f.pass} onChange={(e) => setF({ ...f, pass: e.target.value })} placeholder="Mínimo de 6 caracteres" /></div>
        )}
        {err && <p className="err">{err}</p>}
        {info && <div className="preview"><p className="hint" style={{ color: "var(--ink-2)" }}>{info}</p></div>}
        <button className="btn" type="submit" disabled={busy}>{busy ? "Aguarde…" : mode === "entrar" ? "Entrar" : mode === "criar" ? "Criar conta" : "Enviar link"}</button>
        {mode === "entrar" && <button type="button" className="linkbtn" onClick={() => { setMode("esqueci"); setErr(""); setInfo(""); }}>Esqueci minha senha</button>}
        {mode === "esqueci" && <button type="button" className="linkbtn" onClick={() => { setMode("entrar"); setErr(""); setInfo(""); }}>Voltar para o login</button>}
      </form>
      <p className="hint" style={{ textAlign: "center" }}>Seu controle pessoal continua salvo só neste aparelho. Apenas os grupos ficam na nuvem.</p>
    </div>
  );
}

function NewPassword({ onDone, notify }) {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    if (pass.length < 6) return setErr("A senha precisa ter pelo menos 6 caracteres.");
    const { error } = await sb.auth.updateUser({ password: pass });
    if (error) return setErr(errMsg(error));
    notify("Senha alterada");
    onDone();
  };
  return (
    <form className="auth card form" onSubmit={submit} noValidate>
      <div className="card-h" style={{ marginBottom: 0 }}><h2>Escolha uma nova senha</h2></div>
      <div className="field"><label htmlFor="np-pass">Nova senha</label>
        <input id="np-pass" className="input" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} /></div>
      {err && <p className="err">{err}</p>}
      <button className="btn" type="submit">Salvar nova senha</button>
    </form>
  );
}

/* ============================================================
   Lista de grupos
   ============================================================ */
function GroupsHome({ session, onOpen, notify, invite, clearInvite }) {
  const [groups, setGroups] = useState(null);
  const [mine, setMine] = useState({});
  const [err, setErr] = useState("");
  const [panel, setPanel] = useState(invite ? "join" : "");
  const userName = (session.user.user_metadata && session.user.user_metadata.name) || session.user.email.split("@")[0];

  const load = async () => {
    setErr("");
    const [g, e, s] = await Promise.all([
      sb.from("groups").select("id,name,kind,emoji,currency,archived,created_at,members(id,user_id,name,is_child)").order("created_at", { ascending: false }),
      sb.from("expenses").select("group_id,paid_by,amount,status,expense_splits(member_id,amount)"),
      sb.from("settlements").select("group_id,from_member,to_member,amount"),
    ]);
    if (g.error) { setErr(errMsg(g.error)); setGroups([]); return; }
    const pos = {};
    (g.data || []).forEach((gr) => {
      const me = gr.members.find((m) => m.user_id === session.user.id);
      const bal = balancesOf(gr.members, (e.data || []).filter((x) => x.group_id === gr.id), (s.data || []).filter((x) => x.group_id === gr.id));
      pos[gr.id] = me ? bal[me.id] || 0 : 0;
    });
    setMine(pos);
    setGroups(g.data || []);
  };
  useEffect(() => { load(); }, []);

  const active = (groups || []).filter((g) => !g.archived);
  const closed = (groups || []).filter((g) => g.archived);
  const card = (g) => {
    const v = mine[g.id] || 0;
    return (
      <button key={g.id} className="card g-item" onClick={() => onOpen(g.id)}>
        <span className="g-emoji">{g.emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{g.name}</b>
          <small>{g.kind === "casa" ? "Casa e família" : "Viagem"} · {g.members.length} {g.members.length === 1 ? "pessoa" : "pessoas"}</small>
          <div className={`g-pos ${v > 0.004 ? "pos" : v < -0.004 ? "neg" : "zero"}`}>
            {v > 0.004 ? `Você tem ${money(v, g.currency)} a receber` : v < -0.004 ? `Você deve ${money(-v, g.currency)}` : "Tudo acertado"}
          </div>
        </div>
        <Icon name="right" size={18} />
      </button>
    );
  };

  return (
    <div className="g-wrap">
      <div className="g-bar">
        <div className="top" style={{ marginBottom: 0 }}><div><h1>Grupos</h1><p>Olá, {userName}. Escolha um grupo ou crie um novo.</p></div></div>
        <div className="g-actions">
          <button className="btn ghost" onClick={() => setPanel(panel === "join" ? "" : "join")}>Entrar com código</button>
          <button className="btn sm" onClick={() => setPanel(panel === "new" ? "" : "new")}>Novo grupo</button>
        </div>
      </div>

      {panel === "new" && <CreateGroup userName={userName} onCancel={() => setPanel("")} onCreated={(id) => { notify("Grupo criado"); onOpen(id); }} />}
      {panel === "join" && <JoinGroup initial={invite} userName={userName} onCancel={() => { setPanel(""); clearInvite(); }} onJoined={(id) => { clearInvite(); notify("Você entrou no grupo"); onOpen(id); }} />}

      {err && <p className="err">{err}</p>}
      {groups === null ? <div className="card empty">Carregando seus grupos…</div> :
        !groups.length && !panel ? (
          <div className="card empty">
            <b>Você ainda não participa de nenhum grupo</b>
            Crie um para a sua casa ou para a próxima viagem e convide as pessoas pelo código.
            <div className="btnrow" style={{ justifyContent: "center", marginTop: 14 }}>
              <button className="btn sm" onClick={() => setPanel("new")}>Criar grupo</button>
              <button className="btn ghost" onClick={() => setPanel("join")}>Tenho um código</button>
            </div>
          </div>
        ) : (
          <>
            {active.length > 0 && <div className="g-grid">{active.map(card)}</div>}
            {closed.length > 0 && (
              <>
                <div className="day">Viagens encerradas</div>
                <div className="g-grid">{closed.map(card)}</div>
              </>
            )}
          </>
        )}

      <div className="mine card">
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <Avatar name={userName} color="#0E9F5A" />
          <div style={{ minWidth: 0 }}><b style={{ fontSize: 14 }}>{userName}</b><small>{session.user.email}</small></div>
        </div>
        <button className="btn ghost" onClick={() => sb.auth.signOut()}><span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Icon name="logout" size={16} />Sair</span></button>
      </div>
    </div>
  );
}

function CreateGroup({ userName, onCancel, onCreated }) {
  const [f, setF] = useState({ kind: "casa", name: "", emoji: "🏠", currency: "BRL", myName: userName });
  const [people, setPeople] = useState([]);
  const [next, setNext] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const addPerson = () => {
    const n = next.trim();
    if (!n) return;
    setPeople([...people, { name: n.slice(0, 40), is_child: false }]);
    setNext("");
  };
  const submit = async (e) => {
    e.preventDefault();
    if (!f.name.trim()) return setErr(f.kind === "casa" ? "Dê um nome ao grupo, por exemplo “Casa”." : "Dê um nome à viagem, por exemplo “Praia em janeiro”.");
    if (!f.myName.trim()) return setErr("Diga seu nome no grupo.");
    setBusy(true); setErr("");
    const { data, error } = await sb.rpc("create_group", {
      p_name: f.name.trim(), p_kind: f.kind, p_emoji: f.emoji, p_currency: f.kind === "viagem" ? f.currency : "BRL",
      p_my_name: f.myName.trim(), p_others: people,
    });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    onCreated(data);
  };

  return (
    <form className="card form" onSubmit={submit} noValidate>
      <div className="sheet-h" style={{ marginBottom: 0 }}><h2>Novo grupo</h2><button type="button" className="iconbtn" onClick={onCancel} aria-label="Fechar"><Icon name="x" size={18} /></button></div>
      <div className="seg" style={{ alignSelf: "flex-start" }}>
        <button type="button" className={f.kind === "casa" ? "on" : ""} onClick={() => setF({ ...f, kind: "casa", emoji: "🏠" })}>🏠 Casa / família</button>
        <button type="button" className={f.kind === "viagem" ? "on" : ""} onClick={() => setF({ ...f, kind: "viagem", emoji: "✈️" })}>✈️ Viagem</button>
      </div>
      <div className="fgrid">
        <div className="field"><label htmlFor="ng-name">Nome do grupo</label>
          <input id="ng-name" className="input" value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={f.kind === "casa" ? "Ex.: Casa da família" : "Ex.: Praia em janeiro"} /></div>
        <div className="field"><label htmlFor="ng-me">Seu nome no grupo</label>
          <input id="ng-me" className="input" value={f.myName} maxLength={40} onChange={(e) => setF({ ...f, myName: e.target.value })} /></div>
      </div>
      <div className="field"><span className="flabel">Ícone</span>
        <div className="emojis">{EMOJIS[f.kind].map((em) => <button type="button" key={em} className={f.emoji === em ? "on" : ""} onClick={() => setF({ ...f, emoji: em })}>{em}</button>)}</div>
      </div>
      {f.kind === "viagem" && (
        <div className="field"><label htmlFor="ng-cur">Moeda da viagem</label>
          <select id="ng-cur" className="input" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
            {CURRENCIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select></div>
      )}
      <div className="field">
        <label htmlFor="ng-person">{f.kind === "casa" ? "Quem mais faz parte da casa" : "Quem vai na viagem"}</label>
        <div className="addline">
          <input id="ng-person" className="input" value={next} onChange={(e) => setNext(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPerson(); } }} placeholder="Nome da pessoa" />
          <button type="button" className="btn ghost" style={{ height: 42 }} onClick={addPerson}>Adicionar</button>
        </div>
        {people.length > 0 && (
          <div className="pchips" style={{ marginTop: 6 }}>
            {people.map((p, i) => (
              <span className="pchip" key={i}>{p.name}
                {f.kind === "casa" && <button type="button" className={p.is_child ? "on" : ""} onClick={() => setPeople(people.map((q, k) => (k === i ? { ...q, is_child: !q.is_child } : q)))}>{p.is_child ? "Filho(a)" : "Adulto"}</button>}
                <button type="button" onClick={() => setPeople(people.filter((_, k) => k !== i))} aria-label={`Remover ${p.name}`}>✕</button>
              </span>
            ))}
          </div>
        )}
        <p className="hint">Quem tiver celular pode entrar depois pelo convite e assumir o próprio nome.{f.kind === "casa" ? " Filhos podem ficar sem login." : ""}</p>
      </div>
      {err && <p className="err">{err}</p>}
      <button className="btn" type="submit" disabled={busy}>{busy ? "Criando…" : "Criar grupo"}</button>
    </form>
  );
}

function JoinGroup({ initial, userName, onCancel, onJoined }) {
  const [code, setCode] = useState(initial || "");
  const [pv, setPv] = useState(null);
  const [claim, setClaim] = useState("");
  const [name, setName] = useState(userName);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const look = async (c) => {
    const v = (c || code).trim().toUpperCase();
    if (v.length < 4) return setErr("Digite o código de convite.");
    setBusy(true); setErr("");
    const { data, error } = await sb.rpc("group_preview", { p_code: v });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    if (!data) return setErr("Não encontramos um grupo com esse código. Confira com quem te convidou.");
    if (data.already) return onJoined(data.id);
    setPv(data);
    setClaim(data.open.length ? data.open[0].id : "");
  };
  useEffect(() => { if (initial) look(initial); }, []);

  const join = async () => {
    setBusy(true); setErr("");
    const { data, error } = await sb.rpc("join_group", { p_code: code.trim().toUpperCase(), p_name: name.trim(), p_claim: claim || null });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    onJoined(data);
  };

  return (
    <div className="card form">
      <div className="sheet-h" style={{ marginBottom: 0 }}><h2>Entrar em um grupo</h2><button type="button" className="iconbtn" onClick={onCancel} aria-label="Fechar"><Icon name="x" size={18} /></button></div>
      {!pv ? (
        <>
          <div className="field"><label htmlFor="jg-code">Código de convite</label>
            <div className="addline">
              <input id="jg-code" className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Ex.: 7F3A9C21" autoCapitalize="characters" style={{ letterSpacing: ".1em", fontWeight: 600 }} />
              <button type="button" className="btn" style={{ height: 42 }} onClick={() => look()} disabled={busy}>{busy ? "…" : "Buscar"}</button>
            </div></div>
          <p className="hint">Peça o código para quem criou o grupo. Ele aparece em “Pessoas”.</p>
        </>
      ) : (
        <>
          <div className="g-title"><span className="g-emoji">{pv.emoji}</span><div><b style={{ fontSize: 16 }}>{pv.name}</b><p className="hint">{pv.kind === "casa" ? "Casa e família" : "Viagem"}</p></div></div>
          {pv.open.length > 0 && (
            <div className="field"><span className="flabel">Quem é você no grupo?</span>
              <div className="who-list">
                {pv.open.map((o) => (
                  <label key={o.id} className="who-row"><input type="radio" name="claim" checked={claim === o.id} onChange={() => setClaim(o.id)} /><span className="nm">{o.name}</span></label>
                ))}
                <label className="who-row"><input type="radio" name="claim" checked={claim === ""} onChange={() => setClaim("")} /><span className="nm">Não estou na lista</span></label>
              </div></div>
          )}
          {claim === "" && (
            <div className="field"><label htmlFor="jg-name">Seu nome no grupo</label>
              <input id="jg-name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></div>
          )}
          <button className="btn" onClick={join} disabled={busy}>{busy ? "Entrando…" : "Entrar no grupo"}</button>
        </>
      )}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

/* ============================================================
   Um grupo aberto
   ============================================================ */
function GroupView({ id, session, sel, setSel, onBack, notify }) {
  const [g, setG] = useState(null);
  const [members, setMembers] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("despesas");
  const [sheet, setSheet] = useState(null);
  const [inviting, setInviting] = useState(false);

  const load = async () => {
    const [gr, mr, er, sr, rr] = await Promise.all([
      sb.from("groups").select("*").eq("id", id).maybeSingle(),
      sb.from("members").select("*").eq("group_id", id).order("created_at").order("name"),
      sb.from("expenses").select("*, expense_splits(member_id,amount)").eq("group_id", id).order("date", { ascending: false }).order("created_at", { ascending: false }),
      sb.from("settlements").select("*").eq("group_id", id).order("date", { ascending: false }).order("created_at", { ascending: false }),
      sb.from("recurring").select("*").eq("group_id", id).order("created_at"),
    ]);
    const firstErr = gr.error || mr.error || er.error || sr.error || rr.error;
    if (firstErr) { setErr(errMsg(firstErr)); return; }
    if (!gr.data) { setErr("Este grupo não existe mais ou você saiu dele."); return; }
    setErr("");
    setG(gr.data); setMembers(mr.data); setExpenses(er.data); setSettlements(sr.data); setRecurring(rr.data);
  };

  useEffect(() => {
    load();
    let t = null;
    const later = () => { clearTimeout(t); t = setTimeout(load, 350); };
    const ch = sb.channel(`grupo-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses", filter: `group_id=eq.${id}` }, later)
      .on("postgres_changes", { event: "*", schema: "public", table: "settlements", filter: `group_id=eq.${id}` }, later)
      .on("postgres_changes", { event: "*", schema: "public", table: "members", filter: `group_id=eq.${id}` }, later)
      .on("postgres_changes", { event: "*", schema: "public", table: "groups", filter: `id=eq.${id}` }, later)
      .on("postgres_changes", { event: "*", schema: "public", table: "recurring", filter: `group_id=eq.${id}` }, later)
      .subscribe();
    const onFocus = () => { if (document.visibilityState === "visible") later(); };
    document.addEventListener("visibilitychange", onFocus);
    return () => { clearTimeout(t); sb.removeChannel(ch); document.removeEventListener("visibilitychange", onFocus); };
  }, [id]);

  if (err && !g) return (
    <div className="g-wrap">
      <button className="back" onClick={onBack}><Icon name="left" size={18} />Grupos</button>
      <div className="card empty"><b>Não foi possível abrir o grupo</b>{err}<div style={{ marginTop: 12 }}><button className="btn sm" onClick={load}>Tentar de novo</button></div></div>
    </div>
  );
  if (!g) return <div className="card empty">Abrindo o grupo…</div>;

  const me = members.find((m) => m.user_id === session.user.id);
  const isAdmin = !!me && me.role === "admin";
  const cur = g.currency;
  const fm = (v) => money(v, cur);
  const bal = balancesOf(members, expenses, settlements);
  const myBal = me ? bal[me.id] || 0 : 0;
  const casa = g.kind === "casa";
  const curMonth = ym(new Date());

  const openNew = (preset) => setSheet({ preset: preset || {} });
  const openEdit = (e) => (e.virtual ? setSheet({ preset: { virtual: e } }) : setSheet({ expense: e }));
  const skipMonth = async (v) => {
    const { error } = await sb.from("recurring").update({ skipped: [...(v.rule.skipped || []), v.occurrence] }).eq("id", v.recurring_id);
    if (error) return notify(errMsg(error));
    notify("Mês pulado");
    load();
  };

  return (
    <div className="g-wrap">
      <div className="g-top">
        <button className="back" onClick={onBack}><Icon name="left" size={18} />Grupos</button>
        <div className="g-bar">
          <div className="g-title">
            <span className="g-emoji">{g.emoji}</span>
            <div style={{ minWidth: 0 }}>
              <h1>{g.name}</h1>
              <p>{casa ? "Casa e família" : `Viagem · ${cur}`} · {members.length} {members.length === 1 ? "pessoa" : "pessoas"}{g.archived ? " · encerrada" : ""}</p>
            </div>
          </div>
          <div className="g-actions">
            {casa && (
              <div className="picker" aria-label="Selecionar mês">
                <button onClick={() => setSel(addM(sel, -1))} aria-label="Mês anterior"><Icon name="left" size={18} /></button>
                <span className="lbl num">{monthLabel(sel)}</span>
                <button onClick={() => setSel(addM(sel, 1))} aria-label="Próximo mês"><Icon name="right" size={18} /></button>
                {sel !== curMonth && <button className="today" onClick={() => setSel(curMonth)}>Hoje</button>}
              </div>
            )}
            {me && <button className="btn ghost" onClick={() => setInviting(true)}><span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Icon name="share" size={16} />Convidar</span></button>}
            {me && <button className="btn sm" onClick={() => openNew()}><span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Icon name="add" size={17} />Nova despesa</span></button>}
          </div>
        </div>
      </div>

      {err && <p className="err">{err}</p>}

      <div className="card mine">
        <div>
          <small>Seu saldo no grupo</small>
          <b className={`num ${myBal > 0.004 ? "pos" : myBal < -0.004 ? "neg" : "zero"}`}>
            {myBal > 0.004 ? `Você recebe ${fm(myBal)}` : myBal < -0.004 ? `Você deve ${fm(-myBal)}` : "Tudo acertado"}
          </b>
        </div>
        <button className="btn ghost" onClick={() => setTab("saldos")}>Ver acertos</button>
      </div>

      <div className="g-tabs">
        <div className="seg" role="tablist">
          {[["despesas", "Despesas"], ["saldos", "Saldos"], ["resumo", "Resumo"], ["pessoas", "Pessoas"]].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      </div>

      {tab === "despesas" && <ExpensesTab g={g} members={members} expenses={expenses} recurring={recurring} me={me} isAdmin={isAdmin} session={session} sel={sel} fm={fm} onOpen={openEdit} onNew={openNew} onSkip={skipMonth} reload={load} notify={notify} />}
      {tab === "saldos" && <BalancesTab g={g} members={members} settlements={settlements} bal={bal} me={me} isAdmin={isAdmin} fm={fm} reload={load} notify={notify} session={session} />}
      {tab === "resumo" && <SummaryTab g={g} members={members} expenses={expenses} recurring={recurring} sel={sel} fm={fm} isAdmin={isAdmin} reload={load} notify={notify} />}
      {tab === "pessoas" && <PeopleTab g={g} members={members} me={me} isAdmin={isAdmin} fm={fm} reload={load} notify={notify} onBack={onBack} onAllowance={(child) => openNew({ category: "mesada", for_member: child.id, description: `Mesada de ${child.name}`, amount: child.allowance })} />}

      {inviting && <InviteSheet g={g} members={members} onClose={() => setInviting(false)} />}
      {sheet && me && (
        <ExpenseSheet g={g} members={members} me={me} sel={sel} expense={sheet.expense} preset={sheet.preset} isAdmin={isAdmin} session={session}
          onClose={() => setSheet(null)} onSaved={(msg) => { setSheet(null); notify(msg); load(); }} />
      )}
    </div>
  );
}

/* ---------- Despesas ---------- */
function ExpensesTab({ g, members, expenses, recurring, me, isAdmin, session, sel, fm, onOpen, onNew, onSkip, reload, notify }) {
  const casa = g.kind === "casa";
  const inPeriod = casa ? expenses.filter((e) => e.date.slice(0, 7) === sel) : expenses;
  const virtuals = casa ? groupVirtuals(recurring, expenses, sel, sel) : [];
  const pending = [...inPeriod.filter((e) => e.status === "previsto"), ...virtuals].sort((a, b) => (a.date < b.date ? -1 : 1));
  const paid = inPeriod.filter((e) => e.status !== "previsto");
  const total = r2(paid.reduce((a, e) => a + Number(e.amount), 0));
  const totalPend = r2(pending.reduce((a, e) => a + Number(e.amount), 0));
  const nameOf = (mid) => (members.find((m) => m.id === mid) || {}).name || "Alguém";
  const today = new Date();
  const dlabel = (d) => {
    const t = `${ym(today)}-${pad(today.getDate())}`;
    const y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (d === t) return "Hoje";
    if (d === `${ym(y)}-${pad(y.getDate())}`) return "Ontem";
    const [yy, mm, dd] = d.split("-");
    return `${Number(dd)} de ${MONTHS[Number(mm) - 1].toLowerCase()}${Number(yy) !== today.getFullYear() ? ` de ${yy}` : ""}`;
  };

  const fixed = casa ? (
    <FixedBills g={g} recurring={recurring} expenses={expenses} members={members} me={me} isAdmin={isAdmin} session={session} fm={fm} reload={reload} notify={notify} />
  ) : null;

  if (!paid.length && !pending.length) return (
    <div className="stack">
      <div className="card empty">
        <b>{casa ? `Nenhuma despesa em ${monthLabel(sel).toLowerCase()}` : "Nenhuma despesa na viagem ainda"}</b>
        {casa ? "Lance as contas da casa e o app divide entre vocês. Contas como aluguel podem se repetir todo mês." : "Registre os gastos já combinados como previstos e os que forem acontecendo como pagos."}
        {me && <div style={{ marginTop: 12 }}><button className="btn sm" onClick={() => onNew()}>Lançar despesa</button></div>}
      </div>
      {fixed}
    </div>
  );

  let lastDay = "";
  return (
    <div className="stack">
      {pending.length > 0 && (
        <div className="card">
          <div className="card-h"><h2>A pagar</h2><small className="num">{pending.length} {pending.length === 1 ? "conta" : "contas"} · {fm(totalPend)} · fora dos saldos até serem pagas</small></div>
          <div className="list">
            {pending.map((e) => {
              const c = gcat(g.kind, e.category);
              const due = dueTxt(e.date);
              return (
                <div className="row click pending" key={e.id} role="button" tabIndex={0} onClick={() => me && onOpen(e)} onKeyDown={(k) => k.key === "Enter" && me && onOpen(e)}>
                  <div className="row-ico">{c.emoji}</div>
                  <div className="row-main">
                    <b>{e.description}{e.virtual || e.recurring_id ? <span className="tag" title="Conta fixa">🔁</span> : null}</b>
                    <span><span className={`due ${due.cls}`}>{due.txt}</span> · {c.name}{e.paid_by ? ` · ${nameOf(e.paid_by)} costuma pagar` : ""}</span>
                  </div>
                  <div className="row-side"><b>{fm(Number(e.amount))}</b></div>
                  {me && (
                    <div className="row-acts" onClick={(k) => k.stopPropagation()}>
                      <button type="button" className="btn sm paybtn" onClick={() => onOpen(e)}>Pagar</button>
                      {e.virtual && <ConfirmX label="Pular" confirmLabel="Pular este mês?" onConfirm={() => onSkip(e)} />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-h"><h2>{casa ? `Pagas em ${MONTHS[monthIdx(sel)].toLowerCase()}` : "Despesas pagas"}</h2><small className="num">{paid.length} lançamentos · {fm(total)}</small></div>
        {!paid.length ? <div className="empty">Nada pago ainda neste período.</div> : (
          <div className="list">
            {paid.map((e) => {
              const head = e.date !== lastDay ? dlabel(e.date) : null;
              lastDay = e.date;
              const c = gcat(g.kind, e.category);
              const myShare = me ? Number(((e.expense_splits || []).find((s) => s.member_id === me.id) || {}).amount || 0) : 0;
              const paidByMe = me && e.paid_by === me.id;
              const lent = r2(Number(e.amount) - myShare);
              const forName = e.for_member ? nameOf(e.for_member) : "";
              return (
                <React.Fragment key={e.id}>
                  {head && <div className="day">{head}</div>}
                  <div className="row click" role="button" tabIndex={0} onClick={() => onOpen(e)} onKeyDown={(k) => k.key === "Enter" && onOpen(e)}>
                    <div className="row-ico">{c.emoji}</div>
                    <div className="row-main">
                      <b>{e.description}{e.recurring_id ? <span className="tag" title="Conta fixa">🔁</span> : null}</b>
                      <span>{paidByMe ? "Você pagou" : `${nameOf(e.paid_by)} pagou`}{forName ? ` · para ${forName}` : ""} · {(e.expense_splits || []).length} na divisão</span>
                    </div>
                    <div className="row-side">
                      <b>{fm(Number(e.amount))}</b>
                      {paidByMe ? (lent > 0.004 ? <small className="pos">você emprestou {fm(lent)}</small> : <small className="zero">só você</small>) :
                        myShare > 0 ? <small className="neg">você deve {fm(myShare)}</small> : <small className="zero">fora da divisão</small>}
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
      {fixed}
    </div>
  );
}

/* ---------- Contas fixas da casa ---------- */
function FixedBills({ g, recurring, expenses, members, me, isAdmin, session, fm, reload, notify }) {
  const [editing, setEditing] = useState(null);
  const [v, setV] = useState("");
  const curM = ym(new Date());
  const nameOf = (mid) => (members.find((m) => m.id === mid) || {}).name || "";
  const upd = async (id, patch, msg) => {
    const { error } = await sb.from("recurring").update(patch).eq("id", id);
    if (error) return notify(errMsg(error));
    notify(msg); setEditing(null); reload();
  };
  const del = async (id) => {
    const { error } = await sb.from("recurring").delete().eq("id", id);
    if (error) return notify(errMsg(error));
    notify("Conta fixa excluída. O que já foi pago continua no histórico."); reload();
  };
  return (
    <div className="card">
      <div className="card-h"><h2>Contas fixas da casa</h2><small>{recurring.length ? `${recurring.length} cadastradas` : ""}</small></div>
      {!recurring.length ? (
        <div className="empty">Ao lançar aluguel, condomínio ou internet, escolha “Repetir todo mês”. A conta aparece prevista em cada mês, já com a divisão combinada.</div>
      ) : (
        <div className="list">
          {recurring.map((r) => {
            const c = gcat(g.kind, r.category);
            const last = ruleLast(r);
            const ended = last && last < curM;
            const paidCount = expenses.filter((e) => e.recurring_id === r.id).length;
            const canEdit = me && (r.created_by === session.user.id || isAdmin);
            return (
              <div className="row" key={r.id} style={{ flexWrap: "wrap" }}>
                <div className="row-ico">{c.emoji}</div>
                <div className="row-main">
                  <b>{r.description}{ended && <span className="tag">Encerrada</span>}</b>
                  <span>Todo dia {r.day}{last ? ` até ${shortMonth(last)}` : ""}{r.paid_by ? ` · ${nameOf(r.paid_by)} costuma pagar` : ""} · {paidCount} {paidCount === 1 ? "paga" : "pagas"}</span>
                </div>
                {editing === r.id ? (
                  <span className="payline">
                    <input className="input num" inputMode="decimal" aria-label="Novo valor" value={v} onChange={(e) => setV(e.target.value)} autoFocus />
                    <button type="button" className="btn sm" onClick={() => { const n = parseMoney(v); if (n > 0) upd(r.id, { amount: n }, "Valor atualizado para os próximos meses"); }}>Salvar</button>
                    <button type="button" className="xbtn" onClick={() => setEditing(null)}>Cancelar</button>
                  </span>
                ) : (
                  <>
                    <div className="row-side"><b>{fm(Number(r.amount))}</b></div>
                    {me && (
                      <div className="row-acts">
                        <button type="button" className="xbtn" style={{ color: "var(--ink-2)" }} onClick={() => { setEditing(r.id); setV(String(Number(r.amount)).replace(".", ",")); }}>Alterar valor</button>
                        {!ended && <ConfirmX label="Encerrar" confirmLabel="Parar depois deste mês?" onConfirm={() => upd(r.id, { end_month: `${curM}-01` }, "Conta fixa encerrada")} />}
                        {canEdit && <ConfirmX onConfirm={() => del(r.id)} confirmLabel="Excluir conta fixa?" />}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- Formulário de despesa ---------- */
function ExpenseSheet({ g, members, me, sel, expense, preset = {}, isAdmin, session, onClose, onSaved }) {
  const casa = g.kind === "casa";
  const cur = g.currency;
  const isEdit = !!expense;
  const virtual = preset.virtual || null;
  const rule = virtual ? virtual.rule : null;
  const paying = !!virtual || (isEdit && expense.status === "previsto");
  const defDate = casa ? (sel === ym(new Date()) ? todayStr() : `${sel}-01`) : todayStr();
  const adults = members.filter((m) => !m.is_child).map((m) => m.id);
  const memberIds = members.map((m) => m.id);
  const ruleW = rule ? Object.fromEntries(Object.entries(rule.split_weights || {}).filter(([k]) => memberIds.includes(k)).map(([k, v]) => [k, String(Number(v))])) : {};
  const startIds = isEdit ? (expense.expense_splits || []).map((s) => s.member_id) : rule && Object.keys(ruleW).length ? Object.keys(ruleW) : casa ? adults : memberIds;
  const shareW = {};
  members.forEach((m) => { shareW[m.id] = String(Number(m.share)); });
  const splitW = {};
  if (isEdit) (expense.expense_splits || []).forEach((s) => { splitW[s.member_id] = String(Number(s.amount)); });
  const src = isEdit ? expense : virtual;
  const fmtN = (n) => String(Number(n)).replace(".", ",");

  const [f, setF] = useState({
    description: src ? src.description : preset.description || "",
    amount: src ? fmtN(src.amount) : preset.amount ? fmtN(preset.amount) : "",
    date: src ? (virtual && virtual.date > todayStr() ? todayStr() : src.date) : defDate,
    category: src ? src.category : preset.category || "",
    paid_by: src && src.paid_by && memberIds.includes(src.paid_by) ? src.paid_by : me.id,
    for_member: src ? src.for_member || "" : preset.for_member || "",
    mode: isEdit ? expense.split_mode : rule ? rule.split_mode : "igual",
    status: paying ? "pago" : isEdit ? expense.status || "pago" : defDate > todayStr() ? "previsto" : "pago",
    repeat: "nao",
    count: "12",
  });
  const [ids, setIds] = useState(startIds);
  const [weights, setWeights] = useState(isEdit && expense.split_mode === "proporcao" ? { ...shareW, ...splitW } : rule && rule.split_mode === "proporcao" ? { ...shareW, ...ruleW } : shareW);
  const [manual, setManual] = useState(isEdit ? Object.fromEntries(Object.entries(splitW).map(([k, v]) => [k, v.replace(".", ",")])) : rule && rule.split_mode === "valor" ? Object.fromEntries(Object.entries(ruleW).map(([k, v]) => [k, v.replace(".", ",")])) : {});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, []);

  const amount = parseMoney(f.amount);
  const ordered = members.filter((m) => ids.includes(m.id)).map((m) => m.id);
  const calc = computeSplits(amount, ordered, f.mode, weights, manual, cur);
  const shareOf = (mid) => (calc.splits.find((s) => s.member_id === mid) || {}).amount || 0;
  const toggle = (mid) => setIds(ids.includes(mid) ? ids.filter((x) => x !== mid) : [...ids, mid]);
  const canDelete = isEdit && (expense.created_by === session.user.id || isAdmin);

  const save = async (e) => {
    e.preventDefault();
    if (!f.description.trim()) return setErr("Descreva a despesa, por exemplo “Conta de luz”.");
    if (!(amount > 0)) return setErr("Informe o valor da despesa.");
    if (!f.category) return setErr("Escolha uma categoria.");
    if (calc.error) return setErr(calc.error);
    const count = f.repeat === "n" ? Math.round(Number(f.count)) : null;
    if (f.repeat === "n" && !(count >= 2 && count <= 120)) return setErr("Escolha entre 2 e 120 meses de repetição.");
    setBusy(true); setErr("");
    let recurringId = virtual ? virtual.recurring_id : null;
    let occurrence = virtual ? virtual.occurrence : null;
    if (!isEdit && !virtual && f.repeat !== "nao") {
      const weightsToSave = Object.fromEntries(ordered.map((mid) => [mid,
        f.mode === "proporcao" ? Number(String(weights[mid] ?? 0).replace(",", ".")) || 0 : f.mode === "valor" ? parseMoney(manual[mid] ?? "") || 0 : 1]));
      const { data: rr, error: re } = await sb.from("recurring").insert({
        group_id: g.id, description: f.description.trim(), amount, category: f.category, paid_by: f.paid_by, for_member: f.for_member || null,
        split_mode: f.mode, split_weights: weightsToSave, day: Number(f.date.slice(8, 10)), start_month: `${f.date.slice(0, 7)}-01`, months: count,
      }).select("id").single();
      if (re) { setBusy(false); return setErr(errMsg(re)); }
      if (f.status === "previsto") { setBusy(false); return onSaved(`${f.description.trim()} vai se repetir todo mês`); }
      recurringId = rr.id;
      occurrence = `${f.date.slice(0, 7)}-01`;
    }
    const { error } = await sb.rpc("save_expense", {
      p_id: isEdit ? expense.id : null, p_group: g.id, p_description: f.description.trim(), p_amount: amount,
      p_category: f.category, p_date: f.date, p_paid_by: f.paid_by, p_for: f.for_member || null, p_mode: f.mode,
      p_splits: calc.splits.filter((s) => s.amount > 0), p_status: f.status, p_recurring: recurringId, p_occurrence: occurrence,
    });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    onSaved(paying && f.status === "pago" ? `Pagamento de ${money(amount, cur)} registrado` : isEdit ? "Despesa atualizada" :
      f.repeat !== "nao" ? `${f.description.trim()} vai se repetir todo mês` : f.status === "previsto" ? "Despesa prevista adicionada" : `Despesa de ${money(amount, cur)} lançada`);
  };
  const remove = async () => {
    const { error } = await sb.from("expenses").delete().eq("id", expense.id);
    if (error) return setErr(errMsg(error));
    onSaved("Despesa excluída");
  };

  return (
    <div className="sheet-bg" onClick={onClose}>
      <form className="sheet form" onClick={(e) => e.stopPropagation()} onSubmit={save} noValidate role="dialog" aria-modal="true" aria-label={paying ? "Registrar pagamento" : isEdit ? "Editar despesa" : "Nova despesa"}>
        <div className="sheet-h"><h2>{paying ? "Registrar pagamento" : isEdit ? "Editar despesa" : "Nova despesa"}</h2><button type="button" className="iconbtn" onClick={onClose} aria-label="Fechar"><Icon name="x" size={18} /></button></div>
        <div className="field"><label htmlFor="ex-desc">Descrição</label>
          <input id="ex-desc" className="input" maxLength={80} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={casa ? "Ex.: Conta de luz" : "Ex.: Jantar no restaurante"} /></div>
        <div className="fgrid">
          <div className="field"><label htmlFor="ex-amount">Valor ({cur})</label>
            <input id="ex-amount" className="input num" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0,00" /></div>
          <div className="field"><label htmlFor="ex-date">Data</label>
            <input id="ex-date" className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value, status: !paying && e.target.value > todayStr() ? "previsto" : f.status })} /></div>
          <div className="field"><label htmlFor="ex-paid">{f.status === "previsto" ? "Quem vai pagar" : "Quem pagou"}</label>
            <select id="ex-paid" className="input" value={f.paid_by} onChange={(e) => setF({ ...f, paid_by: e.target.value })}>
              {members.filter((m) => !m.is_child || m.id === f.paid_by).map((m) => <option key={m.id} value={m.id}>{m.id === me.id ? `${m.name} (você)` : m.name}</option>)}
            </select></div>
          {casa && (
            <div className="field"><label htmlFor="ex-for">Gasto com alguém em especial? <span style={{ fontWeight: 400, color: "var(--muted)" }}>(opcional)</span></label>
              <select id="ex-for" className="input" value={f.for_member} onChange={(e) => setF({ ...f, for_member: e.target.value })}>
                <option value="">Com a casa toda</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.is_child ? " (filho/a)" : ""}</option>)}
              </select></div>
          )}
        </div>
        {!paying && (
          <div className="fgrid">
            <div className="field"><span className="flabel">Situação</span>
              <div className="seg">
                <button type="button" className={f.status === "pago" ? "on r" : ""} onClick={() => setF({ ...f, status: "pago" })}>Já foi paga</button>
                <button type="button" className={f.status === "previsto" ? "on" : ""} onClick={() => setF({ ...f, status: "previsto" })}>A pagar</button>
              </div></div>
            {casa && !isEdit && (
              <div className="field"><label htmlFor="ex-repeat">Repetir</label>
                <select id="ex-repeat" className="input" value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value })}>
                  <option value="nao">Não repete</option>
                  <option value="sempre">Todo mês, sem data para acabar</option>
                  <option value="n">Todo mês, por alguns meses</option>
                </select></div>
            )}
            {f.repeat === "n" && (
              <div className="field"><label htmlFor="ex-count">Quantos meses</label>
                <input id="ex-count" className="input num" inputMode="numeric" value={f.count} onChange={(e) => setF({ ...f, count: e.target.value.replace(/\D/g, "").slice(0, 3) })} /></div>
            )}
          </div>
        )}
        {!paying && f.status === "previsto" && <p className="hint">Despesas a pagar aparecem na lista, mas só entram em “quem deve a quem” depois de pagas.</p>}
        {!paying && f.repeat !== "nao" && f.date && <p className="hint">Repete todo dia {Number(f.date.slice(8, 10))} com a mesma divisão. {f.status === "pago" ? "Este mês já entra como pago; os próximos ficam a pagar." : "Todos os meses ficam a pagar até alguém registrar o pagamento."}</p>}
        {paying && <p className="hint">Confira o valor e quem pagou. Ao salvar, a despesa entra nos saldos do grupo.</p>}

        <div className="field"><span className="flabel">Categoria</span>
          <div className="chips">
            {GCATS[g.kind].map((c) => (
              <button type="button" key={c.id} className={`chip${f.category === c.id ? " on" : ""}`} onClick={() => setF({ ...f, category: c.id })} aria-pressed={f.category === c.id}><span>{c.emoji}</span>{c.name}</button>
            ))}
          </div></div>

        <div className="field">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span className="flabel">Dividir entre</span>
            <div className="seg">
              {[["igual", "Igual"], ["proporcao", "Proporção"], ["valor", "Valores"]].map(([k, l]) => (
                <button type="button" key={k} className={f.mode === k ? "on" : ""} onClick={() => setF({ ...f, mode: k })}>{l}</button>
              ))}
            </div>
          </div>
          <div className="who-list">
            {members.map((m) => {
              const on = ids.includes(m.id);
              return (
                <label key={m.id} className={`who-row${on ? "" : " off"}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(m.id)} />
                  <Avatar name={m.name} color={colorFor(members, m.id)} sm />
                  <span className="nm">{m.name}{m.is_child ? " · filho(a)" : ""}</span>
                  {on && f.mode === "proporcao" && (
                    <input className="input mini num" inputMode="decimal" aria-label={`Proporção de ${m.name}`} value={weights[m.id] ?? ""} onClick={(e) => e.preventDefault()} onChange={(e) => setWeights({ ...weights, [m.id]: e.target.value })} />
                  )}
                  {on && f.mode === "valor" ? (
                    <input className="input mini num" inputMode="decimal" aria-label={`Valor de ${m.name}`} placeholder="0,00" value={manual[m.id] ?? ""} onClick={(e) => e.preventDefault()} onChange={(e) => setManual({ ...manual, [m.id]: e.target.value })} />
                  ) : <span className="who-amt">{on && amount > 0 ? money(shareOf(m.id), cur) : "—"}</span>}
                </label>
              );
            })}
          </div>
          {f.mode === "proporcao" && <p className="hint">Use pesos ou porcentagens. Ex.: 60 e 40 divide proporcional à renda. O padrão vem do cadastro em “Pessoas”.</p>}
          {f.mode === "valor" && amount > 0 && <p className={calc.error ? "err" : "hint"}>{calc.error || "A divisão fecha com o valor total."}</p>}
        </div>

        {err && <p className="err">{err}</p>}
        <button className="btn" type="submit" disabled={busy}>{busy ? "Salvando…" : paying ? "Registrar pagamento" : isEdit ? "Salvar alterações" : f.repeat !== "nao" ? "Criar conta fixa" : f.status === "previsto" ? "Adicionar como prevista" : "Lançar despesa"}</button>
        {canDelete && <div style={{ textAlign: "center" }}><ConfirmX label="Excluir despesa" confirmLabel="Toque de novo para excluir" onConfirm={remove} /></div>}
      </form>
    </div>
  );
}

/* ---------- Saldos e acertos ---------- */
function BalancesTab({ g, members, settlements, bal, me, isAdmin, fm, reload, notify, session }) {
  const plan = simplify(bal);
  const nameOf = (mid) => (members.find((m) => m.id === mid) || {}).name || "Alguém";
  const maxAbs = Math.max(...Object.values(bal).map(Math.abs), 1);
  const [custom, setCustom] = useState(false);
  const [f, setF] = useState({ from: me ? me.id : "", to: "", amount: "", date: todayStr() });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  const settle = async (from, to, amount, date, key) => {
    setBusy(key); setErr("");
    const { error } = await sb.from("settlements").insert({ group_id: g.id, from_member: from, to_member: to, amount, date: date || todayStr() });
    setBusy("");
    if (error) return setErr(errMsg(error));
    notify(`Pagamento de ${fm(amount)} registrado`);
    reload();
  };
  const submitCustom = (e) => {
    e.preventDefault();
    const v = parseMoney(f.amount);
    if (!f.from || !f.to) return setErr("Escolha quem pagou e quem recebeu.");
    if (f.from === f.to) return setErr("Quem paga e quem recebe precisam ser pessoas diferentes.");
    if (!(v > 0)) return setErr("Informe o valor do pagamento.");
    settle(f.from, f.to, v, f.date, "custom").then(() => { setCustom(false); setF({ ...f, amount: "" }); });
  };
  const removeSettlement = async (sid) => {
    const { error } = await sb.from("settlements").delete().eq("id", sid);
    if (error) return setErr(errMsg(error));
    notify("Pagamento excluído");
    reload();
  };

  return (
    <div className="grid2 even">
      <div className="stack">
        <div className="card">
          <div className="card-h"><h2>Para todo mundo ficar quite</h2><small>{plan.length ? `${plan.length} ${plan.length === 1 ? "pagamento" : "pagamentos"}` : ""}</small></div>
          {plan.length ? (
            <div className="transfers">
              {plan.map((t, i) => (
                <div className="transfer" key={`${t.from}-${t.to}`}>
                  <div className="who">
                    <Avatar name={nameOf(t.from)} color={colorFor(members, t.from)} sm />{me && t.from === me.id ? "Você" : nameOf(t.from)}
                    <span>paga</span><b className="num">{fm(t.amount)}</b><span>para</span>
                    <Avatar name={nameOf(t.to)} color={colorFor(members, t.to)} sm />{me && t.to === me.id ? "você" : nameOf(t.to)}
                  </div>
                  {me && <button className="btn ghost" disabled={busy === `p${i}`} onClick={() => settle(t.from, t.to, t.amount, todayStr(), `p${i}`)}>{busy === `p${i}` ? "…" : "Marcar como pago"}</button>}
                </div>
              ))}
            </div>
          ) : <div className="empty"><b>Tudo acertado 🎉</b>Ninguém deve nada a ninguém neste grupo.</div>}
          {err && <p className="err" style={{ marginTop: 10 }}>{err}</p>}
          <div style={{ marginTop: 14 }}>
            {!custom ? <button className="linkbtn" onClick={() => setCustom(true)}>Registrar outro pagamento</button> : (
              <form className="form" onSubmit={submitCustom} noValidate>
                <div className="fgrid">
                  <div className="field"><label htmlFor="st-from">Quem pagou</label>
                    <select id="st-from" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })}>
                      <option value="">Escolha</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select></div>
                  <div className="field"><label htmlFor="st-to">Quem recebeu</label>
                    <select id="st-to" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}>
                      <option value="">Escolha</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select></div>
                  <div className="field"><label htmlFor="st-amount">Valor ({g.currency})</label>
                    <input id="st-amount" className="input num" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0,00" /></div>
                  <div className="field"><label htmlFor="st-date">Data</label>
                    <input id="st-date" className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
                </div>
                <div className="btnrow"><button className="btn sm" type="submit" disabled={busy === "custom"}>Registrar pagamento</button><button type="button" className="btn ghost" onClick={() => setCustom(false)}>Cancelar</button></div>
              </form>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-h"><h2>Pagamentos registrados</h2></div>
          {settlements.length ? (
            <div className="list">
              {settlements.map((s) => (
                <div className="row" key={s.id}>
                  <div className="row-ico" style={{ background: "var(--green-soft)", color: "var(--green-ink)" }}><Icon name="swap" size={18} /></div>
                  <div className="row-main"><b>{nameOf(s.from_member)} → {nameOf(s.to_member)}</b><span>{fmtDate(s.date)}{s.note ? ` · ${s.note}` : ""}</span></div>
                  <div className="row-amt num">{fm(Number(s.amount))}</div>
                  {(s.created_by === session.user.id || isAdmin) && <ConfirmX onConfirm={() => removeSettlement(s.id)} />}
                </div>
              ))}
            </div>
          ) : <div className="empty">Quando alguém acertar uma dívida, o pagamento aparece aqui.</div>}
        </div>
      </div>

      <div className="card">
        <div className="card-h"><h2>Saldo de cada pessoa</h2><small>Considera todas as despesas</small></div>
        <div>
          {members.map((m) => {
            const v = bal[m.id] || 0;
            const w = (Math.abs(v) / maxAbs) * 50;
            return (
              <div className="bal" key={m.id}>
                <Avatar name={m.name} color={colorFor(members, m.id)} />
                <div className="bal-name"><b>{m.name}{me && m.id === me.id ? " (você)" : ""}</b><small>{v > 0.004 ? "tem a receber" : v < -0.004 ? "deve" : "quite"}</small></div>
                <svg width="100%" height="14" aria-hidden="true">
                  <rect x="0" y="2" width="100%" height="10" rx="5" fill="#EEF3EF" />
                  <line x1="50%" x2="50%" y1="0" y2="14" stroke="#C9D6CE" strokeWidth="1.5" />
                  {v > 0.004 && <rect x="50%" y="2" width={`${w}%`} height="10" rx="3" fill="#0E9F5A" />}
                  {v < -0.004 && <rect x={`${50 - w}%`} y="2" width={`${w}%`} height="10" rx="3" fill="#D64545" />}
                </svg>
                <div className={`bal-val ${v > 0.004 ? "pos" : v < -0.004 ? "neg" : "zero"}`}>{v > 0.004 ? "+" : v < -0.004 ? "−" : ""}{fm(Math.abs(v))}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------- Resumo ---------- */
function SummaryTab({ g, members, expenses: allExp, recurring, sel, fm, isAdmin, reload, notify }) {
  const casa = g.kind === "casa";
  const expenses = allExp.filter((e) => e.status !== "previsto");
  const periodAll = casa ? allExp.filter((e) => e.date.slice(0, 7) === sel) : allExp;
  const pendList = [...periodAll.filter((e) => e.status === "previsto"), ...(casa ? groupVirtuals(recurring, allExp, sel, sel) : [])];
  const totalPend = r2(pendList.reduce((a, e) => a + Number(e.amount), 0));
  const list = casa ? expenses.filter((e) => e.date.slice(0, 7) === sel) : expenses;
  const total = r2(list.reduce((a, e) => a + Number(e.amount), 0));
  const nameOf = (mid) => (members.find((m) => m.id === mid) || {}).name || "Alguém";
  const group = (keyFn, valFn) => {
    const o = {};
    list.forEach((e) => { const ks = keyFn(e); (Array.isArray(ks) ? ks : [[ks, valFn(e)]]).forEach(([k, v]) => { if (k) o[k] = r2((o[k] || 0) + v); }); });
    return Object.entries(o).sort((a, b) => b[1] - a[1]);
  };
  const byCat = group((e) => e.category, (e) => Number(e.amount));
  const byPayer = group((e) => e.paid_by, (e) => Number(e.amount));
  const byUse = group((e) => (e.expense_splits || []).map((s) => [s.member_id, Number(s.amount)]));
  const byKid = group((e) => (e.for_member && (members.find((m) => m.id === e.for_member) || {}).is_child ? e.for_member : null), (e) => Number(e.amount));
  const dates = list.map((e) => e.date).sort();
  const days = dates.length ? Math.round((new Date(dates[dates.length - 1]) - new Date(dates[0])) / 864e5) + 1 : 0;
  const people = casa ? members.filter((m) => !m.is_child).length || 1 : members.length || 1;

  const months = Array.from({ length: 6 }, (_, i) => addM(sel, i - 5));
  const trend = months.map((m) => r2(expenses.filter((e) => e.date.slice(0, 7) === m).reduce((a, e) => a + Number(e.amount), 0)));
  const tmax = Math.max(...trend, 1);

  const setArchived = async (v) => {
    const { error } = await sb.from("groups").update({ archived: v }).eq("id", g.id);
    if (error) return notify(errMsg(error));
    notify(v ? "Viagem encerrada" : "Viagem reaberta");
    reload();
  };

  const Bars = ({ rows, label, color }) => rows.length ? (
    <div className="cbars">
      {rows.map(([k, v], i) => (
        <div className="cbar" key={k}>
          <div className="cbar-name">{label(k)}</div>
          <HBar pct={(v / rows[0][1]) * 100} color={typeof color === "function" ? color(k, i) : color} />
          <div className="cbar-val">{fm(v)}<small>{total ? Math.round((v / total) * 100) : 0}% do total</small></div>
        </div>
      ))}
    </div>
  ) : <div className="empty">Sem dados no período.</div>;

  return (
    <div className="stack">
      <div className="card">
        <div className="card-h"><h2>{casa ? `Resumo de ${monthLabel(sel).toLowerCase()}` : "Resumo da viagem"}</h2>
          {!casa && isAdmin && (g.archived ? <button className="btn ghost" onClick={() => setArchived(false)}>Reabrir viagem</button> : <ConfirmX label="Encerrar viagem" confirmLabel="Confirmar encerramento" onConfirm={() => setArchived(true)} />)}
        </div>
        <div className="tiles">
          <div className="tile"><small>{casa ? "Já pago" : "Já pago"}</small><b>{fm(total)}</b></div>
          <div className="tile"><small>Previsto a pagar</small><b>{fm(totalPend)}</b></div>
          {casa ? <div className="tile"><small>Total do mês por adulto</small><b>{fm((total + totalPend) / people)}</b></div>
            : <div className="tile"><small>Custo total previsto por pessoa</small><b>{fm((total + totalPend) / people)}</b></div>}
          {!casa && <div className="tile"><small>Média paga por dia{days ? ` (${days} ${days === 1 ? "dia" : "dias"})` : ""}</small><b>{fm(days ? total / days : 0)}</b></div>}
        </div>
        {!casa && g.archived && <p className="hint" style={{ marginTop: 12 }}>Viagem encerrada. Os acertos pendentes continuam na aba “Saldos”.</p>}
      </div>

      {casa && (
        <div className="card">
          <div className="card-h"><h2>Gastos da casa nos últimos 6 meses</h2></div>
          <svg viewBox="0 0 360 150" width="100%" style={{ display: "block", maxWidth: 640 }} role="img" aria-label="Gastos por mês">
            <line x1="4" x2="356" y1="124" y2="124" stroke="#E2E9E4" />
            {trend.map((v, i) => {
              const bw = 352 / 6, h = (v / tmax) * 96, x = 4 + i * bw + bw * 0.2, w = bw * 0.6;
              return (
                <g key={months[i]}>
                  <rect x={x} y={124 - h} width={w} height={Math.max(h, v ? 2 : 0)} rx="4" fill={i === 5 ? "#0E9F5A" : "#9ED8B9"} />
                  {v > 0 && <text x={x + w / 2} y={118 - h} textAnchor="middle" fontSize="10" fontWeight="600" fill="#3B4A41">{v >= 1000 ? `${(v / 1000).toFixed(1).replace(".", ",")} mil` : Math.round(v)}</text>}
                  <text x={x + w / 2} y={142} textAnchor="middle" fontSize="11" fill="#6B7A71">{MS[monthIdx(months[i])]}</text>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      <div className="grid2 even">
        <div className="card"><div className="card-h"><h2>Por categoria</h2></div>
          <Bars rows={byCat} label={(k) => <><span>{gcat(g.kind, k).emoji}</span>{gcat(g.kind, k).name}</>} color={(k, i) => (i === 0 ? "#0E9F5A" : i < 3 ? "#4CBF86" : "#A6DCBF")} /></div>
        <div className="card"><div className="card-h"><h2>Quem pagou</h2></div>
          <Bars rows={byPayer} label={(k) => <><Avatar name={nameOf(k)} color={colorFor(members, k)} sm />{nameOf(k)}</>} color={(k) => colorFor(members, k)} /></div>
        <div className="card"><div className="card-h"><h2>Quanto coube a cada um</h2><small>Soma da parte de cada pessoa</small></div>
          <Bars rows={byUse} label={(k) => <><Avatar name={nameOf(k)} color={colorFor(members, k)} sm />{nameOf(k)}</>} color={(k) => colorFor(members, k)} /></div>
        {casa && (
          <div className="card"><div className="card-h"><h2>Gastos com os filhos</h2><small>Despesas marcadas para um filho(a)</small></div>
            {byKid.length ? <Bars rows={byKid} label={(k) => <><span>🧸</span>{nameOf(k)}</>} color="#B7791F" /> :
              <div className="empty">Ao lançar uma despesa, escolha o filho em “Gasto com alguém em especial” para acompanhar aqui.</div>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Convite (código, link e compartilhar) ---------- */
function InviteBox({ g, members }) {
  const link = `${appUrl()}?convite=${g.invite_code}`;
  const [copied, setCopied] = useState("");
  const [err, setErr] = useState("");
  const pending = (members || []).filter((m) => !m.user_id && !m.is_child);
  const text = `Entre no grupo “${g.name}” no Saldo Verde para dividirmos as despesas. Abra o link: ${link} (código ${g.invite_code})`;
  const copy = async (value, what) => {
    try { await navigator.clipboard.writeText(value); setCopied(what); setErr(""); setTimeout(() => setCopied(""), 2200); }
    catch (e) {
      const el = document.getElementById("inv-link");
      if (el) { el.focus(); el.select(); }
      setErr("Não deu para copiar automaticamente. O link está selecionado: toque nele e escolha Copiar.");
    }
  };
  const share = async () => {
    try { await navigator.share({ title: `Convite: ${g.name}`, text }); }
    catch (e) { /* compartilhamento cancelado */ }
  };
  const canShare = typeof navigator !== "undefined" && !!navigator.share;
  return (
    <div className="form">
      {pending.length > 0 && <p className="hint">Esperando entrar: {pending.map((m) => m.name).join(", ")}. Ao abrir o link, a pessoa escolhe o próprio nome.</p>}
      <div className="btnrow">
        {canShare && <button type="button" className="btn" onClick={share}><span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><Icon name="share" size={18} />Enviar convite</span></button>}
        <button type="button" className={canShare ? "btn ghost" : "btn"} style={canShare ? { height: 44 } : null} onClick={() => copy(text, "msg")}>
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Icon name="copy" size={16} />{copied === "msg" ? "Mensagem copiada" : "Copiar mensagem"}</span>
        </button>
      </div>
      <p className="hint">{canShare ? "“Enviar convite” abre o WhatsApp, Mensagens e outros apps do celular." : "Cole a mensagem no WhatsApp ou onde preferir."}</p>
      <div className="code-box">
        <div><small className="hint">Código do grupo</small><br /><code>{g.invite_code}</code></div>
        <button type="button" className="btn ghost" onClick={() => copy(g.invite_code, "code")}>{copied === "code" ? "Copiado" : "Copiar código"}</button>
      </div>
      <div className="field"><label htmlFor="inv-link">Link de convite</label>
        <div className="addline">
          <input id="inv-link" className="input" readOnly value={link} onFocus={(e) => e.target.select()} />
          <button type="button" className="btn ghost" style={{ height: 42 }} onClick={() => copy(link, "link")}>{copied === "link" ? "Copiado" : "Copiar"}</button>
        </div></div>
      {err && <p className="err">{err}</p>}
    </div>
  );
}

function InviteSheet({ g, members, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Convidar pessoas">
        <div className="sheet-h"><h2>Convidar para “{g.name}”</h2><button type="button" className="iconbtn" onClick={onClose} aria-label="Fechar"><Icon name="x" size={18} /></button></div>
        <InviteBox g={g} members={members} />
      </div>
    </div>
  );
}

/* ---------- Pessoas, convite e configurações ---------- */
function PeopleTab({ g, members, me, isAdmin, fm, reload, notify, onBack, onAllowance }) {
  const casa = g.kind === "casa";
  const [add, setAdd] = useState({ name: "", is_child: false, allowance: "" });
  const [editing, setEditing] = useState(null);
  const [ed, setEd] = useState({});
  const [err, setErr] = useState("");
  const [gname, setGname] = useState(g.name);

  const addMember = async (e) => {
    e.preventDefault();
    if (!add.name.trim()) return setErr("Digite o nome da pessoa.");
    const allowance = add.is_child && add.allowance ? parseMoney(add.allowance) : null;
    const { error } = await sb.from("members").insert({ group_id: g.id, name: add.name.trim().slice(0, 40), is_child: add.is_child, allowance: allowance > 0 ? allowance : null });
    if (error) return setErr(errMsg(error));
    setAdd({ name: "", is_child: false, allowance: "" }); setErr("");
    notify("Pessoa adicionada");
    reload();
  };
  const startEdit = (m) => {
    setEditing(m.id);
    setEd({ name: m.name, share: String(Number(m.share)).replace(".", ","), is_child: m.is_child, allowance: m.allowance ? String(Number(m.allowance)).replace(".", ",") : "", role: m.role });
  };
  const saveEdit = async (m) => {
    if (!ed.name.trim()) return setErr("O nome não pode ficar vazio.");
    const share = parseMoney(ed.share);
    const allowance = ed.is_child && ed.allowance ? parseMoney(ed.allowance) : null;
    const { error } = await sb.from("members").update({
      name: ed.name.trim().slice(0, 40), share: share >= 0 ? share : 1, is_child: m.user_id ? false : ed.is_child,
      allowance: allowance > 0 ? allowance : null, role: m.user_id ? ed.role : "membro",
    }).eq("id", m.id);
    if (error) return setErr(errMsg(error));
    setEditing(null); setErr("");
    notify("Dados atualizados");
    reload();
  };
  const removeMember = async (m) => {
    const { error } = await sb.from("members").delete().eq("id", m.id);
    if (error) return setErr(errMsg(error));
    notify(`${m.name} saiu do grupo`);
    reload();
  };
  const rename = async () => {
    if (!gname.trim() || gname.trim() === g.name) return;
    const { error } = await sb.from("groups").update({ name: gname.trim().slice(0, 60) }).eq("id", g.id);
    if (error) return setErr(errMsg(error));
    notify("Nome do grupo alterado");
    reload();
  };
  const leave = async () => {
    const { error } = await sb.rpc("leave_group", { p_group: g.id });
    if (error) return setErr(errMsg(error));
    notify("Você saiu do grupo");
    onBack();
  };
  const destroy = async () => {
    const { error } = await sb.from("groups").delete().eq("id", g.id);
    if (error) return setErr(errMsg(error));
    notify("Grupo excluído");
    onBack();
  };
  const sumShare = members.filter((m) => !m.is_child).reduce((a, m) => a + Number(m.share), 0) || 1;

  return (
    <div className="grid2">
      <div className="stack">
        <div className="card">
          <div className="card-h"><h2>Convidar pessoas</h2></div>
          <InviteBox g={g} members={members} />
        </div>
        <div className="card">
          <div className="card-h"><h2>Pessoas no grupo</h2><small>{members.length}</small></div>
          {err && <p className="err" style={{ marginBottom: 10 }}>{err}</p>}
          <div>
            {members.map((m) => (
              <div className="mrow" key={m.id}>
                <Avatar name={m.name} color={colorFor(members, m.id)} />
                <div className="row-main">
                  <b>{m.name}
                    {me && m.id === me.id && <span className="tag">Você</span>}
                    {m.role === "admin" && <span className="tag">Admin</span>}
                    {m.is_child && <span className="tag">Filho(a)</span>}
                    {!m.user_id && !m.is_child && <span className="tag">Sem login</span>}
                  </b>
                  <span>
                    {casa && !m.is_child ? `Proporção padrão: ${Math.round((Number(m.share) / sumShare) * 100)}%` : ""}
                    {m.is_child && m.allowance ? `Mesada: ${fm(Number(m.allowance))}` : ""}
                    {!casa ? (m.user_id ? "Participa pelo app" : "Ainda não entrou pelo convite") : ""}
                  </span>
                </div>
                <div className="btnrow">
                  {m.is_child && m.allowance && me ? <button className="btn ghost" onClick={() => onAllowance(m)}>Lançar mesada</button> : null}
                  {isAdmin && editing !== m.id && <button className="xbtn" style={{ color: "var(--ink-2)" }} onClick={() => startEdit(m)}>Editar</button>}
                  {isAdmin && (!me || m.id !== me.id) && <ConfirmX label="Remover" confirmLabel="Remover?" onConfirm={() => removeMember(m)} />}
                </div>
                {editing === m.id && (
                  <div className="medit">
                    <div className="fgrid">
                      <div className="field"><label htmlFor={`me-name-${m.id}`}>Nome</label>
                        <input id={`me-name-${m.id}`} className="input" value={ed.name} maxLength={40} onChange={(e) => setEd({ ...ed, name: e.target.value })} /></div>
                      {casa && !ed.is_child && (
                        <div className="field"><label htmlFor={`me-share-${m.id}`}>Peso na divisão proporcional</label>
                          <input id={`me-share-${m.id}`} className="input num" inputMode="decimal" value={ed.share} onChange={(e) => setEd({ ...ed, share: e.target.value })} placeholder="Ex.: 60" /></div>
                      )}
                      {casa && ed.is_child && (
                        <div className="field"><label htmlFor={`me-allow-${m.id}`}>Mesada mensal</label>
                          <input id={`me-allow-${m.id}`} className="input num" inputMode="decimal" value={ed.allowance} onChange={(e) => setEd({ ...ed, allowance: e.target.value })} placeholder="0,00" /></div>
                      )}
                    </div>
                    <div className="btnrow" style={{ alignItems: "center" }}>
                      {casa && !m.user_id && <label className="toggle"><input type="checkbox" checked={ed.is_child} onChange={(e) => setEd({ ...ed, is_child: e.target.checked })} />Filho(a)</label>}
                      {m.user_id && (!me || m.id !== me.id) && <label className="toggle"><input type="checkbox" checked={ed.role === "admin"} onChange={(e) => setEd({ ...ed, role: e.target.checked ? "admin" : "membro" })} />Administrador</label>}
                    </div>
                    <div className="btnrow"><button className="btn sm" onClick={() => saveEdit(m)}>Salvar</button><button className="btn ghost" onClick={() => setEditing(null)}>Cancelar</button></div>
                  </div>
                )}
              </div>
            ))}
          </div>
          {casa && <p className="hint" style={{ marginTop: 10 }}>A proporção padrão é usada quando você escolhe “Proporção” ao dividir. Ex.: pesos 60 e 40 para dividir de acordo com a renda.</p>}
        </div>

        {isAdmin && (
          <form className="card form" onSubmit={addMember} noValidate>
            <div className="card-h" style={{ marginBottom: 0 }}><h2>Adicionar pessoa sem login</h2></div>
            <p className="hint">{casa ? "Use para filhos ou para quem não vai usar o app. Quem tiver celular pode assumir o nome pelo convite." : "Use para quem ainda não instalou o app. Depois a pessoa assume o nome pelo convite."}</p>
            <div className="fgrid">
              <div className="field"><label htmlFor="pp-name">Nome</label>
                <input id="pp-name" className="input" value={add.name} maxLength={40} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></div>
              {casa && add.is_child && (
                <div className="field"><label htmlFor="pp-allow">Mesada mensal (opcional)</label>
                  <input id="pp-allow" className="input num" inputMode="decimal" value={add.allowance} onChange={(e) => setAdd({ ...add, allowance: e.target.value })} placeholder="0,00" /></div>
              )}
            </div>
            {casa && <label className="toggle"><input type="checkbox" checked={add.is_child} onChange={(e) => setAdd({ ...add, is_child: e.target.checked })} />É filho(a)</label>}
            <button className="btn" type="submit">Adicionar</button>
          </form>
        )}
      </div>

      <div className="stack">
        <div className="card form">
          <div className="card-h" style={{ marginBottom: 0 }}><h2>Configurações</h2></div>
          {isAdmin && (
            <div className="field"><label htmlFor="pp-gname">Nome do grupo</label>
              <div className="addline"><input id="pp-gname" className="input" value={gname} maxLength={60} onChange={(e) => setGname(e.target.value)} />
                <button className="btn ghost" style={{ height: 42 }} onClick={rename}>Salvar</button></div></div>
          )}
          <div className="note">Sair do grupo mantém o histórico: seu nome continua nas despesas, sem acesso ao grupo.</div>
          <div className="btnrow">
            {me && <ConfirmX label="Sair do grupo" confirmLabel="Confirmar saída" onConfirm={leave} />}
            {isAdmin && <ConfirmX label="Excluir grupo" confirmLabel="Apagar grupo e todas as despesas?" onConfirm={destroy} />}
          </div>
        </div>
      </div>
    </div>
  );
}
