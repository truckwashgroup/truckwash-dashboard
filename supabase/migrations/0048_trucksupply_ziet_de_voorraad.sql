-- ===========================================================================
--  Trucksupply ziet de voorraad
--
--  Draai dit ná 0047. Opnieuw draaien mag.
--
--  Waar het om gaat
--  ----------------
--
--  De vestigingen bestellen hun spullen -- shampoo, ontvetter, doeken -- bij
--  één leverancier, Trucksupply. Tot nu toe ging dat zo: iemand op de
--  vestiging ziet dat de ontvetter op is, belt of appt, en hoopt dat het
--  aankomt voordat de laatste fles leeg is. Niemand aan de leverancierskant
--  ziet de standen, dus die kan niets zien aankomen.
--
--  Vanaf nu kijkt Trucksupply mee. Een eigen rol, die op alle vestigingen de
--  voorraad ziet maar verder geen personeel is: geen rooster, geen uren, geen
--  dossiers. Zakt een stand onder het minimum, dan ontstaat er een alarm dat
--  bij de leverancier binnenkomt -- meteen, en 's ochtends nog eens als
--  niemand ernaar keek. Van een alarm wordt een bestelling gemaakt, met een
--  nummer, een pakbon en een verzendstatus.
--
--  Wat hier in de database komt: de rol, de kolommen die een artikel voor de
--  leverancier bruikbaar maken (artikelnummer, foto, inkoopprijs), de
--  alarmen, de bestellingen met hun regels, en een eerste plek voor de
--  koppeling met Exact. De mails en de wekker staan in een Edge Function
--  (supabase/functions/trucksupply) en een GitHub-workflow
--  (.github/workflows/voorraad.yml).
--
--  Twee reparaties die onderweg meekomen
--  -------------------------------------
--
--  a. is_staff() is in 0029 ingekort. Die migratie voegde de administratie
--     toe en schreef de functie opnieuw uit als employee / administratie /
--     management -- en liet daarmee supervisor, technician en developer
--     vallen, die 0006 er eerder in had gezet. Sindsdien ziet een
--     leidinggevende met alléén de rol supervisor het rooster niet meer, en
--     de monteur de storingen niet. Het viel niet op omdat vrijwel iedereen
--     de rol employee ernaast heeft. Hier staan ze alle zes; trucksupply
--     bewust NIET, dat is geen personeel.
--
--  b. notifications.to_role kent een vaste lijst rollen (0007). Een
--     bestelaanvraag van een vestiging is een bericht aan "wie de inkoop
--     doet", en dat is een rol, geen persoon: wie er vandaag bij Trucksupply
--     achter het scherm zit weet de vestiging niet, en hoort dat ook niet te
--     hoeven weten. Dus komt trucksupply in de lijst. to_user_id blijft
--     bestaan voor het geval iemand tóch één persoon wil aanspreken.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De rol
--
--  Twee functies. is_trucksupply() zegt wie je bent; mag_leverancier() zegt
--  wat je mag, en daar valt ook het management onder en iedereen met het
--  losse recht supply.orders -- zodat een medewerker van kantoor kan
--  invallen zonder dat je hem van rol hoeft te laten wisselen.
-- ---------------------------------------------------------------------------

create or replace function public.is_trucksupply()
returns boolean language sql stable as $$
  select 'trucksupply' = any(public.my_roles());
$$;

create or replace function public.mag_leverancier()
returns boolean language sql stable as $$
  select public.is_trucksupply()
      or public.is_management()
      or public.heeft_recht('supply.orders');
$$;

/* Geen security definer, maar wel dezelfde hygiëne als in 0034: anon krijgt
   elke nieuwe functie standaard, en er is geen enkele reden waarom een
   bezoeker zonder inlog zou mogen vragen of hij Trucksupply is. */
revoke execute on function public.is_trucksupply()   from public, anon;
revoke execute on function public.mag_leverancier()  from public, anon;
grant  execute on function public.is_trucksupply()   to authenticated, service_role;
grant  execute on function public.mag_leverancier()  to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  Reparatie a: is_staff() is weer compleet
--
--  Woordelijk de lijst van 0006, plus de administratie uit 0029. Volgorde en
--  vorm als toen, zodat een volgende die hier iets aan toevoegt ziet dat het
--  een lijst is en niet drie losse gevallen.
-- ---------------------------------------------------------------------------

create or replace function public.is_staff()
returns boolean language sql stable as $$
  select 'employee'      = any(public.my_roles())
      or 'supervisor'    = any(public.my_roles())
      or 'technician'    = any(public.my_roles())
      or 'administratie' = any(public.my_roles())
      or 'management'    = any(public.my_roles())
      or 'developer'     = any(public.my_roles());
$$;

-- ---------------------------------------------------------------------------
--  Reparatie b: een melding mag aan de leverancier gericht zijn
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint if exists notifications_to_role_allowed;
alter table public.notifications
  add constraint notifications_to_role_allowed
  check (to_role is null or to_role in
    ('employee','supervisor','technician','customer','management','developer',
     'trucksupply'));

-- ---------------------------------------------------------------------------
--  Wat een artikel voor de leverancier nodig heeft
--
--  De voorraadtabel is gemaakt voor de vestiging: naam, stand, minimum. De
--  leverancier heeft meer nodig om er een bestelling van te maken. Alles met
--  add column if not exists, want de tabel staat vol.
-- ---------------------------------------------------------------------------

alter table public.inventory_items add column if not exists sku               text;
alter table public.inventory_items add column if not exists omschrijving      text;
alter table public.inventory_items add column if not exists image             text;
/* Wat er standaard per keer wordt meegestuurd. Een alarm op ontvetter
   betekent niet "stuur één liter" maar "stuur wat er altijd gaat". */
alter table public.inventory_items add column if not exists bestelhoeveelheid numeric not null default 0;
/* Wat Trucksupply ervoor rekent. price_per_unit blijft de interne waarde
   waarmee de vestiging zijn verbruik waardeert; die twee lopen uiteen. */
alter table public.inventory_items add column if not exists inkoopprijs       numeric;
alter table public.inventory_items add column if not exists actief            boolean not null default true;
/* De artikelcode in Exact. Nog nergens voor gebruikt; staat er zodat de
   koppeling straks geen tweede kolomronde nodig heeft. */
alter table public.inventory_items add column if not exists exact_code        text;

/*
 * Dezelfde rem als op pos_products.image (0027), om dezelfde reden: de foto
 * komt mee in elke synchronisatie van elk apparaat. NOT VALID, zodat een
 * bestaande database er niet op struikelt.
 */
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'inventory_items_image_maat'
       and conrelid = 'public.inventory_items'::regclass
  ) then
    alter table public.inventory_items
      add constraint inventory_items_image_maat
      check (image is null or length(image) <= 150000) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
--  De alarmen
--
--  Eén rij per keer dat een artikel onder zijn minimum zakt, en die rij
--  blijft bestaan tot de stand weer goed is. Het is dus geen momentopname
--  maar een geschiedenis: wanneer het begon, wie ernaar keek, wanneer er
--  over gemaild is en wanneer het over was. Dat laatste is wat je later wilt
--  weten -- "hoe lang zat Venlo zonder ontvetter" is een vraag die alleen te
--  beantwoorden is als je het hebt opgeschreven.
--
--  item_naam en stand staan er dubbel in, met opzet: een alarm van drie weken
--  terug moet nog leesbaar zijn als het artikel inmiddels is hernoemd of weg.
-- ---------------------------------------------------------------------------

create table if not exists public.voorraad_alarmen (
  id                text primary key,
  item_id           text references public.inventory_items(id) on delete cascade,
  item_naam         text not null default '',
  location_id       text,
  stand             numeric not null default 0,
  minimum           numeric not null default 0,
  ontstaan_at       bigint not null default public.now_ms(),
  gezien_at         bigint,
  gezien_door       text,
  gezien_door_naam  text,
  /* De directe mail, binnen een kwartier na het ontstaan. */
  gemaild_at        bigint,
  /* De ochtendmail, voor alles wat niemand gezien heeft. */
  ochtend_gemaild_at bigint,
  opgelost_at       bigint,
  updated_at        bigint not null default public.now_ms()
);

create index if not exists voorraad_alarmen_open_idx
  on public.voorraad_alarmen (item_id) where opgelost_at is null;
create index if not exists voorraad_alarmen_updated_idx
  on public.voorraad_alarmen (updated_at);

comment on table public.voorraad_alarmen is
  'Eén rij per keer dat een artikel onder zijn minimum zakte. Wordt door een '
  'trigger op inventory_items gemaakt en gesloten; de app zet alleen gezien_at.';

/*
 * De wacht op de voorraad.
 *
 * Bij elke wijziging van stand of minimum: onder het minimum en nog geen open
 * alarm, dan komt er een. Weer op of boven het minimum, dan gaat het open
 * alarm dicht. Precies één open alarm per artikel -- een tweede afboeking
 * terwijl het al onder het minimum staat is geen nieuw feit.
 *
 * Security definer, want wie een liter afboekt heeft daarmee geen
 * schrijfrecht op de alarmen, en dat hoort ook niet: de alarmen zijn van de
 * server. Bewust "stock < min_stock" en niet "<=": op het minimum staan is
 * de grens halen, niet eronder zitten. Een minimum van 0 geeft dus nooit een
 * alarm, en dat is de manier om een artikel buiten de bewaking te houden.
 */
create or replace function public.voorraad_alarm_bewaken()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  open_id text;
begin
  select id into open_id
    from public.voorraad_alarmen
   where item_id = new.id and opgelost_at is null
   limit 1;

  if new.stock < new.min_stock then
    if open_id is null then
      insert into public.voorraad_alarmen
        (id, item_id, item_naam, location_id, stand, minimum, ontstaan_at, updated_at)
      values
        ('va_' || replace(gen_random_uuid()::text, '-', ''),
         new.id, new.name, new.location_id, new.stock, new.min_stock,
         public.now_ms(), public.now_ms());
    else
      -- Het alarm staat er al; alleen de stand bijhouden, zodat de mail het
      -- laatste getal noemt en niet het getal van het moment van ontstaan.
      update public.voorraad_alarmen
         set stand = new.stock, minimum = new.min_stock, updated_at = public.now_ms()
       where id = open_id;
    end if;
  elsif open_id is not null then
    update public.voorraad_alarmen
       set opgelost_at = public.now_ms(), stand = new.stock, updated_at = public.now_ms()
     where id = open_id;
  end if;

  return new;
end;
$$;

drop trigger if exists inventory_items_alarm on public.inventory_items;
create trigger inventory_items_alarm
  after insert or update of stock, min_stock on public.inventory_items
  for each row execute function public.voorraad_alarm_bewaken();

/*
 * Wat er nú al onder het minimum staat.
 *
 * De trigger kijkt alleen bij een wijziging. Een artikel dat al weken onder
 * zijn minimum staat en waar niemand meer aan komt, zou dus nooit een alarm
 * krijgen -- terwijl dat precies het artikel is waar het om gaat. Eén keer
 * aanraken is genoeg: "update of stock" gaat af zodra de kolom in de SET
 * staat, ook als de waarde gelijk blijft. Bij opnieuw draaien gebeurt er
 * niets: de trigger maakt geen tweede open alarm.
 */
update public.inventory_items set stock = stock
 where stock < min_stock
   and not exists (select 1 from public.voorraad_alarmen a
                    where a.item_id = inventory_items.id and a.opgelost_at is null);

-- ---------------------------------------------------------------------------
--  De bestellingen
--
--  Een bestelling is van de leverancier: die maakt hem, pakt hem in en
--  verstuurt hem. De vestiging kan er een aanvragen (bron 'aanvraag'); de
--  status is niet van haar -- ook 'ontvangen' zet de leverancier of het
--  management, want bestellingen_update laat alleen die twee door. Wil de
--  vestiging zelf aftekenen, dan is dat een aparte policy in een latere
--  migratie, niet iets wat de app stilletjes probeert.
--
--  Het nummer (TS-2026-0001) komt uit bestelnummer(), niet uit de app. Twee
--  apparaten die tegelijk een bestelling maken krijgen anders hetzelfde
--  nummer, en een pakbon met een dubbel nummer is precies het soort fout
--  waar je een maand later een uur naar zoekt.
-- ---------------------------------------------------------------------------

create table if not exists public.bestellingen (
  id                   text primary key,
  nummer               text unique,
  location_id          text references public.locations(id) on delete set null,
  status               text not null default 'concept'
                       check (status in ('concept','bevestigd','ingepakt','verzonden','ontvangen','geannuleerd')),
  /* Waar hij vandaan komt: uit een alarm (voorraad), door de leverancier
     zelf (handmatig) of aangevraagd door de vestiging (aanvraag). */
  bron                 text not null default 'handmatig'
                       check (bron in ('voorraad','handmatig','aanvraag')),
  aangemaakt_door      text,
  aangemaakt_door_naam text,
  aangemaakt_at        bigint not null default public.now_ms(),
  bevestigd_at         bigint,
  verzonden_at         bigint,
  ontvangen_at         bigint,
  vervoerder           text,
  track_trace          text,
  opmerking            text,
  /* Als de pakbon per mail naar een ander is gegaan -- een magazijn, een
     vervoerder. Naar wie en wanneer, zodat "is hij al doorgestuurd" geen
     vraag is die je in je mailbox moet beantwoorden. */
  doorgestuurd_naar    text,
  doorgestuurd_at      bigint,
  updated_at           bigint not null default public.now_ms()
);

create index if not exists bestellingen_location_idx on public.bestellingen (location_id);
create index if not exists bestellingen_status_idx   on public.bestellingen (status);
create index if not exists bestellingen_updated_idx  on public.bestellingen (updated_at);

create table if not exists public.bestelregels (
  id             text primary key,
  bestelling_id  text not null references public.bestellingen(id) on delete cascade,
  item_id        text references public.inventory_items(id) on delete set null,
  /* Nogmaals de naam, om dezelfde reden als bij de alarmen: een pakbon van
     vorig jaar moet nog kloppen als het artikel weg is. */
  item_naam      text not null default '',
  aantal         numeric not null default 0,
  eenheid        text not null default 'stuk',
  prijs          numeric,
  /* Wat er werkelijk meegaat. Leeg tot de leverancier bij het inpakken
     invult wat er echt in de doos zit; bij verzenden wordt dít bijgeboekt,
     en anders het bestelde aantal. */
  geleverd       numeric,
  updated_at     bigint not null default public.now_ms()
);

create index if not exists bestelregels_bestelling_idx on public.bestelregels (bestelling_id);
create index if not exists bestelregels_updated_idx    on public.bestelregels (updated_at);

/*
 * Het bestelnummer.
 *
 * Een sequence voor het volgnummer; het jaar ervoor. Bij het eerste nummer
 * van een nieuw jaar begint de teller opnieuw -- dat is wat mensen van zo'n
 * nummer verwachten, en het maakt "hoeveel bestellingen dit jaar" een blik op
 * het laatste nummer.
 *
 * Het jaar zit in de sequence zelf: de waarde is jaar * 10000 + volgnummer.
 * Zo weet de sequence uit zichzelf of hij nog in het goede jaar zit, zonder
 * een aparte teller en zonder in de tabel te kijken. Dat laatste was de
 * eerste versie, en die zat fout: zolang er nog geen bestelling van dit jaar
 * ís opgeslagen begon hij bij élke aanroep opnieuw, en gaf dus twee keer
 * 0001 aan wie twee nummers vroeg voordat hij de eerste had bewaard.
 *
 * Twee bestellingen op precies hetzelfde moment op 1 januari kunnen nog
 * steeds botsen: allebei zien ze een oud jaar, allebei zetten ze de teller
 * terug. De unieke sleutel op nummer vangt dat, en de tweede probeert het
 * opnieuw. Hoogstens één keer per jaar, en dan nog alleen op die seconde.
 *
 * Security definer, zodat de aanroeper geen recht op de sequence zelf nodig
 * heeft; en dus met de gebruikelijke revoke, zie 0034.
 */
create sequence if not exists public.bestelnummer_seq;

create or replace function public.bestelnummer()
returns text language plpgsql security definer set search_path = public as $$
declare
  jaar   integer := extract(year from now() at time zone 'Europe/Amsterdam')::integer;
  ondergrens bigint := jaar::bigint * 10000;
  laatste bigint;
  waarde bigint;
begin
  select last_value into laatste from public.bestelnummer_seq;
  if laatste < ondergrens then
    perform setval('public.bestelnummer_seq', ondergrens + 1, false);
  end if;
  waarde := nextval('public.bestelnummer_seq');
  return 'TS-' || jaar::text || '-' || lpad((waarde - ondergrens)::text, 4, '0');
end;
$$;

revoke execute on function public.bestelnummer() from public, anon, authenticated;
grant  execute on function public.bestelnummer() to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  De koppeling met Exact
--
--  Eén rij, met de tokens erin. Daarom RLS aan en géén enkele policy: niets
--  wat via de app binnenkomt mag hier bij, ook het management niet. De
--  Edge Function exact werkt met de servicesleutel en is de enige die leest
--  en schrijft. Een toegangstoken in een tabel die de app kan synchroniseren
--  is een toegangstoken op elke tablet.
-- ---------------------------------------------------------------------------

create table if not exists public.exact_koppeling (
  id                 text primary key default 'exact',
  division           text,
  access_token       text,
  refresh_token      text,
  token_verloopt_at  bigint,
  status             text not null default 'los',
  verbonden_door     text,
  verbonden_at       bigint,
  laatste_fout       text,
  /* De state van een lopende koppelpoging: uitgegeven bij verbind-url,
     gecontroleerd bij de terugkeer van Exact. Een eigen kolom en niet
     laatste_fout, want een fout en een lopende poging zijn twee dingen. */
  state              text,
  /* Wanneer die state is uitgegeven. Een poging die niet binnen een kwartier
     terugkomt vervalt vanzelf; anders blijft een verlaten koppelpoging voor
     altijd een geldige deur. */
  state_at           bigint,
  updated_at         bigint not null default public.now_ms()
);

alter table public.exact_koppeling add column if not exists state text;
alter table public.exact_koppeling add column if not exists state_at bigint;
alter table public.exact_koppeling enable row level security;

comment on table public.exact_koppeling is
  'De OAuth-tokens van Exact Online. RLS aan zonder policies: alleen de '
  'servicesleutel (Edge Function exact) komt erbij. Nooit een policy op zetten.';

-- ---------------------------------------------------------------------------
--  Instellingen
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_trucksupply_mail', 'trucksupply_mail', 'casper@truckwash1group.nl',
   'Het adres waar voorraadalarmen en de ochtendmail naartoe gaan. Meerdere '
   'mag, met een komma ertussen.'),
  ('in_trucksupply_ochtend_uur', 'trucksupply_ochtend_uur', '8',
   'Het uur (Nederlandse tijd) waarop de ochtendmail met alle nog niet '
   'geziene alarmen wordt verstuurd. De wekker (.github/workflows/voorraad.yml) '
   'loopt elk heel uur van 4 tot en met 9 UTC; de functie kijkt zelf of het '
   'lokaal dit uur is. Daardoor werkt 6 tot en met 10; een ander uur komt de '
   'wekker nooit langs en dan gaat er geen ochtendmail.'),
  ('in_exact_division', 'exact_division', '',
   'De administratie (division) in Exact Online. Leeg betekent: de standaard '
   'van het gekoppelde account.')
on conflict (id) do nothing;

/* De tabel instellingen was van het management (0042: lezen ook met
   admin.desk). Deze drie sleutels zijn van de leverancier: het is zíjn
   mailadres en zíjn ochtendmail. Zonder deze verruiming las het scherm
   Instellingen van Trucksupply een lege tabel en toonde het de terugval, en
   een Opslaan bleef in de wachtrij hangen op een RLS-fout terwijl de app
   "opgeslagen" zei. Alleen deze drie: het inkoopdomein en het adres van
   Trucky blijven van het management. */

create or replace function public.is_trucksupply_instelling(sleutel text)
returns boolean
language sql
stable
as $$
  select sleutel in ('trucksupply_mail', 'trucksupply_ochtend_uur', 'exact_division')
$$;

revoke execute on function public.is_trucksupply_instelling(text) from public, anon;
grant  execute on function public.is_trucksupply_instelling(text) to authenticated, service_role;

drop policy if exists instellingen_select on public.instellingen;
create policy instellingen_select on public.instellingen for select to authenticated
  using (
    public.is_management() or public.heeft_recht('admin.desk')
    or ((public.is_trucksupply() or public.heeft_recht('supply.settings'))
        and public.is_trucksupply_instelling(sleutel))
  );

drop policy if exists instellingen_insert on public.instellingen;
create policy instellingen_insert on public.instellingen for insert to authenticated
  with check (
    public.rij_bestaat('public.instellingen'::regclass, id)
    or public.is_management()
    or ((public.is_trucksupply() or public.heeft_recht('supply.settings'))
        and public.is_trucksupply_instelling(sleutel))
  );

drop policy if exists instellingen_update on public.instellingen;
create policy instellingen_update on public.instellingen for update to authenticated
  using (
    public.is_management()
    or ((public.is_trucksupply() or public.heeft_recht('supply.settings'))
        and public.is_trucksupply_instelling(sleutel))
  )
  with check (
    public.is_management()
    or ((public.is_trucksupply() or public.heeft_recht('supply.settings'))
        and public.is_trucksupply_instelling(sleutel))
  );

-- ---------------------------------------------------------------------------
--  Tijdstempels en verwijderingen
--
--  Zelfde twee triggers als op elke gesynchroniseerde tabel: de server zet
--  updated_at (0001), en een verwijdering meldt zichzelf (0038). Zonder de
--  tweede houdt elk apparaat een verwijderde conceptbestelling als spook.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['voorraad_alarmen', 'bestellingen', 'bestelregels', 'exact_koppeling'] loop
    execute format('drop trigger if exists stamp_%1$s on public.%1$I', t);
    execute format(
      'create trigger stamp_%1$s before insert or update on public.%1$I
       for each row execute function public.stamp_updated_at()', t);
  end loop;

  foreach t in array array['voorraad_alarmen', 'bestellingen', 'bestelregels'] loop
    execute format('drop trigger if exists %1$s_verwijderd on public.%1$I', t);
    execute format(
      'create trigger %1$s_verwijderd after delete on public.%1$I
       for each row execute function public.meld_verwijdering()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
--  Wie mag wat
--
--  De leverancier ziet de voorraad van álle vestigingen; dat is het hele
--  punt. De regel van 0004 blijft woordelijk staan, met de leverancier als
--  extra tak -- zodat een medewerker nog steeds alleen zijn eigen vestiging
--  ziet.
-- ---------------------------------------------------------------------------

drop policy if exists inventory_select on public.inventory_items;
create policy inventory_select on public.inventory_items for select to authenticated
  using (
    (public.is_staff() and public.in_my_locations(location_id))
    or public.is_trucksupply()
  );

drop policy if exists inventory_write on public.inventory_items;
create policy inventory_write on public.inventory_items for all to authenticated
  using (
    (public.is_staff() and public.in_my_locations(location_id))
    or public.is_trucksupply()
  )
  with check (
    (public.is_staff() and public.in_my_locations(location_id))
    or public.is_trucksupply()
  );

/* De mutaties mag hij lezen (wat is er verbruikt), niet schrijven: afboeken
   doet de vestiging. stock_insert blijft zoals 0040 hem achterliet. */
drop policy if exists stock_select on public.stock_movements;
create policy stock_select on public.stock_movements for select to authenticated
  using (public.is_staff() or public.is_trucksupply());

-- --- alarmen ---

alter table public.voorraad_alarmen enable row level security;

drop policy if exists voorraad_alarmen_select on public.voorraad_alarmen;
create policy voorraad_alarmen_select on public.voorraad_alarmen for select to authenticated
  using (
    public.mag_leverancier()
    or (public.is_staff() and public.in_my_locations(location_id))
  );

/* Alarmen ontstaan in de trigger, die als eigenaar draait en hier niet langs
   komt. Deze regel is er voor de upsert-val (0040): de app zet gezien_at met
   een upsert, en die wordt óók tegen de insert-regel gehouden. */
drop policy if exists voorraad_alarmen_insert on public.voorraad_alarmen;
create policy voorraad_alarmen_insert on public.voorraad_alarmen for insert to authenticated
  with check (
    public.rij_bestaat('public.voorraad_alarmen'::regclass, id)
    or public.mag_leverancier()
  );

drop policy if exists voorraad_alarmen_update on public.voorraad_alarmen;
create policy voorraad_alarmen_update on public.voorraad_alarmen for update to authenticated
  using (public.mag_leverancier() or public.is_management())
  with check (public.mag_leverancier() or public.is_management());

-- --- bestellingen ---

alter table public.bestellingen enable row level security;
alter table public.bestelregels enable row level security;

drop policy if exists bestellingen_select on public.bestellingen;
create policy bestellingen_select on public.bestellingen for select to authenticated
  using (
    public.mag_leverancier()
    or (public.is_staff() and public.in_my_locations(location_id))
  );

/* Een vestiging mag alleen een aanvraag neerleggen, en alleen voor zichzelf.
   De rest van het maken is aan de leverancier. De 'is not null' staat er
   omdat in_my_locations(null) waar is (0004): zonder die regel kon elke
   medewerker een aanvraag voor niemand neerleggen, en die staat dan bij de
   leverancier zonder adres op de pakbon. */
drop policy if exists bestellingen_insert on public.bestellingen;
create policy bestellingen_insert on public.bestellingen for insert to authenticated
  with check (
    public.rij_bestaat('public.bestellingen'::regclass, id)
    or public.mag_leverancier()
    or (public.is_staff() and bron = 'aanvraag' and location_id is not null
        and public.in_my_locations(location_id))
  );

drop policy if exists bestellingen_update on public.bestellingen;
create policy bestellingen_update on public.bestellingen for update to authenticated
  using (public.mag_leverancier() or public.is_management())
  with check (public.mag_leverancier() or public.is_management());

/* Weg mag alleen wat nog nergens is: een concept. Een verzonden bestelling
   is een feit, en feiten annuleer je (status), je wist ze niet. */
drop policy if exists bestellingen_delete on public.bestellingen;
create policy bestellingen_delete on public.bestellingen for delete to authenticated
  using (public.mag_leverancier() and status = 'concept');

-- --- regels: alles loopt via de bestelling waar ze bij horen ---

drop policy if exists bestelregels_select on public.bestelregels;
create policy bestelregels_select on public.bestelregels for select to authenticated
  using (
    public.mag_leverancier()
    or exists (
      select 1 from public.bestellingen b
       where b.id = bestelling_id
         and public.is_staff() and public.in_my_locations(b.location_id))
  );

drop policy if exists bestelregels_insert on public.bestelregels;
create policy bestelregels_insert on public.bestelregels for insert to authenticated
  with check (
    public.rij_bestaat('public.bestelregels'::regclass, id)
    or public.mag_leverancier()
    or exists (
      select 1 from public.bestellingen b
       where b.id = bestelling_id
         and b.bron = 'aanvraag'
         and public.is_staff() and public.in_my_locations(b.location_id))
  );

drop policy if exists bestelregels_update on public.bestelregels;
create policy bestelregels_update on public.bestelregels for update to authenticated
  using (public.mag_leverancier() or public.is_management())
  with check (public.mag_leverancier() or public.is_management());

drop policy if exists bestelregels_delete on public.bestelregels;
create policy bestelregels_delete on public.bestelregels for delete to authenticated
  using (
    public.mag_leverancier()
    and exists (
      select 1 from public.bestellingen b
       where b.id = bestelling_id and b.status = 'concept')
  );

-- ---------------------------------------------------------------------------
--  Een artikel naar de kassa
--
--  De kassa verkoopt uit dezelfde voorraad, maar heeft zijn eigen
--  artikeltabel (pos_products, 0012). Die tabel is van de kassa: geen nieuwe
--  kolom, geen andere policy -- dat is een afspraak, zie 0040 en 0045.
--
--  Deze functie is daarom de enige deur. Ze maakt de kassarij aan als die er
--  nog niet is, en werkt hem anders bij; de koppeling is inventory_item_id,
--  die kolom bestond al. Wie mag: de leverancier, of wie de kassa toch al
--  beheert.
-- ---------------------------------------------------------------------------

create or replace function public.supply_artikel_naar_kassa(
  item_id    text,
  prijs_incl numeric,
  groep      text default null
)
returns text language plpgsql security definer set search_path = public as $$
declare
  artikel public.inventory_items%rowtype;
  product_id text;
begin
  if not (public.mag_leverancier() or public.mag_kassa_beheren()) then
    raise exception 'Alleen de leverancier of wie de kassa beheert zet een artikel op de kassa';
  end if;

  select * into artikel from public.inventory_items where id = item_id;
  if not found then
    raise exception 'Artikel % bestaat niet', item_id;
  end if;

  select id into product_id
    from public.pos_products
   where inventory_item_id = item_id
   order by updated_at desc
   limit 1;

  if product_id is null then
    product_id := 'pp_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.pos_products
      (id, location_id, code, name, group_name, unit, price_incl, kind,
       inventory_item_id, image, active, updated_at)
    values
      (product_id, artikel.location_id, coalesce(artikel.sku, ''), artikel.name,
       coalesce(nullif(trim(groep), ''), 'Overig'), artikel.unit,
       coalesce(prijs_incl, 0), 'artikel',
       artikel.id, artikel.image, artikel.actief, public.now_ms());
  else
    update public.pos_products
       set name        = artikel.name,
           unit        = artikel.unit,
           image       = artikel.image,
           location_id = artikel.location_id,
           code        = coalesce(artikel.sku, code),
           /* Geen prijs meegegeven: de kassaprijs blijft staan. */
           price_incl  = coalesce(prijs_incl, price_incl),
           group_name  = coalesce(nullif(trim(groep), ''), group_name),
           kind        = 'artikel',
           active      = artikel.actief,
           updated_at  = public.now_ms()
     where id = product_id;
  end if;

  return product_id;
end;
$$;

revoke execute on function public.supply_artikel_naar_kassa(text, numeric, text) from public, anon, authenticated;
grant  execute on function public.supply_artikel_naar_kassa(text, numeric, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  Wat de kassa van een artikel weet -- alleen lezen
--
--  De leverancier zet een artikel op de kassa via de deur hierboven, maar kon
--  daarna niet zien of het er stond en voor welke prijs: pos_products_select
--  (0012) is voor personeel, en Trucksupply is bewust geen personeel. Het
--  scherm verborg de kolom dan maar. Dat is eerlijk, maar niet handig: wie
--  de prijs zet hoort hem terug te kunnen lezen.
--
--  Dus een tweede deur, en die kan alleen kijken. Geen naam, geen barcode,
--  geen omzet -- alleen wat er nodig is om naast het artikel te tonen: welk
--  kassaproduct eraan hangt, de prijs en of het aanstaat. Wie de kassa mag
--  lezen krijgt niets nieuws; wie de kassa beheert of levert krijgt precies
--  dit. En de pos_*-tabellen blijven ongewijzigd: geen kolom, geen policy.
-- ---------------------------------------------------------------------------

create or replace function public.supply_kassa_prijzen()
returns table (inventory_item_id text, product_id text, price_incl numeric, active boolean)
language sql stable security definer set search_path = public as $$
  select p.inventory_item_id, p.id, p.price_incl, p.active
    from public.pos_products p
   where p.inventory_item_id is not null
     and (public.mag_leverancier() or public.mag_kassa_beheren() or public.is_staff())
   order by p.updated_at desc;
$$;

revoke execute on function public.supply_kassa_prijzen() from public, anon, authenticated;
grant  execute on function public.supply_kassa_prijzen() to authenticated, service_role;
