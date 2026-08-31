-- ===========================================================================
--  Het personeelsdossier
--
--  Draai dit ná 0008. Opnieuw draaien mag.
--
--  De kern van dit bestand is één scheiding.
--
--  `profiles` mag iedereen lezen die bij Truckwash1 werkt. Dat moet ook: je
--  wilt de naam van je collega kunnen zien, en wie er vandaag staat. Maar
--  daardoor belandt élke kolom van die tabel op het toestel van iedere
--  wasser -- de synchronisatie haalt immers alle rijen op waar je bij mag.
--
--  Een burgerservicenummer, een rekeningnummer of het uurloon van een ander
--  hoort daar niet bij. Die gaan naar een eigen tabel waar alleen het
--  management bij komt, plus de persoon zelf voor zijn eigen regel. Wie er
--  niet bij mag krijgt geen lege velden maar helemaal geen rij.
--
--  Row Level Security werkt per rij, niet per kolom. Een tabel splitsen is
--  daarom niet netjes bedoeld maar noodzakelijk.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Het afgeschermde deel
-- ---------------------------------------------------------------------------

create table if not exists public.personnel_private (
  id                 text primary key,
  user_id            text not null,

  birth_date         bigint,
  birth_place        text,
  nationality        text,

  document_type      text check (document_type in
                       ('paspoort','id-kaart','verblijfsdocument','rijbewijs')),
  document_number    text,
  document_expires   bigint,
  -- Is het nummer met de controlecijfers uit de MRZ nagelopen?
  document_verified  boolean not null default false,

  -- Een werkgever mag het BSN verwerken voor de loonaangifte; daar is het
  -- voor. De app controleert het met de elfproef voordat het hier belandt.
  bsn                text,
  iban               text,
  hourly_rate        numeric,

  emergency_name     text,
  emergency_phone    text,
  emergency_relation text,

  -- Notities van het management. De medewerker ziet deze nooit; daarom
  -- staan ze hier en niet in profiles.notes.
  internal_notes     text,

  updated_at         bigint not null default public.now_ms()
);

create index if not exists prive_user_idx    on public.personnel_private (user_id);
create index if not exists prive_updated_idx on public.personnel_private (updated_at);

-- ---------------------------------------------------------------------------
--  2. Documenten
--
--  Het bestand zelf staat in de opslag. Hier staat alleen wat erover te
--  zeggen valt, inclusief of de medewerker het mag zien.
-- ---------------------------------------------------------------------------

create table if not exists public.documents (
  id                   text primary key,
  user_id              text not null,
  user_name            text not null default '',
  kind                 text not null default 'overig'
                       check (kind in ('identiteitsbewijs','contract','loonstrook',
                                       'diploma','verklaring','beoordeling','overig')),
  title                text not null,
  description          text,

  storage_path         text not null unique,
  mime                 text not null default '',
  size_bytes           integer not null default 0,
  -- SHA-256 van het bestand zoals het is geüpload
  hash                 text,

  -- Het slot waar dit allemaal om draait
  visible_to_employee  boolean not null default true,
  hidden_reason        text,

  uploaded_by          text,
  uploaded_by_name     text default '',
  uploaded_at          bigint not null default public.now_ms(),
  expires_at           bigint,

  requires_signature   boolean not null default false,
  signed_at            bigint,
  signed_by            text,
  signed_name          text,
  signed_hash          text,
  signature_image      text,
  signed_platform      text,
  declined_at          bigint,
  decline_reason       text,

  updated_at           bigint not null default public.now_ms()
);

create index if not exists doc_user_idx    on public.documents (user_id);
create index if not exists doc_kind_idx    on public.documents (kind);
create index if not exists doc_updated_idx on public.documents (updated_at);

do $$
declare t text;
begin
  foreach t in array array['personnel_private','documents'] loop
    execute format('drop trigger if exists stamp_%1$s on public.%1$I', t);
    execute format(
      'create trigger stamp_%1$s before insert or update on public.%1$I
       for each row execute function public.stamp_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
--  3. Het uurloon verhuist mee
--
--  Het stond in profiles en was daarmee zichtbaar voor iedere collega. We
--  nemen de bestaande waarden over en laten de oude kolom leeg achter: hem
--  weggooien zou een oudere versie van de app breken die nog draait.
-- ---------------------------------------------------------------------------

insert into public.personnel_private (id, user_id, hourly_rate)
select p.id, p.id, p.hourly_rate
  from public.profiles p
 where p.hourly_rate is not null
   and p.hourly_rate <> 0
   and not exists (select 1 from public.personnel_private pp where pp.id = p.id)
on conflict (id) do nothing;

update public.personnel_private pp
   set hourly_rate = p.hourly_rate
  from public.profiles p
 where pp.id = p.id
   and pp.hourly_rate is null
   and p.hourly_rate is not null;

update public.profiles set hourly_rate = null where hourly_rate is not null;

-- Interne notities gaan dezelfde kant op.
insert into public.personnel_private (id, user_id, internal_notes)
select p.id, p.id, p.notes
  from public.profiles p
 where coalesce(trim(p.notes), '') <> ''
   and not exists (select 1 from public.personnel_private pp where pp.id = p.id)
on conflict (id) do nothing;

update public.personnel_private pp
   set internal_notes = coalesce(pp.internal_notes, p.notes)
  from public.profiles p
 where pp.id = p.id
   and coalesce(trim(p.notes), '') <> '';

update public.profiles set notes = null where coalesce(trim(notes), '') <> '';

-- ---------------------------------------------------------------------------
--  4. Beveiliging op de gegevens
-- ---------------------------------------------------------------------------

alter table public.personnel_private enable row level security;
alter table public.documents         enable row level security;

-- Je eigen regel mag je zien -- je eigen BSN en rekeningnummer ken je al.
-- De rest is van het management. Wijzigen doet alleen het management: een
-- medewerker die zijn eigen uurloon kan aanpassen is geen dossier.
drop policy if exists prive_select on public.personnel_private;
create policy prive_select on public.personnel_private for select to authenticated
  using (user_id = public.my_id() or public.is_management());

drop policy if exists prive_write on public.personnel_private;
create policy prive_write on public.personnel_private for all to authenticated
  using (public.is_management()) with check (public.is_management());

-- Documenten: het management ziet alles. De medewerker ziet zijn eigen
-- stukken, en alleen die niet op ongezien staan.
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select to authenticated
  using (
    public.is_management()
    or (user_id = public.my_id() and visible_to_employee)
  );

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert to authenticated
  with check (public.is_management());

/*
 * Wijzigen mag het management, en de medewerker mag ondertekenen.
 *
 * Die tweede is smal gehouden: het moet zijn eigen document zijn, hij moet
 * het mogen zien, en er mag nog niet getekend zijn. Wát hij dan mag
 * veranderen staat hieronder in een trigger -- een policy kan niet zeggen
 * "alleen deze kolommen".
 */
drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents for update to authenticated
  using (
    public.is_management()
    or (user_id = public.my_id() and visible_to_employee)
  )
  with check (
    public.is_management()
    or (user_id = public.my_id() and visible_to_employee)
  );

drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents for delete to authenticated
  using (public.is_management());

/*
 * Wat een medewerker aan zijn eigen document mag veranderen: tekenen, of
 * zeggen dat hij niet tekent. Verder niets.
 *
 * Zonder deze trigger zou hij zichzelf op zichtbaar kunnen zetten wat op
 * ongezien staat, of de vingerafdruk kunnen aanpassen waarmee je aantoont
 * dat er niets aan het bestand is veranderd.
 */
create or replace function public.documents_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_management() then
    return new;
  end if;

  -- Alles wat niet met ondertekenen te maken heeft moet gelijk blijven.
  if new.user_id             is distinct from old.user_id
     or new.kind             is distinct from old.kind
     or new.title            is distinct from old.title
     or new.description      is distinct from old.description
     or new.storage_path     is distinct from old.storage_path
     or new.mime             is distinct from old.mime
     or new.size_bytes       is distinct from old.size_bytes
     or new.hash             is distinct from old.hash
     or new.visible_to_employee is distinct from old.visible_to_employee
     or new.hidden_reason    is distinct from old.hidden_reason
     or new.uploaded_by      is distinct from old.uploaded_by
     or new.expires_at       is distinct from old.expires_at
     or new.requires_signature is distinct from old.requires_signature
  then
    raise exception 'Alleen ondertekenen is toegestaan op je eigen document';
  end if;

  -- Eenmaal getekend blijft getekend; terugdraaien doet het management.
  if old.signed_at is not null and new.signed_at is distinct from old.signed_at then
    raise exception 'Dit document is al ondertekend';
  end if;

  -- Tekenen doe je op je eigen naam.
  if new.signed_at is not null and new.signed_by is distinct from public.my_id() then
    raise exception 'Een handtekening staat op je eigen naam';
  end if;

  return new;
end;
$$;

drop trigger if exists documents_bewaak on public.documents;
create trigger documents_bewaak before update on public.documents
  for each row execute function public.documents_bewaak_wijziging();

-- ---------------------------------------------------------------------------
--  5. De opslag
--
--  De bestanden staan in een emmer die van buitenaf dicht zit: er bestaat
--  geen openbaar adres. De app vraagt per keer om een link die na een
--  minuut vervalt.
--
--  De regels hieronder kijken naar de tabel documents. Zo staat de vraag
--  "mag deze persoon hierbij" op één plek, en kan het slot op een document
--  niet omzeild worden door het bestand rechtstreeks op te vragen.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dossiers', 'dossiers', false, 15728640,
  array['application/pdf','image/jpeg','image/png','image/webp','image/heic']
)
on conflict (id) do update
   set public = false,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists dossiers_lezen on storage.objects;
create policy dossiers_lezen on storage.objects for select to authenticated
  using (
    bucket_id = 'dossiers'
    and (
      public.is_management()
      or exists (
        select 1 from public.documents d
         where d.storage_path = storage.objects.name
           and d.user_id = public.my_id()
           and d.visible_to_employee
      )
    )
  );

-- Neerzetten doet alleen het management, en alleen in de map van iemand.
drop policy if exists dossiers_schrijven on storage.objects;
create policy dossiers_schrijven on storage.objects for insert to authenticated
  with check (
    bucket_id = 'dossiers'
    and public.is_management()
    and exists (
      select 1 from public.profiles p
       where p.id = split_part(storage.objects.name, '/', 1)
    )
  );

drop policy if exists dossiers_wissen on storage.objects;
create policy dossiers_wissen on storage.objects for delete to authenticated
  using (bucket_id = 'dossiers' and public.is_management());

drop policy if exists dossiers_bijwerken on storage.objects;
create policy dossiers_bijwerken on storage.objects for update to authenticated
  using (bucket_id = 'dossiers' and public.is_management())
  with check (bucket_id = 'dossiers' and public.is_management());
