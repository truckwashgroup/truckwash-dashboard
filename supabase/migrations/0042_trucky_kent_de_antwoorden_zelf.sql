-- ===========================================================================
--  Trucky kent de antwoorden zelf
--
--  Tot nu toe ging elke vraag naar het model. Dat is duur voor vragen die
--  iedereen stelt -- "hoe laat zijn jullie open", "kan ik zonder afspraak
--  terecht", "wat kost een buitenwas" -- en het antwoord kan per keer nét
--  anders uitvallen, terwijl je bij zulke vragen juist wilt dat er altijd
--  hetzelfde staat.
--
--  Vanaf hier staan de vragen en antwoorden in de database. De volgorde is:
--
--    1. zoeken in deze tabel. Gevonden? Dan dat antwoord, woordelijk, gratis.
--    2. niets gevonden? Dan het model -- maar met de dichtstbijzijnde
--       antwoorden erbij, zodat het niet gaat verzinnen wat hier al staat.
--    3. mag of kan het model het niet? Dan een contactformulier.
--
--  Zoeken dat tegen een typefout kan
--  ---------------------------------
--
--  Een chauffeur op een telefoon in een wasstraat typt "opeingstijden". Zoeken
--  op exacte woorden vindt dan niets, en dan gaat er een dure vraag naar het
--  model voor iets wat hier gewoon staat.
--
--  Vandaar twee manieren naast elkaar, en de beste van de twee telt:
--
--    woorden      Postgres' eigen tekstzoeken in het Nederlands. Vangt
--                 verbuigingen: "openingstijd" vindt "openingstijden".
--    letters      trigram-gelijkenis. Vangt tikfouten: "opeingstijden" lijkt
--                 voor 80% op "openingstijden", ook al is geen woord gelijk.
--
--  Alleen woorden is te streng, alleen letters is te dom -- die vindt
--  "wasstraat" ook in "waspoeder".
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De twee uitbreidingen, en waarom er een terugval onder staat
--
--  pg_trgm en unaccent zitten in Supabase. In de testdatabase (PGlite, waar
--  scripts/sqltest.mjs op draait) niet -- die kent geen uitbreidingen. Zonder
--  terugval kan dit bestand daar niet eens laden, en dan is er van deze hele
--  migratie niets te controleren.
--
--  De terugval hieronder wordt daarom alleen aangemaakt als de echte functie
--  ontbreekt. Op Supabase gebeurt dat nooit. Het is een stut voor de test, en
--  hij zegt dat ook van zichzelf.
-- ---------------------------------------------------------------------------

do $$
begin
  create extension if not exists pg_trgm;
exception when others then
  raise notice 'pg_trgm niet beschikbaar -- terugval wordt gebruikt';
end $$;

do $$
begin
  create extension if not exists unaccent;
exception when others then
  raise notice 'unaccent niet beschikbaar -- terugval wordt gebruikt';
end $$;

do $$
begin
  if to_regprocedure('unaccent(text)') is null then
    execute $f$
      create function public.unaccent(t text) returns text
      language sql immutable as 'select t';
    $f$;
  end if;

  if to_regprocedure('similarity(text,text)') is null then
    /*
     * Grove vervanger: hoeveel van de woorden komen in allebei voor. Vangt
     * geen tikfouten -- dat is nou juist wat trigrammen wél doen -- maar is
     * genoeg om de rest van dit bestand te laten laden en te controleren.
     * Draait alleen waar pg_trgm ontbreekt, dus nooit op Supabase.
     */
    execute $f$
      create function public.similarity(a text, b text) returns real
      language sql immutable as $s$
        select case
          when coalesce(a,'') = '' or coalesce(b,'') = '' then 0::real
          else (
            select count(*)::real / greatest(1, array_length(
              string_to_array(lower(b), ' '), 1))
              from unnest(string_to_array(lower(a), ' ')) w
             where w <> '' and lower(b) like '%' || w || '%'
          )::real
        end;
      $s$;
    $f$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
--  De vragen en antwoorden
-- ---------------------------------------------------------------------------

create table if not exists public.trucky_vragen (
  id          text primary key,
  vraag       text not null,
  antwoord    text not null,
  /* Andere manieren waarop mensen ernaar vragen. "wanneer open", "hoe laat",
     "openingstijden" horen bij dezelfde vraag, en dit is goedkoper dan er drie
     rijen van maken die je alle drie moet bijwerken. */
  trefwoorden text[] not null default '{}',
  /* Waar de bezoeker verder kan lezen. Wordt een knop onder het antwoord. */
  pagina      text,
  actief      boolean not null default true,
  /* Hoe vaak dit antwoord is gegeven zonder dat het model eraan te pas kwam.
     Zegt welke vragen echt leven -- en dus welke het waard zijn om scherp te
     houden. */
  gebruikt    integer not null default 0,
  updated_at  bigint not null default public.now_ms()
);

comment on table public.trucky_vragen is
  'Vaste vragen en antwoorden voor de chatbot op de website. Wordt eerst '
  'doorzocht; pas als er niets past komt het model eraan te pas.';

/*
 * De index hoort bij pg_trgm en kan er dus alleen zijn waar die uitbreiding is.
 * Bij een handvol vragen maakt hij nog niets uit; hij staat er voor als de
 * lijst groeit.
 */
do $$
begin
  create index if not exists trucky_vragen_vraag_trgm
    on public.trucky_vragen using gin (vraag gin_trgm_ops);
exception when others then
  raise notice 'trigram-index overgeslagen -- pg_trgm ontbreekt';
end $$;

-- ---------------------------------------------------------------------------
--  Wat een bezoeker achterlaat als niemand het kon beantwoorden
--
--  Hier staan naam, adres en telefoonnummer van mensen buiten het bedrijf in.
--  Dat is de reden dat deze tabel strenger dicht zit dan de vragenlijst.
-- ---------------------------------------------------------------------------

create table if not exists public.trucky_contact (
  id            text primary key,
  naam          text not null,
  email         text not null,
  telefoon      text,
  bedrijf       text,
  vraag         text not null,
  /* Het gesprek waar dit uit voortkwam, zodat je ziet wat eraan voorafging. */
  gesprek       text,
  /* Wat er in de chat is gezegd. Zonder dat is de vraag vaak niet te plaatsen:
     "ja graag, om 9 uur" zegt weinig zonder de vraag ervoor. */
  verloop       text,
  status        text not null default 'nieuw'
                check (status in ('nieuw', 'opgepakt', 'beantwoord')),
  antwoord      text,
  behandeld_door      text,
  behandeld_door_naam text,
  behandeld_at  bigint,
  created_at    bigint not null default public.now_ms(),
  updated_at    bigint not null default public.now_ms()
);

comment on table public.trucky_contact is
  'Vragen die de chatbot niet kon of mocht beantwoorden. Komen in het '
  'dashboard bij administratie en management terecht.';

create index if not exists trucky_contact_status_idx
  on public.trucky_contact (status, created_at desc);

-- ---------------------------------------------------------------------------
--  Instellingen die het management zelf zet
--
--  Begonnen om één reden -- naar welk adres een contactverzoek gaat -- maar
--  bewust als lijst en niet als losse kolom ergens. Er komt altijd een tweede.
-- ---------------------------------------------------------------------------

create table if not exists public.instellingen (
  /* id én sleutel: de synchronisatie van de app gaat overal uit van een kolom
     id, en daar een uitzondering voor maken kost meer dan deze kolom. sleutel
     is wat je in de code opzoekt en blijft uniek. */
  id          text primary key,
  sleutel     text not null unique,
  waarde      text not null default '',
  omschrijving text not null default '',
  updated_at  bigint not null default public.now_ms()
);

insert into public.instellingen (id, sleutel, waarde, omschrijving)
values (
  'in_contact_mail',
  'contact_mail',
  'casper@truckwash1group.nl',
  'Naar welk adres een contactverzoek van de website gaat. Meerdere adressen '
  'mag, gescheiden door een komma.'
)
on conflict (sleutel) do nothing;

-- ---------------------------------------------------------------------------
--  Wie mag wat
--
--  De vragenlijst: iedereen die hier werkt mag hem lezen -- hij staat toch op
--  de website. Wijzigen is management, want dit is wat het bedrijf naar buiten
--  zegt.
--
--  De contactverzoeken: administratie en management. Daar staan gegevens van
--  buitenstaanders in, en dat hoeft de wasstraat niet te zien.
--
--  Overal de uitweg voor de upsert-val erbij; zie 0040 voor waarom.
-- ---------------------------------------------------------------------------

alter table public.trucky_vragen  enable row level security;
alter table public.trucky_contact enable row level security;
alter table public.instellingen   enable row level security;

drop policy if exists trucky_vragen_select on public.trucky_vragen;
create policy trucky_vragen_select on public.trucky_vragen for select to authenticated
  using (public.is_staff() or 'technician' = any(public.my_roles())
         or 'developer' = any(public.my_roles()));

drop policy if exists trucky_vragen_insert on public.trucky_vragen;
create policy trucky_vragen_insert on public.trucky_vragen for insert to authenticated
  with check (public.rij_bestaat('public.trucky_vragen'::regclass, id) or public.is_management());

drop policy if exists trucky_vragen_update on public.trucky_vragen;
create policy trucky_vragen_update on public.trucky_vragen for update to authenticated
  using (public.is_management()) with check (public.is_management());

drop policy if exists trucky_vragen_delete on public.trucky_vragen;
create policy trucky_vragen_delete on public.trucky_vragen for delete to authenticated
  using (public.is_management());

/* Administratie of management. heeft_recht() kijkt naar de losse rechten op
   het dossier; is_management() vangt de rol af. */
drop policy if exists trucky_contact_select on public.trucky_contact;
create policy trucky_contact_select on public.trucky_contact for select to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk'));

drop policy if exists trucky_contact_insert on public.trucky_contact;
create policy trucky_contact_insert on public.trucky_contact for insert to authenticated
  with check (public.rij_bestaat('public.trucky_contact'::regclass, id)
              or public.is_management() or public.heeft_recht('admin.desk'));

drop policy if exists trucky_contact_update on public.trucky_contact;
create policy trucky_contact_update on public.trucky_contact for update to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk'))
  with check (public.is_management() or public.heeft_recht('admin.desk'));

drop policy if exists instellingen_select on public.instellingen;
create policy instellingen_select on public.instellingen for select to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk'));

drop policy if exists instellingen_insert on public.instellingen;
create policy instellingen_insert on public.instellingen for insert to authenticated
  with check (public.rij_bestaat('public.instellingen'::regclass, id)
              or public.is_management());

drop policy if exists instellingen_update on public.instellingen;
create policy instellingen_update on public.instellingen for update to authenticated
  using (public.is_management()) with check (public.is_management());

-- ---------------------------------------------------------------------------
--  Zoeken
--
--  Geeft de beste treffers terug met een cijfer tussen 0 en 1. De functie
--  bepaalt niet wat "goed genoeg" is -- dat staat in de edge function, zodat
--  bijstellen geen migratie kost.
-- ---------------------------------------------------------------------------

create or replace function public.trucky_zoek(vraag_in text, hoeveel integer default 3)
returns table (id text, vraag text, antwoord text, pagina text, score real)
language sql stable security definer set search_path = public as $$
  with schoon as (
    select lower(unaccent(coalesce(vraag_in, ''))) as q
  )
  select
    v.id, v.vraag, v.antwoord, v.pagina,
    greatest(
      -- op letters: vangt tikfouten
      similarity(s.q, lower(unaccent(v.vraag))),
      -- op letters, tegen de trefwoorden
      coalesce((
        select max(similarity(s.q, lower(unaccent(t))))
          from unnest(v.trefwoorden) t
      ), 0),
      -- op woorden: vangt verbuigingen. ts_rank geeft kleine getallen, dus
      -- opgetrokken naar dezelfde schaal als de rest.
      least(1.0, ts_rank(
        to_tsvector('dutch',
          v.vraag || ' ' || coalesce(array_to_string(v.trefwoorden, ' '), '')),
        plainto_tsquery('dutch', s.q)
      ) * 8)
    )::real as score
  from public.trucky_vragen v, schoon s
  where v.actief
    and length(s.q) > 2
  order by score desc
  limit greatest(1, least(hoeveel, 10));
$$;

/* Zie 0033/0034: nieuwe functies krijgen anon er gratis bij. Dit is een
   security definer-functie, dus die deur gaat dicht. De edge function draait
   met de servicesleutel. */
revoke execute on function public.trucky_zoek(text, integer) from public, anon, authenticated;
grant  execute on function public.trucky_zoek(text, integer) to service_role;

/*
 * De teller ophogen.
 *
 * Een eigen functie omdat PostgREST geen "gebruikt = gebruikt + 1" kent -- via
 * de REST-laag zou het lezen-en-terugschrijven worden, en dan telt bij twee
 * bezoekers tegelijk één van de twee niet mee.
 */
create or replace function public.trucky_vraag_gebruikt(vraag_id text)
returns void
language sql security definer set search_path = public as $$
  update public.trucky_vragen
     set gebruikt = gebruikt + 1, updated_at = public.now_ms()
   where id = vraag_id;
$$;

revoke execute on function public.trucky_vraag_gebruikt(text) from public, anon, authenticated;
grant  execute on function public.trucky_vraag_gebruikt(text) to service_role;

-- ---------------------------------------------------------------------------
--  Een startlijst
--
--  Twaalf vragen die op elke wasstraat langskomen. Bedoeld om meteen iets te
--  hebben; het management kan ze in de app wijzigen en aanvullen.
--
--  De antwoorden zijn met opzet kort en zonder cijfers die verouderen -- voor
--  prijzen en tijden verwijzen ze naar de pagina waar het echte getal staat.
-- ---------------------------------------------------------------------------

insert into public.trucky_vragen (id, vraag, antwoord, trefwoorden, pagina) values
  ('tv_afspraak', 'Moet ik een afspraak maken?',
   'Nee, je kunt zonder afspraak langskomen bij al onze vestigingen. Even bellen mag natuurlijk altijd als je zeker wilt weten dat het rustig is.',
   array['afspraak','reserveren','zonder afspraak','moet ik bellen'], '/locaties/'),

  ('tv_open', 'Hoe laat zijn jullie open?',
   'Dat verschilt per vestiging. Op de locatiepagina staan de openingstijden van elke vestiging, en je kunt daar ook op postcode zoeken welke het dichtst bij je is.',
   array['openingstijden','hoe laat open','wanneer open','tijden','geopend'], '/locaties/'),

  ('tv_prijs', 'Wat kost een wasbeurt?',
   'Alle tarieven staan op de prijzenpagina, inclusief de toeslagen. De prijzen zijn exclusief 21% btw.',
   array['prijs','kosten','tarief','wat kost','hoeveel kost'], '/prijzen/'),

  ('tv_waar', 'Waar zitten jullie?',
   'We hebben achttien vestigingen door heel Nederland. Op de locatiepagina vind je ze allemaal op de kaart, en kun je op postcode zoeken welke het dichtst bij je is.',
   array['vestigingen','locaties','waar zitten jullie','adres','dichtstbijzijnde'], '/locaties/'),

  ('tv_betalen', 'Hoe kan ik betalen?',
   'Pinnen kan bij elke vestiging. Rijd je vaker bij ons binnen, dan is een account op rekening vaak handiger -- bel daarvoor 088 - 0600 100.',
   array['betalen','pinnen','pin','contant','op rekening','factuur'], '/contact/'),

  ('tv_haccp', 'Reinigen jullie ook laadruimtes?',
   'Ja, we reinigen laadruimtes inwendig, HACCP- en NAO-gecertificeerd. Ontsmetten en desinfecteren kan ook.',
   array['haccp','nao','laadruimte','inwendig','ontsmetten','desinfecteren','tank'],
   '/diensten/haccp-certificaat-en-behandeling/'),

  ('tv_alcoa', 'Poetsen jullie ook velgen?',
   'Ja, we doen Alcoa- en Dura Bright-behandelingen en reinigen alle aluminium onderdelen.',
   array['velgen','alcoa','dura bright','aluminium','polijsten'],
   '/diensten/alcoa-velgen-reinigen/'),

  ('tv_camper', 'Wassen jullie ook campers en bussen?',
   'Ja, campers en bussen kunnen bij ons terecht. Kijk even op de dienstenpagina welke vestiging bij jouw voertuig past.',
   array['camper','bus','bussen','touringcar','bestelbus'], '/diensten/'),

  ('tv_vacature', 'Hebben jullie vacatures?',
   'Ja, we zoeken regelmatig mensen. Je hebt er geen diploma voor nodig, wel de wil om te leren. Op de vacaturepagina staan de openstaande functies en kun je meteen solliciteren.',
   array['vacature','werken','baan','solliciteren','werk','personeel gezocht'],
   '/werken-bij/'),

  ('tv_wachttijd', 'Hoe lang duurt een wasbeurt?',
   'Een buitenwas duurt ongeveer een half uur. Bij drukte kan het wat langer zijn; op de meeste vestigingen kun je ondertussen wachten met een kop koffie.',
   array['hoe lang','wachttijd','duur','snel klaar'], '/locaties/'),

  ('tv_truckparking', 'Kan ik bij jullie parkeren of overnachten?',
   'Op een aantal vestigingen is truckparking. Op de dienstenpagina zie je waar dat kan.',
   array['parkeren','truckparking','overnachten','slapen','parking'],
   '/diensten/truckparking/'),

  ('tv_contact', 'Hoe kan ik contact opnemen?',
   'Bel 088 - 0600 100 of mail info@truckwash1group.nl. Elke vestiging heeft ook een eigen nummer; dat staat op de locatiepagina.',
   array['contact','bellen','telefoonnummer','mailen','e-mail'], '/contact/')
on conflict (id) do nothing;
