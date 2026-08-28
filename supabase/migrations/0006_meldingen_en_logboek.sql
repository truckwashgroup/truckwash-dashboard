-- ===========================================================================
--  Meldingen aan de ontwikkelaar, en het logboek
--
--  Draai dit ná 0005. Opnieuw draaien mag.
--
--  Anders dan de rest is dit niet per vestiging afgeschermd: een fout in de
--  app raakt iedereen, en de ontwikkelaar moet hem overal kunnen zien. Wat wel
--  geldt: je ziet je eigen meldingen, en verder niets -- tenzij je de rol
--  ontwikkelaar hebt.
-- ===========================================================================

create table if not exists public.tickets (
  id               text primary key,
  number           text not null,
  title            text not null,
  description      text not null default '',
  kind             text not null default 'fout'
                   check (kind in ('fout','vraag','wens','traag')),
  priority         text not null default 'normaal'
                   check (priority in ('laag','normaal','hoog','blokkerend')),
  status           text not null default 'nieuw'
                   check (status in ('nieuw','in behandeling','wacht op melder','opgelost','gesloten')),

  reported_by      text,
  reported_by_name text default '',
  reported_at      bigint not null,
  from_role        text,
  from_page        text,
  location_id      text references public.locations(id) on delete set null,

  -- Technische context, automatisch meegestuurd bij het melden
  app_version      text default '',
  platform         text default '',
  user_agent       text default '',
  screen           text default '',
  online           boolean not null default true,
  pending_changes  integer not null default 0,
  -- Wat de melder het kwartier ervoor deed
  trail            jsonb not null default '[]'::jsonb,

  assigned_to      text,
  assigned_name    text,
  resolved_at      bigint,
  resolution       text,
  fixed_in         text,
  updated_at       bigint not null default public.now_ms()
);

create index if not exists tickets_status_idx   on public.tickets (status);
create index if not exists tickets_reporter_idx on public.tickets (reported_by);
create index if not exists tickets_updated_idx  on public.tickets (updated_at);

create table if not exists public.ticket_messages (
  id          text primary key,
  ticket_id   text not null references public.tickets(id) on delete cascade,
  author_id   text,
  author_name text default '',
  -- Interne notities blijven binnen het ontwikkelteam
  internal    boolean not null default false,
  body        text not null,
  created_at  bigint not null,
  updated_at  bigint not null default public.now_ms()
);

create index if not exists messages_ticket_idx  on public.ticket_messages (ticket_id);
create index if not exists messages_updated_idx on public.ticket_messages (updated_at);

create table if not exists public.log_events (
  id          text primary key,
  level       text not null default 'fout'
              check (level in ('fout','waarschuwing','info')),
  message     text not null,
  stack       text,
  page        text,
  user_id     text,
  user_name   text,
  location_id text,
  app_version text default '',
  platform    text default '',
  at          bigint not null,
  -- Dezelfde fout wordt opgeteld in plaats van herhaald
  count       integer not null default 1,
  ticket_id   text references public.tickets(id) on delete set null,
  updated_at  bigint not null default public.now_ms()
);

create index if not exists logs_level_idx   on public.log_events (level);
create index if not exists logs_at_idx      on public.log_events (at);
create index if not exists logs_updated_idx on public.log_events (updated_at);

do $$
declare t text;
begin
  foreach t in array array['tickets','ticket_messages','log_events'] loop
    execute format('drop trigger if exists stamp_%1$s on public.%1$I', t);
    execute format(
      'create trigger stamp_%1$s before insert or update on public.%1$I
       for each row execute function public.stamp_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
--  Wie is ontwikkelaar?
-- ---------------------------------------------------------------------------

create or replace function public.is_developer()
returns boolean language sql stable as $$
  select 'developer' = any(public.my_roles());
$$;

grant execute on function public.is_developer() to authenticated;

-- De ontwikkelaar telt mee als medewerker, zodat hij de app kan gebruiken.
create or replace function public.is_staff()
returns boolean language sql stable as $$
  select 'employee'   = any(public.my_roles())
      or 'supervisor' = any(public.my_roles())
      or 'technician' = any(public.my_roles())
      or 'management' = any(public.my_roles())
      or 'developer'  = any(public.my_roles());
$$;

-- ---------------------------------------------------------------------------
--  Beveiliging
-- ---------------------------------------------------------------------------

alter table public.tickets         enable row level security;
alter table public.ticket_messages enable row level security;
alter table public.log_events      enable row level security;

-- Je eigen meldingen, en alles als je ontwikkelaar bent.
drop policy if exists tickets_select on public.tickets;
create policy tickets_select on public.tickets for select to authenticated
  using (reported_by = public.my_id() or public.is_developer());

-- Melden mag iedereen die is ingelogd, maar alleen namens zichzelf.
drop policy if exists tickets_insert on public.tickets;
create policy tickets_insert on public.tickets for insert to authenticated
  with check (reported_by = public.my_id());

-- De melder mag zijn eigen melding heropenen; de rest doet de ontwikkelaar.
drop policy if exists tickets_update on public.tickets;
create policy tickets_update on public.tickets for update to authenticated
  using (reported_by = public.my_id() or public.is_developer())
  with check (reported_by = public.my_id() or public.is_developer());

drop policy if exists tickets_delete on public.tickets;
create policy tickets_delete on public.tickets for delete to authenticated
  using (public.is_developer());

-- Berichten: interne notities blijven bij het ontwikkelteam.
drop policy if exists messages_select on public.ticket_messages;
create policy messages_select on public.ticket_messages for select to authenticated
  using (
    public.is_developer()
    or (
      internal = false
      and exists (
        select 1 from public.tickets t
         where t.id = ticket_id and t.reported_by = public.my_id()
      )
    )
  );

drop policy if exists messages_insert on public.ticket_messages;
create policy messages_insert on public.ticket_messages for insert to authenticated
  with check (
    author_id = public.my_id()
    and (
      public.is_developer()
      -- Een melder mag reageren op zijn eigen melding, maar geen interne
      -- notitie schrijven.
      or (
        internal = false
        and exists (
          select 1 from public.tickets t
           where t.id = ticket_id and t.reported_by = public.my_id()
        )
      )
    )
  );

drop policy if exists messages_update on public.ticket_messages;
create policy messages_update on public.ticket_messages for update to authenticated
  using (public.is_developer()) with check (public.is_developer());

-- Logboek: schrijven mag iedereen (de app doet dat automatisch), lezen alleen
-- de ontwikkelaar. Er kan immers een foutmelding in staan die iets prijsgeeft.
drop policy if exists logs_select on public.log_events;
create policy logs_select on public.log_events for select to authenticated
  using (public.is_developer());

drop policy if exists logs_insert on public.log_events;
create policy logs_insert on public.log_events for insert to authenticated
  with check (true);

drop policy if exists logs_update on public.log_events;
create policy logs_update on public.log_events for update to authenticated
  using (true) with check (true);

drop policy if exists logs_delete on public.log_events;
create policy logs_delete on public.log_events for delete to authenticated
  using (public.is_developer());
