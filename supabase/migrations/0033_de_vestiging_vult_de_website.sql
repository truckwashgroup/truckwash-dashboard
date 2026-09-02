-- ===========================================================================
--  De vestiging vult de website
--
--  De vestigingen staan in de app: adres, telefoon, openingstijden, foto's,
--  het aantal wasstraten. Op de website staan dezelfde achttien vestigingen
--  nog een keer, met de hand geschreven, in gegenereerde HTML.
--
--  Dat is één keer bijhouden te veel. Verhuist een vestiging of gaat er een
--  uur af op zaterdag, dan klopt de ene plek en de andere niet -- en de plek
--  die niet klopt is precies de plek waar de chauffeur kijkt.
--
--  Hier komen de velden bij die een openbare pagina nodig heeft en die er nog
--  niet waren. De rest -- adres, openingstijden, foto's -- staat er al sinds
--  0026.
--
--  Wat hier NIET gebeurt
--  ---------------------
--
--  De dienstenlijst van de app (buitenwas, cabine binnen, combi,
--  tankreiniging, polijsten) blijft ongemoeid. Dat is wat de wasstraat boekt
--  en afrekent, en dat type wordt letterlijk naar de kassa-repo gekopieerd --
--  daar iets aan veranderen raakt negentien kassa's.
--
--  Wat je verkoopt is een andere lijst en langer: veertien, met truckparking,
--  catering, HACCP en de wasboxen erbij. Die krijgt een eigen veld.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Welke pagina op de website hoort hierbij
--
--  Expliciet, en niet op naam raden. De site heeft vaste paden (/locaties/
--  utrecht/), de app heeft namen die iemand kan wijzigen. Koppelen op naam
--  betekent dat één hernoeming een pagina breekt zonder dat iemand het ziet.
-- ---------------------------------------------------------------------------

alter table public.locations add column if not exists website_slug text;

-- Twee vestigingen op dezelfde pagina kan niet: dan is het maar net welke de
-- lijst als eerste ziet, en dat verschilt per keer.
create unique index if not exists locations_slug_idx
  on public.locations (website_slug) where website_slug is not null;

-- ---------------------------------------------------------------------------
--  De tekst op de pagina
--
--  Drie soorten, want ze horen op verschillende plekken en hebben een
--  verschillend publiek:
--
--    intro       de alinea bovenaan de pagina -- waarom je hier komt
--    bereikbaar  hoe je er komt: de afrit, de oprit, waar de ingang zit.
--                Dit is het stukje waar een chauffeur die er nog nooit is
--                geweest werkelijk iets aan heeft.
--    bijzonder   wat hier anders is dan elders. Mag leeg blijven.
--
--  Losse velden en geen groot tekstvak: dan staat op elke pagina hetzelfde
--  soort informatie op dezelfde plek, en hoeft niemand na te denken over
--  opmaak.
-- ---------------------------------------------------------------------------

alter table public.locations add column if not exists intro      text;
alter table public.locations add column if not exists bereikbaar text;
alter table public.locations add column if not exists bijzonder  text;

-- ---------------------------------------------------------------------------
--  Wat kan hier
--
--  De sleutels komen overeen met de mappen op de website, zodat de pagina
--  rechtstreeks kan doorlinken naar de dienst. Vandaar de streepjes.
-- ---------------------------------------------------------------------------

alter table public.locations add column if not exists diensten text[] not null default '{}';

comment on column public.locations.diensten is
  'Sleutels van de diensten op de website: alcoa-velgen-reinigen, bus-wasstraat, '
  'camper-wasstraat, catering-op-locatie, haal-en-brengservice, '
  'haccp-certificaat-en-behandeling, interieur-reinigen, nao-wasplaats, '
  'truck-shop, truckparking, vogelgriep, vrachtwagen-polijsten, wasboxen, '
  'wegrestaurant-a2. Los van SERVICES in de app -- dat is wat de kassa boekt.';

-- ---------------------------------------------------------------------------
--  Hoort deze vestiging op de website
--
--  Niet elke vestiging is een publiek adres. Het hoofdkantoor hoort er niet
--  op, en een locatie die net is aangekocht ook nog niet. Standaard uit, want
--  per ongeluk iets publiceren is erger dan per ongeluk iets weglaten.
-- ---------------------------------------------------------------------------

alter table public.locations add column if not exists op_website boolean not null default false;

-- ---------------------------------------------------------------------------
--  Wat er publiek te zien is
--
--  Een openbare bezoeker heeft geen inlog, dus die kan de tabel locations niet
--  lezen -- en dat hoort ook zo: daar staat de vestigingsmanager in, de
--  interne notitie en welke vestigingen uit staan.
--
--  Deze functie geeft precies de velden terug die op een openbare pagina
--  horen, en alleen van vestigingen die daarvoor zijn aangewezen. Zo staat op
--  één plek in de database wat er naar buiten mag, en niet verspreid over de
--  code die het opvraagt.
-- ---------------------------------------------------------------------------

create or replace function public.website_vestigingen()
returns table (
  slug        text,
  naam        text,
  adres       text,
  postcode    text,
  plaats      text,
  telefoon    text,
  email       text,
  lat         double precision,
  lon         double precision,
  wasstraten  integer,
  openingstijden jsonb,
  intro       text,
  bereikbaar  text,
  bijzonder   text,
  diensten    text[]
)
language sql stable security definer set search_path = public as $$
  select
    l.website_slug, l.name, l.address, l.postcode, l.city,
    l.phone, l.email, l.lat, l.lon, l.bays,
    l.opening_hours, l.intro, l.bereikbaar, l.bijzonder, l.diensten
  from public.locations l
  where l.op_website
    and l.active
    and l.website_slug is not null
  order by l.name;
$$;

/*
 * Hoeveel mensen er werken.
 *
 * Voor de vacaturepagina: "sluit je aan bij de andere zoveel". Eén getal, en
 * verder niets -- geen namen, geen verdeling over vestigingen. Dat laatste is
 * een landkaart van waar het bedrijf dun bezet is.
 *
 * Apparaten tellen niet mee. Een kassa is geen collega.
 */
create or replace function public.website_aantal_medewerkers()
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer
    from public.profiles
   where active
     and not coalesce(is_device, false)
     and archived_at is null
     and 'customer' <> all(coalesce(roles, array[]::text[]))
     and 'employer' <> all(coalesce(roles, array[]::text[]));
$$;

/*
 * Uitvoerrecht.
 *
 * Eerst intrekken, dan uitdelen -- en die volgorde is het hele punt.
 *
 * Postgres geeft het uitvoerrecht op een nieuwe functie uit zichzelf aan
 * PUBLIC, en daar vallen anon en authenticated onder. Alleen "grant to
 * service_role" laat die standaard dus gewoon staan: iedereen met de publieke
 * sleutel kan de functie aanroepen. En omdat het security definer-functies
 * zijn, stapt zo'n aanroep dwars door de beveiligingsregels op locations en
 * profiles heen. Dat is precies het omgekeerde van wat hierboven staat.
 *
 * Zonder de revoke faalt dat stil: er komt geen foutmelding, er komt een lijst.
 * Twee controles in scripts/sqltest.mjs houden dit vast.
 *
 * De website haalt dit op via een serverfunctie met de servicesleutel. Anon
 * uitvoerrecht geven kan later alsnog, maar dan als besluit en niet als
 * bijvangst van een standaardinstelling.
 */
revoke execute on function public.website_vestigingen() from public;
revoke execute on function public.website_aantal_medewerkers() from public;

grant execute on function public.website_vestigingen() to service_role;
grant execute on function public.website_aantal_medewerkers() to service_role;
