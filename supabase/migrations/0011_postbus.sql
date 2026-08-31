-- ===========================================================================
--  Postbus
--
--  Draai dit ná 0010. Opnieuw draaien mag.
--
--  Post die binnenkomt op het adres van het dashboard, en post die eruit
--  gaat. Het ontvangen loopt via een webhook van Resend naar de
--  serverfunctie `ontvang-mail`; die zet het bericht en de bijlagen weg.
--
--  Waarom: bonnen komen per mail binnen. Doorsturen, printen, inscannen en
--  opnieuw invoeren is drie keer werk voor één bedrag. Een mail met een
--  bijlage levert hier meteen een kostenpost op die alleen nog goedgekeurd
--  hoeft te worden -- met de bijlage eraan vast.
-- ===========================================================================

create table if not exists public.mailbox (
  id              text primary key,
  richting        text not null default 'in' check (richting in ('in','uit')),

  van             text not null default '',
  van_naam        text,
  aan             text not null default '',
  onderwerp       text not null default '',
  -- Platte tekst. De app toont dit nooit als HTML; een mail van buiten is
  -- per definitie niet te vertrouwen.
  tekst           text not null default '',
  had_html        boolean not null default false,

  at              bigint not null default public.now_ms(),
  status          text not null default 'nieuw'
                  check (status in ('nieuw','gelezen','verwerkt','genegeerd')),

  -- [{naam, mime, size, path}]
  attachments     jsonb not null default '[]'::jsonb,
  expense_id      text references public.expenses(id) on delete set null,

  handled_by      text,
  handled_by_name text,
  handled_at      bigint,

  provider_id     text,
  -- Wat er precies binnenkwam, ingekort. Alleen voor de ontwikkelaar: als
  -- een bericht niet goed wordt herkend staat hier waarom.
  raw             text,

  updated_at      bigint not null default public.now_ms()
);

create index if not exists mailbox_status_idx  on public.mailbox (status);
create index if not exists mailbox_at_idx      on public.mailbox (at);
create index if not exists mailbox_updated_idx on public.mailbox (updated_at);
-- Voorkomt dat een webhook die twee keer binnenkomt twee bonnen oplevert.
create unique index if not exists mailbox_provider_idx
  on public.mailbox (provider_id) where provider_id is not null;

drop trigger if exists stamp_mailbox on public.mailbox;
create trigger stamp_mailbox before insert or update on public.mailbox
  for each row execute function public.stamp_updated_at();

-- ---------------------------------------------------------------------------
--  De kostenpost weet waar hij vandaan komt
-- ---------------------------------------------------------------------------

alter table public.expenses add column if not exists source          text default 'app';
alter table public.expenses add column if not exists mailbox_id      text;
alter table public.expenses add column if not exists attachment_path text;
alter table public.expenses add column if not exists attachment_name text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_source_check') then
    alter table public.expenses
      add constraint expenses_source_check check (source is null or source in ('app','mail'));
  end if;
end $$;

/*
 * Een bon die per mail binnenkwam is niet door een collega ingediend. Het
 * bestaande beleid eist dat `submitted_by` gelijk is aan de indiener, en dat
 * klopt hier niet -- de serverfunctie zet hem neer namens niemand.
 *
 * Daarom mag het management ook bonnen zien en bijwerken die uit de mail
 * komen, ongeacht wie eronder staat. Zien deden ze dat al; expliciet maken
 * scheelt zoeken als het ooit misgaat.
 */
drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select to authenticated
  using (
    public.is_management()
    or submitted_by = public.my_id()
    or (source = 'mail' and public.is_management())
  );

-- ---------------------------------------------------------------------------
--  Beveiliging op de postbus
--
--  Post die binnenkomt op het bedrijfsadres kan over van alles gaan. Lezen
--  is daarom voor het management en de ontwikkelaar, niet voor iedereen die
--  hier werkt.
--
--  Schrijven doet de serverfunctie met de servicesleutel; die komt overal
--  langs. Het management mag de status bijwerken -- gelezen, verwerkt,
--  genegeerd -- en dat is het.
-- ---------------------------------------------------------------------------

alter table public.mailbox enable row level security;

drop policy if exists mailbox_select on public.mailbox;
create policy mailbox_select on public.mailbox for select to authenticated
  using (public.is_management() or public.is_developer());

drop policy if exists mailbox_update on public.mailbox;
create policy mailbox_update on public.mailbox for update to authenticated
  using (public.is_management() or public.is_developer())
  with check (public.is_management() or public.is_developer());

drop policy if exists mailbox_insert on public.mailbox;
create policy mailbox_insert on public.mailbox for insert to authenticated
  with check (public.is_management() or public.is_developer());

drop policy if exists mailbox_delete on public.mailbox;
create policy mailbox_delete on public.mailbox for delete to authenticated
  using (public.is_management());

-- ---------------------------------------------------------------------------
--  De emmer voor bijlagen
--
--  Apart van de dossiers: een bon uit de mail is iets anders dan een
--  paspoort, en de regels eromheen horen dat ook te zijn.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post', 'post', false, 26214400,
  array['application/pdf','image/jpeg','image/png','image/webp','image/heic',
        'image/gif','text/plain','text/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel','application/xml','text/xml']
)
on conflict (id) do update
   set public = false,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists post_lezen on storage.objects;
create policy post_lezen on storage.objects for select to authenticated
  using (
    bucket_id = 'post'
    and (public.is_management() or public.is_developer())
  );

drop policy if exists post_wissen on storage.objects;
create policy post_wissen on storage.objects for delete to authenticated
  using (bucket_id = 'post' and public.is_management());
