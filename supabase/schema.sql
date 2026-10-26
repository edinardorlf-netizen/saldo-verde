-- =====================================================================
-- Saldo Verde · banco de dados dos grupos compartilhados
-- (Casa/Família e Viagem)
--
-- Como usar: no painel do Supabase, abra "SQL Editor" → "New query",
-- cole este arquivo inteiro e clique em "Run". Rode uma única vez.
-- =====================================================================

-- ---------- Perfis (nome de quem tem login) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Grupos ----------
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  kind text not null check (kind in ('casa', 'viagem')),
  emoji text not null default '🏠',
  currency text not null default 'BRL',
  invite_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  archived boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------- Membros ----------
-- user_id vazio = pessoa sem login (ex.: filhos, ou alguém que ainda não entrou).
create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null check (char_length(name) between 1 and 40),
  role text not null default 'membro' check (role in ('admin', 'membro')),
  is_child boolean not null default false,
  share numeric(8,2) not null default 1 check (share >= 0),
  allowance numeric(12,2) check (allowance is null or allowance >= 0),
  created_at timestamptz not null default now(),
  unique (group_id, user_id)
);

-- ---------- Contas que se repetem (ex.: aluguel, internet) ----------
create table if not exists public.recurring (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  description text not null check (char_length(description) between 1 and 80),
  amount numeric(12,2) not null check (amount > 0),
  category text not null default 'outros',
  paid_by uuid references public.members(id) on delete set null,
  for_member uuid references public.members(id) on delete set null,
  split_mode text not null default 'igual' check (split_mode in ('igual', 'proporcao', 'valor')),
  split_weights jsonb not null default '{}'::jsonb,
  day int not null check (day between 1 and 31),
  start_month date not null,
  months int check (months is null or months between 1 and 120),
  end_month date,
  skipped date[] not null default '{}',
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------- Despesas ----------
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  description text not null check (char_length(description) between 1 and 80),
  amount numeric(12,2) not null check (amount > 0),
  category text not null default 'outros',
  date date not null default current_date,
  paid_by uuid not null references public.members(id) on delete restrict,
  for_member uuid references public.members(id) on delete set null,
  split_mode text not null default 'igual' check (split_mode in ('igual', 'proporcao', 'valor')),
  -- 'previsto' = conta a pagar: aparece na lista, mas não entra nos saldos até ser paga
  status text not null default 'pago' check (status in ('pago', 'previsto')),
  recurring_id uuid references public.recurring(id) on delete set null,
  occurrence date,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (recurring_id, occurrence)
);

-- Quanto cada pessoa deve de cada despesa
create table if not exists public.expense_splits (
  expense_id uuid not null references public.expenses(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete restrict,
  amount numeric(12,2) not null check (amount >= 0),
  primary key (expense_id, member_id)
);

-- ---------- Acertos (pagamentos entre membros) ----------
create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  from_member uuid not null references public.members(id) on delete restrict,
  to_member uuid not null references public.members(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  date date not null default current_date,
  note text,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (from_member <> to_member)
);

create index if not exists members_group_idx on public.members(group_id);
create index if not exists members_user_idx on public.members(user_id);
create index if not exists expenses_group_date_idx on public.expenses(group_id, date);
create index if not exists splits_member_idx on public.expense_splits(member_id);
create index if not exists settlements_group_idx on public.settlements(group_id);
create index if not exists recurring_group_idx on public.recurring(group_id);

-- ---------- Funções auxiliares de permissão ----------
create or replace function public.is_member(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where group_id = gid and user_id = auth.uid());
$$;

create or replace function public.is_admin(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where group_id = gid and user_id = auth.uid() and role = 'admin');
$$;

-- ---------- Segurança por linha: cada um só vê os próprios grupos ----------
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.members enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.settlements enable row level security;
alter table public.recurring enable row level security;

drop policy if exists "perfil próprio" on public.profiles;
create policy "perfil próprio" on public.profiles for select using (id = auth.uid());
drop policy if exists "editar perfil próprio" on public.profiles;
create policy "editar perfil próprio" on public.profiles for update using (id = auth.uid());

drop policy if exists "ver grupo" on public.groups;
create policy "ver grupo" on public.groups for select using (public.is_member(id));
drop policy if exists "admin edita grupo" on public.groups;
create policy "admin edita grupo" on public.groups for update using (public.is_admin(id)) with check (public.is_admin(id));
drop policy if exists "admin apaga grupo" on public.groups;
create policy "admin apaga grupo" on public.groups for delete using (public.is_admin(id));

drop policy if exists "ver membros" on public.members;
create policy "ver membros" on public.members for select using (public.is_member(group_id));
drop policy if exists "admin adiciona membro" on public.members;
create policy "admin adiciona membro" on public.members for insert with check (public.is_admin(group_id) and user_id is null);
drop policy if exists "admin edita membro" on public.members;
create policy "admin edita membro" on public.members for update using (public.is_admin(group_id)) with check (public.is_admin(group_id));
drop policy if exists "admin remove membro" on public.members;
create policy "admin remove membro" on public.members for delete using (public.is_admin(group_id) and user_id is distinct from auth.uid());

drop policy if exists "ver despesas" on public.expenses;
create policy "ver despesas" on public.expenses for select using (public.is_member(group_id));
drop policy if exists "lançar despesa" on public.expenses;
create policy "lançar despesa" on public.expenses for insert with check (public.is_member(group_id) and created_by = auth.uid());
drop policy if exists "editar despesa" on public.expenses;
create policy "editar despesa" on public.expenses for update using (public.is_member(group_id)) with check (public.is_member(group_id));
drop policy if exists "apagar despesa" on public.expenses;
create policy "apagar despesa" on public.expenses for delete using (created_by = auth.uid() or public.is_admin(group_id));

drop policy if exists "ver divisões" on public.expense_splits;
create policy "ver divisões" on public.expense_splits for select
  using (exists (select 1 from public.expenses e where e.id = expense_id and public.is_member(e.group_id)));
drop policy if exists "gravar divisões" on public.expense_splits;
create policy "gravar divisões" on public.expense_splits for insert
  with check (exists (select 1 from public.expenses e where e.id = expense_id and public.is_member(e.group_id)));
drop policy if exists "apagar divisões" on public.expense_splits;
create policy "apagar divisões" on public.expense_splits for delete
  using (exists (select 1 from public.expenses e where e.id = expense_id and public.is_member(e.group_id)));

drop policy if exists "ver acertos" on public.settlements;
create policy "ver acertos" on public.settlements for select using (public.is_member(group_id));
drop policy if exists "registrar acerto" on public.settlements;
create policy "registrar acerto" on public.settlements for insert with check (public.is_member(group_id) and created_by = auth.uid());
drop policy if exists "apagar acerto" on public.settlements;
create policy "apagar acerto" on public.settlements for delete using (created_by = auth.uid() or public.is_admin(group_id));

drop policy if exists "ver contas fixas" on public.recurring;
create policy "ver contas fixas" on public.recurring for select using (public.is_member(group_id));
drop policy if exists "criar conta fixa" on public.recurring;
create policy "criar conta fixa" on public.recurring for insert with check (public.is_member(group_id) and created_by = auth.uid());
drop policy if exists "editar conta fixa" on public.recurring;
create policy "editar conta fixa" on public.recurring for update using (public.is_member(group_id)) with check (public.is_member(group_id));
drop policy if exists "apagar conta fixa" on public.recurring;
create policy "apagar conta fixa" on public.recurring for delete using (created_by = auth.uid() or public.is_admin(group_id));

-- ---------- Funções chamadas pelo app ----------

-- Cria um grupo, coloca quem criou como administrador e cadastra os demais participantes.
create or replace function public.create_group(
  p_name text, p_kind text, p_emoji text, p_currency text, p_my_name text, p_others jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare gid uuid; o jsonb;
begin
  if auth.uid() is null then raise exception 'Faça login para criar um grupo'; end if;
  insert into groups (name, kind, emoji, currency, created_by)
  values (trim(p_name), p_kind, coalesce(nullif(p_emoji, ''), '🏠'), coalesce(nullif(p_currency, ''), 'BRL'), auth.uid())
  returning id into gid;
  insert into members (group_id, user_id, name, role)
  values (gid, auth.uid(), coalesce(nullif(trim(p_my_name), ''), 'Eu'), 'admin');
  for o in select * from jsonb_array_elements(coalesce(p_others, '[]'::jsonb)) loop
    if nullif(trim(o->>'name'), '') is not null then
      insert into members (group_id, name, is_child)
      values (gid, trim(o->>'name'), coalesce((o->>'is_child')::boolean, false));
    end if;
  end loop;
  return gid;
end $$;

-- Mostra o grupo de um convite antes de entrar (nome e vagas de quem ainda não tem login).
create or replace function public.group_preview(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', g.id, 'name', g.name, 'kind', g.kind, 'emoji', g.emoji,
    'already', exists (select 1 from members where group_id = g.id and user_id = auth.uid()),
    'open', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.created_at)
      from members m where m.group_id = g.id and m.user_id is null and not m.is_child), '[]'::jsonb))
  from groups g
  where g.invite_code = upper(trim(p_code)) and auth.uid() is not null;
$$;

-- Entra no grupo pelo código. p_claim = assumir um nome já cadastrado sem login.
create or replace function public.join_group(p_code text, p_name text, p_claim uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  if auth.uid() is null then raise exception 'Faça login para entrar no grupo'; end if;
  select id into gid from groups where invite_code = upper(trim(p_code));
  if gid is null then raise exception 'Código de convite não encontrado'; end if;
  if exists (select 1 from members where group_id = gid and user_id = auth.uid()) then return gid; end if;
  if p_claim is not null then
    update members set user_id = auth.uid()
    where id = p_claim and group_id = gid and user_id is null and not is_child;
    if found then return gid; end if;
  end if;
  insert into members (group_id, user_id, name)
  values (gid, auth.uid(), coalesce(nullif(trim(p_name), ''), 'Membro'));
  return gid;
end $$;

-- Sai do grupo sem apagar o histórico (o nome fica, sem login).
create or replace function public.leave_group(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
declare mid uuid; myrole text;
begin
  select id, role into mid, myrole from members where group_id = p_group and user_id = auth.uid();
  if mid is null then return; end if;
  if myrole = 'admin' and not exists (
    select 1 from members where group_id = p_group and role = 'admin' and id <> mid and user_id is not null) then
    update members set role = 'admin'
    where id = (select id from members where group_id = p_group and user_id is not null and id <> mid
                order by created_at limit 1);
  end if;
  update members set user_id = null, role = 'membro' where id = mid;
end $$;

-- Grava (ou edita) uma despesa junto com a divisão, numa única operação.
-- p_status: 'pago' ou 'previsto'. p_recurring/p_occurrence: parcela do mês de uma conta fixa.
create or replace function public.save_expense(
  p_id uuid, p_group uuid, p_description text, p_amount numeric, p_category text, p_date date,
  p_paid_by uuid, p_for uuid, p_mode text, p_splits jsonb,
  p_status text default 'pago', p_recurring uuid default null, p_occurrence date default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare eid uuid; total numeric;
begin
  if not public.is_member(p_group) then raise exception 'Você não participa deste grupo'; end if;
  if not exists (select 1 from members where id = p_paid_by and group_id = p_group) then
    raise exception 'Quem pagou precisa fazer parte do grupo';
  end if;
  if p_for is not null and not exists (select 1 from members where id = p_for and group_id = p_group) then
    raise exception 'A pessoa beneficiada precisa fazer parte do grupo';
  end if;
  if jsonb_array_length(coalesce(p_splits, '[]'::jsonb)) = 0 then
    raise exception 'Escolha pelo menos uma pessoa na divisão';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_splits) x
    where not exists (select 1 from members m where m.id = (x->>'member_id')::uuid and m.group_id = p_group)) then
    raise exception 'A divisão inclui alguém de fora do grupo';
  end if;
  if p_recurring is not null and not exists (select 1 from recurring where id = p_recurring and group_id = p_group) then
    raise exception 'Conta fixa não encontrada neste grupo';
  end if;
  select coalesce(sum((x->>'amount')::numeric), 0) into total from jsonb_array_elements(p_splits) x;
  if abs(total - p_amount) > 0.01 then
    raise exception 'A soma da divisão (%) é diferente do valor da despesa (%)', total, p_amount;
  end if;

  if p_id is null then
    insert into expenses (group_id, description, amount, category, date, paid_by, for_member, split_mode, status, recurring_id, occurrence)
    values (p_group, trim(p_description), p_amount, p_category, p_date, p_paid_by, p_for, p_mode,
            coalesce(p_status, 'pago'), p_recurring, case when p_recurring is null then null else date_trunc('month', p_occurrence)::date end)
    returning id into eid;
  else
    update expenses
       set description = trim(p_description), amount = p_amount, category = p_category, date = p_date,
           paid_by = p_paid_by, for_member = p_for, split_mode = p_mode, status = coalesce(p_status, 'pago')
     where id = p_id and group_id = p_group
    returning id into eid;
    if eid is null then raise exception 'Despesa não encontrada'; end if;
    delete from expense_splits where expense_id = eid;
  end if;

  insert into expense_splits (expense_id, member_id, amount)
  select eid, (x->>'member_id')::uuid, (x->>'amount')::numeric
  from jsonb_array_elements(p_splits) x
  where (x->>'amount')::numeric > 0;
  return eid;
end $$;

-- Somente usuários logados podem chamar as funções.
revoke execute on function public.create_group(text, text, text, text, text, jsonb) from public, anon;
revoke execute on function public.group_preview(text) from public, anon;
revoke execute on function public.join_group(text, text, uuid) from public, anon;
revoke execute on function public.leave_group(uuid) from public, anon;
revoke execute on function public.save_expense(uuid, uuid, text, numeric, text, date, uuid, uuid, text, jsonb, text, uuid, date) from public, anon;
grant execute on function public.create_group(text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.group_preview(text) to authenticated;
grant execute on function public.join_group(text, text, uuid) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.save_expense(uuid, uuid, text, numeric, text, date, uuid, uuid, text, jsonb, text, uuid, date) to authenticated;

-- ---------- Atualização em tempo real entre os celulares ----------
do $$
begin
  begin alter publication supabase_realtime add table public.expenses; exception when others then null; end;
  begin alter publication supabase_realtime add table public.settlements; exception when others then null; end;
  begin alter publication supabase_realtime add table public.members; exception when others then null; end;
  begin alter publication supabase_realtime add table public.groups; exception when others then null; end;
  begin alter publication supabase_realtime add table public.recurring; exception when others then null; end;
end $$;
