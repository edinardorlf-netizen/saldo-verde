-- Sugestões enviadas pelo botão "Enviar sugestão" do app.
-- Qualquer pessoa pode enviar (a parte pessoal não tem login), mas ninguém lê pelo app:
-- a leitura é feita só pelo painel/administrador.
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  kind text not null check (kind in ('sugestao', 'problema', 'elogio')),
  message text not null check (char_length(message) between 3 and 2000),
  rating int check (rating is null or rating between 0 and 10),
  name text check (name is null or char_length(name) <= 60),
  screen text check (screen is null or char_length(screen) <= 60),
  device text check (device is null or char_length(device) <= 300),
  app_version text check (app_version is null or char_length(app_version) <= 20)
);

alter table public.feedback enable row level security;

drop policy if exists "enviar sugestão" on public.feedback;
create policy "enviar sugestão" on public.feedback for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

grant insert on public.feedback to anon, authenticated;
revoke select, update, delete on public.feedback from anon, authenticated;
