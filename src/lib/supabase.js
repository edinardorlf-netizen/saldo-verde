import { createClient } from "@supabase/supabase-js";

/* Endereço e chave pública do projeto ficam em config.js (na raiz do site). */
const cfg = (typeof window !== "undefined" && window.SALDO_VERDE_CONFIG) || {};

export const sb =
  cfg.url && cfg.key
    ? createClient(cfg.url, cfg.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "saldo-verde-auth" },
      })
    : null;

export const appUrl = () =>
  typeof location !== "undefined" ? `${location.origin}${location.pathname}` : "";
