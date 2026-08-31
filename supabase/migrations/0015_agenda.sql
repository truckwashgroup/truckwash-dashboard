-- ===========================================================================
--  Agenda
--
--  Draai dit ná 0014. Opnieuw draaien mag.
--
--  Alleen de afspraken die iemand er zelf in zet staan hier. Verjaardagen,
--  jubilea, aflopende contracten en onderhoudsbeurten staan er níét in:
--  die volgen uit gegevens die er al zijn en worden bij het tonen berekend.
--
--  Zou je ze wel opslaan, dan heb je twee waarheden over dezelfde datum. Een
--  geboortedatum die wordt gecorrigeerd geeft dan nog jaren de oude
--  verjaardag, tot iemand toevallig de oude regel opruimt.
-- ===========================================================================

create table if not exists public.agenda_items (
  id              text primary key,
  title           text not null,
  description     text,
  soort           text not null default 'afspraak'
                  check (soort in ('afspraak','verlof','opleiding','onderhoud','overig')),
  start_at        bigint not null,
  end_at          bigint not null,
  hele_dag        boolean not null default false,
  location_id     text references public.locations(id) on delete set null,
  -- Wie erbij moeten zijn
  deelnemers      text[] not null default '{}',
  created_by      text,
  created_by_name text default '',
  created_at      bigint not null default public.now_ms(),
  updated_at      bigint not null default public.now_ms()
);

create index if not exists agenda_start_idx   on public.agenda_items (start_at);
create index if not exists agenda_loc_idx     on public.agenda_items (location_id);
create index if not exists agenda_updated_idx on public.agenda_items (updated_at);

drop trigger if exists stamp_agenda_items on public.agenda_items;
create trigger stamp_agenda_items before insert or update on public.agenda_items
  for each row execute function public.stamp_updated_at();

-- ---------------------------------------------------------------------------
--  Beveiliging
--
--  Zien mag iedereen die hier werkt: een agenda waarin je de helft niet ziet
--  is geen agenda. Wat er per vestiging getoond wordt regelt het scherm.
--
--  Wijzigen doet een leidinggevende, de technische dienst of het management.
--  Wie iets heeft aangemaakt mag het ook zelf weer weghalen.
-- ---------------------------------------------------------------------------

alter table public.agenda_items enable row level security;

drop policy if exists agenda_select on public.agenda_items;
create policy agenda_select on public.agenda_items for select to authenticated
  using (public.is_staff());

drop policy if exists agenda_insert on public.agenda_items;
create policy agenda_insert on public.agenda_items for insert to authenticated
  with check (public.is_staff() and created_by = public.my_id());

drop policy if exists agenda_update on public.agenda_items;
create policy agenda_update on public.agenda_items for update to authenticated
  using (public.is_management() or public.is_supervisor() or created_by = public.my_id())
  with check (public.is_management() or public.is_supervisor() or created_by = public.my_id());

drop policy if exists agenda_delete on public.agenda_items;
create policy agenda_delete on public.agenda_items for delete to authenticated
  using (public.is_management() or public.is_supervisor() or created_by = public.my_id());
