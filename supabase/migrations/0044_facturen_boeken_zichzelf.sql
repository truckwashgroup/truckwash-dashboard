-- ===========================================================================
--  Facturen boeken zichzelf
--
--  Wat er nu gebeurt: er komt een factuur binnen per mail, ontvang-mail zet er
--  een kostenpost van met bedrag 0, en daar blijft het. Het uitlezen gebeurt
--  pas als iemand in de app op "laat de factuur voorlezen" drukt. Dat is
--  precies het handwerk dat weg moest.
--
--  Wat hier bijkomt is wat er nodig is om dat automatisch te doen: een
--  grootboek om op te boeken, tags om op te sorteren, en een geheugen dat
--  onthoudt hoe een leverancier de vorige keer is geboekt.
--
--  Het geheugen is het belangrijkste stuk
--  --------------------------------------
--
--  Raden op trefwoorden werkt één keer. Daarna weet je iets beters: hoe die
--  leverancier de vorige keer is geboekt, door een mens die ernaar keek. Dat
--  is een veel sterker signaal dan welk trefwoord ook.
--
--  Dus twee lagen. Kent het geheugen deze leverancier, dan die boeking. Zo
--  niet, dan trefwoorden als eerste gok, duidelijk gemarkeerd als gok. En elke
--  keer dat iemand een kostenpost goedkeurt, leert het geheugen bij.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Het grootboek
--
--  Alleen de rekeningen die hier werkelijk gebruikt worden. Een compleet
--  rekeningschema overtypen levert een lijst op waar niemand doorheen komt.
-- ---------------------------------------------------------------------------

create table if not exists public.grootboek (
  /* De sleutel heet id en niet code, en dat is geen smaakkwestie.
     De synchronisatie in de app vergelijkt elke binnengehaalde rij met wat er
     nog in de wachtrij staat, en doet dat op rij.id -- voor alle tabellen,
     zonder uitzondering. Een tabel met een andere sleutelnaam levert daar
     stilletjes "undefined" op, en dan overschrijft binnenkomende post een
     wijziging die nog niet verstuurd was. Eén afwijkende tabel is die klasse
     fouten niet waard. */
  id          text primary key,
  code        text not null unique,
  naam        text not null,
  /* Waar deze rekening op te herkennen is, als het geheugen nog niets weet. */
  trefwoorden text[] not null default '{}',
  /* Het gebruikelijke btw-percentage. Wat op de factuur staat gaat altijd
     voor -- dit is alleen een vangnet voor een onleesbare bon. */
  btw_pct     integer not null default 21,
  actief      boolean not null default true,
  updated_at  bigint not null default public.now_ms()
);

comment on table public.grootboek is
  'De grootboekrekeningen waarop kosten worden geboekt. Klein gehouden: '
  'alleen wat hier echt gebruikt wordt.';

-- ---------------------------------------------------------------------------
--  De tags
--
--  Losse etiketten om op te filteren, naast de grootboekrekening. Een factuur
--  van Enexis is "elektra" en boekt op energie; die twee zijn niet hetzelfde
--  en het een vervangt het ander niet.
-- ---------------------------------------------------------------------------

create table if not exists public.kosten_tags (
  -- Zelfde reden als bij grootboek hierboven: de sleutel heet id.
  id          text primary key,
  naam        text not null unique,
  trefwoorden text[] not null default '{}',
  actief      boolean not null default true,
  updated_at  bigint not null default public.now_ms()
);

-- ---------------------------------------------------------------------------
--  Het geheugen
--
--  Eén regel per leverancier: zo is hij de vorige keer geboekt. Wordt bij elke
--  goedkeuring bijgewerkt, zodat de tweede factuur van dezelfde partij vanzelf
--  goed staat.
--
--  De sleutel is de leveranciersnaam in kleine letters. Niet het btw-nummer:
--  dat staat lang niet op elke bon, en dan zou het geheugen juist bij de
--  slordige leveranciers niets onthouden.
-- ---------------------------------------------------------------------------

create table if not exists public.leverancier_boeking (
  leverancier    text primary key,
  grootboek_code text references public.grootboek(code) on delete set null,
  tags           text[] not null default '{}',
  /* Hoe vaak het zo is geboekt. Eén keer is een aanwijzing, tien keer is een
     gewoonte -- en dat verschil wil je kunnen zien voordat je erop vertrouwt. */
  keren          integer not null default 1,
  laatst_at      bigint not null default public.now_ms(),
  updated_at     bigint not null default public.now_ms()
);

-- ---------------------------------------------------------------------------
--  Wat er op de kostenpost bijkomt
-- ---------------------------------------------------------------------------

alter table public.expenses add column if not exists tags           text[] not null default '{}';
alter table public.expenses add column if not exists grootboek_code text;
alter table public.expenses add column if not exists factuurnummer  text;
alter table public.expenses add column if not exists vervaldatum    bigint;
alter table public.expenses add column if not exists btw_bedrag     numeric(12,2);
/* Waar de indeling vandaan komt: uit het geheugen, geraden, of met de hand
   gezet. Zonder dit weet niemand of dat rekeningnummer een gok is. */
alter table public.expenses add column if not exists indeling_bron  text
  check (indeling_bron in ('geheugen', 'geraden', 'handmatig'));

comment on column public.expenses.indeling_bron is
  'Waar grootboek_code en tags vandaan komen. "geraden" betekent: op '
  'trefwoorden gegokt omdat deze leverancier nog niet bekend was -- daar hoort '
  'iemand naar te kijken.';

-- ---------------------------------------------------------------------------
--  Voorstellen
--
--  Geeft terug hoe deze factuur waarschijnlijk geboekt moet worden. Beslist
--  niets: de aanroeper zet het op de kostenpost en een mens keurt goed.
-- ---------------------------------------------------------------------------

create or replace function public.factuur_indelen(
  leverancier_in text,
  omschrijving_in text default ''
)
returns table (grootboek_code text, tags text[], bron text)
language sql stable security definer set search_path = public as $$
  with zoek as (
    select
      lower(trim(coalesce(leverancier_in, ''))) as lev,
      lower(coalesce(leverancier_in, '') || ' ' || coalesce(omschrijving_in, '')) as alles
  ),
  -- 1. Kennen we deze leverancier?
  uit_geheugen as (
    select b.grootboek_code, b.tags, 'geheugen'::text as bron
      from public.leverancier_boeking b, zoek z
     where b.leverancier = z.lev
       and b.grootboek_code is not null
  ),
  -- 2. Zo niet: raden op trefwoorden.
  geraden_rekening as (
    select g.code
      from public.grootboek g, zoek z
     where g.actief
       and exists (select 1 from unnest(g.trefwoorden) t
                    where t <> '' and z.alles like '%' || lower(t) || '%')
     order by g.code
     limit 1
  ),
  geraden_tags as (
    select coalesce(array_agg(k.naam order by k.naam), '{}') as tags
      from public.kosten_tags k, zoek z
     where k.actief
       and exists (select 1 from unnest(k.trefwoorden) t
                    where t <> '' and z.alles like '%' || lower(t) || '%')
  )
  select * from uit_geheugen
  union all
  select (select code from geraden_rekening),
         (select tags from geraden_tags),
         'geraden'
   where not exists (select 1 from uit_geheugen)
  limit 1;
$$;

/*
 * Leren van een goedkeuring.
 *
 * Wordt aangeroepen als iemand een kostenpost akkoord geeft. Vanaf dat moment
 * staat de volgende factuur van diezelfde partij meteen goed.
 */
create or replace function public.boeking_onthouden(
  leverancier_in text,
  grootboek_in text,
  tags_in text[]
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  sleutel text := lower(trim(coalesce(leverancier_in, '')));
begin
  /*
   * Wie hier niets te zoeken heeft, leert het geheugen ook niets.
   *
   * Deze functie is security definer en stond open voor iedere ingelogde
   * gebruiker. Een monteur ziet geen enkele kostenpost, maar kon wel bepalen
   * op welke rekening de facturen van een leverancier voortaan landen -- en
   * dat zou niemand merken, want het is precies wat de functie hoort te doen.
   *
   * Stil weglopen en niet klagen: dit wordt aangeroepen naast een
   * goedkeuring, en die mag niet stuklopen op een recht dat er toch al voor
   * zorgt dat je hier niet komt.
   */
  if not (public.is_management() or public.heeft_recht('admin.desk')) then
    return;
  end if;

  if sleutel = '' or grootboek_in is null then return; end if;

  insert into public.leverancier_boeking
    (leverancier, grootboek_code, tags, keren, laatst_at, updated_at)
  values (sleutel, grootboek_in, coalesce(tags_in, '{}'), 1,
          public.now_ms(), public.now_ms())
  on conflict (leverancier) do update
    set grootboek_code = excluded.grootboek_code,
        tags           = excluded.tags,
        -- Doortellen, niet resetten: het aantal keren is het vertrouwen.
        keren          = public.leverancier_boeking.keren + 1,
        laatst_at      = public.now_ms(),
        updated_at     = public.now_ms();
end;
$$;

-- ---------------------------------------------------------------------------
--  Wie mag wat
--
--  Het grootboek en de tags mag iedereen die kosten ziet ook lezen -- anders
--  staat er een code op een bon waar niemand de naam bij weet. Wijzigen is
--  administratie of management.
-- ---------------------------------------------------------------------------

alter table public.grootboek           enable row level security;
alter table public.kosten_tags         enable row level security;
alter table public.leverancier_boeking enable row level security;

do $$
declare t text;
begin
  /* leverancier_boeking staat hier niet bij: die tabel heeft geen id-kolom
     en wordt ook nooit rechtstreeks geschreven -- dat gaat via
     boeking_onthouden(). Lezen mag wel, en dat staat hieronder los. */
  foreach t in array array['grootboek', 'kosten_tags'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (public.is_staff())',
      t, t);

    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format(
      /* De sleutelkolom heet id, en dat moet ook: rij_bestaat kijkt hard
         naar "where id = $1". Hier stond per tabel een andere kolom (code,
         naam, leverancier), en dan zoekt hij een rij met id = '4031' terwijl
         die id gb_4031 heet. Die vlucht slaat dan altijd mis, en dan is dit
         weer een tabel die "new row violates row-level security" geeft zodra
         de app een bestaande rij bijwerkt met een upsert. */
      'create policy %I_insert on public.%I for insert to authenticated '
      'with check (public.rij_bestaat(''public.%I''::regclass, id) '
      '            or public.is_management() or public.heeft_recht(''admin.desk''))',
      t, t, t);

    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format(
      'create policy %I_update on public.%I for update to authenticated '
      'using (public.is_management() or public.heeft_recht(''admin.desk'')) '
      'with check (public.is_management() or public.heeft_recht(''admin.desk''))',
      t, t);
  end loop;
end $$;

revoke execute on function public.factuur_indelen(text, text) from public, anon, authenticated;
grant  execute on function public.factuur_indelen(text, text) to service_role, authenticated;
revoke execute on function public.boeking_onthouden(text, text, text[]) from public, anon;
grant  execute on function public.boeking_onthouden(text, text, text[]) to service_role, authenticated;

-- ---------------------------------------------------------------------------
--  Een begin
--
--  De rekeningen en tags die in de huidige administratie voorkomen. Bedoeld om
--  meteen iets te hebben; aanvullen gaat in de app.
-- ---------------------------------------------------------------------------

insert into public.grootboek (id, code, naam, trefwoorden, btw_pct)
select 'gb_' || v.code, v.code, v.naam, v.trefwoorden, v.btw_pct
from (values
  ('4000', 'Inkoop wasmiddelen en chemie',
   array['wasmiddel','chemie','shampoo','ontvetter','zeep','wairtec','cemex'], 21),
  ('4010', 'Energie',
   array['enexis','eneco','vattenfall','essent','elektra','stroom','gas','energie'], 21),
  ('4015', 'Water en osmose',
   array['water','osmose','vitens','brabant water','evides'], 9),
  ('4020', 'Afval en milieu',
   array['afval','prezero','renewi','container','milieu','suez'], 21),
  ('4025', 'Onderhoud en reparatie',
   array['onderhoud','reparatie','installatie','monteur','service','storing'], 21),
  ('4031', 'Contributies en heffingen',
   array['contributie','lidmaatschap','heffing','mkb','kamer van koophandel','kvk'], 0),
  ('4040', 'Huur en huisvesting',
   array['huur','pacht','huisvesting','erfpacht'], 21),
  ('4050', 'Verzekeringen',
   array['verzekering','polis','assurantie','premie'], 0),
  ('4060', 'Kantoor en administratie',
   array['kantoor','administratie','accountant','boekhoud','tork','papier'], 21),
  ('4070', 'Telefoon en internet',
   array['telefoon','internet','kpn','vodafone','ziggo','t-mobile','odido'], 21),
  ('4080', 'Vervoer en brandstof',
   array['brandstof','diesel','tankpas','shell','bp','total','leasing','lease'], 21),
  ('4090', 'Overige bedrijfskosten', array[]::text[], 21)
) as v(code, naam, trefwoorden, btw_pct)
on conflict (code) do nothing;

insert into public.kosten_tags (id, naam, trefwoorden)
select 'tag_' || v.naam, v.naam, v.trefwoorden
from (values
  ('afval',    array['afval','container','prezero','renewi','suez']),
  ('cemex',    array['cemex']),
  ('elektra',  array['elektra','stroom','enexis','eneco','vattenfall','essent']),
  ('enexis',   array['enexis']),
  ('finance',  array['bank','rente','financiering','lease','verzekering']),
  ('gas',      array['gas','aardgas']),
  ('osmose',   array['osmose','waterontharding','omgekeerde osmose']),
  ('prezero',  array['prezero']),
  ('tork',     array['tork']),
  ('wairtec',  array['wairtec'])
) as v(naam, trefwoorden)
on conflict (naam) do nothing;

-- ---------------------------------------------------------------------------
--  Waar facturen binnenkomen
--
--  Per vestiging een eigen adres: inkoop.<vestiging>@<domein>. Dan hoeft
--  niemand achteraf uit te zoeken bij welke vestiging een bon hoort -- dat
--  staat al in het adres waar hij op binnenkwam.
--
--  Het domein is een instelling en geen vaste waarde in de code. Nu is dat het
--  huidige adres; gaat er later een eigen domein komen, dan is dat één regel
--  wijzigen in plaats van een nieuwe versie uitbrengen.
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_inkoop_domein', 'inkoop_domein', 'preview.truckwash.cloud',
   'Het domein waarop facturen binnenkomen. Het adres per vestiging wordt '
   'inkoop.<vestiging>@<domein>, bijvoorbeeld inkoop.venlo@preview.truckwash.cloud. '
   'Let op: een nieuw domein moet eerst bij Resend zijn ingesteld voordat er '
   'post op binnenkomt.'),
  ('in_inkoop_voorvoegsel', 'inkoop_voorvoegsel', 'inkoop',
   'Het deel vóór de punt in het factuuradres. Standaard "inkoop", dus '
   'inkoop.venlo@... Wijzig dit alleen als de mailroutering meeverandert.'),
  ('in_factuur_automatisch', 'factuur_automatisch', 'ja',
   'Of een binnengekomen factuur meteen wordt uitgelezen en ingedeeld. Op '
   '"nee" blijft hij staan tot iemand in de app op voorlezen drukt.')
on conflict (id) do nothing;
