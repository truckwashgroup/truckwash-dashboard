-- ===========================================================================
--  De foto's gaan mee naar de website
--
--  De vestigingspagina op de site toont een vaste stockfoto: dezelfde
--  wasstraat voor Aalsmeer, Venlo en Maasvlakte, met twee uitzonderingen die
--  met de hand in brok.js staan. Terwijl in het beheerscherm per vestiging
--  echte foto's zijn geupload, met een bijschrift en een omslag die vooraan
--  staat. Die kwamen niet verder dan de app.
--
--  Vanaf hier geeft website_vestigingen() ze mee, als een lijst per
--  vestiging. De omslag staat vooraan en daarna komt de volgorde zoals die
--  in het scherm is gesleept -- dat is dezelfde volgorde die de app zelf
--  toont, zodat wat je in het beheerscherm ziet ook is wat de site laat zien.
--
--  Wat er per foto meegaat
--  -----------------------
--
--    pad         het pad in de emmer "vestigingen" (die is openbaar leesbaar,
--                zie 0026); de serverfunctie maakt er de volledige url van
--    bijschrift  wat er in het scherm bij is getikt, of null
--    cover       staat deze vooraan
--    volgorde    het sorteergetal uit het scherm
--
--  En met opzet NIET: wie hem heeft geupload, wanneer, hoe groot het
--  bestand is, welk id de regel heeft. Dat is administratie van binnen en
--  hoort niet op een openbare pagina. scripts/sqltest.mjs bewaakt dat.
--
--  Waarom drop + create: de functie krijgt een kolom erbij, en bij een
--  "returns table" kan dat niet met "create or replace". Dezelfde reden als
--  in 0035, en met dezelfde valkuil: het droppen gooit de rechten weg, dus
--  die staan onderaan opnieuw.
-- ===========================================================================

drop function if exists public.website_vestigingen();

create function public.website_vestigingen()
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
  diensten    text[],
  punten      text[],
  fotos       jsonb
)
language sql stable security definer set search_path = public as $$
  select
    l.website_slug, l.name, l.address, l.postcode, l.city,
    l.phone, l.email, l.lat, l.lon, l.bays,
    l.opening_hours, l.intro, l.bereikbaar, l.bijzonder, l.diensten, l.punten,
    /*
     * Een lege lijst en geen null: het bouwscript van de site doet
     * fotos.map(...) en moet dat kunnen doen zonder eerst te kijken.
     *
     * De volgorde staat IN de aggregatie. Een "order by" op de buitenste
     * select zou de vestigingen sorteren en de foto's laten staan zoals
     * ze toevallig uit de tabel komen.
     */
    coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'pad',        f.storage_path,
                 'bijschrift', f.caption,
                 'cover',      f.is_cover,
                 'volgorde',   f.sort)
               order by f.is_cover desc, f.sort asc, f.uploaded_at asc)
        from public.location_photos f
       where f.location_id = l.id
    ), '[]'::jsonb)
  from public.locations l
  where l.op_website
    and l.active
    and l.website_slug is not null
  order by l.name;
$$;

/*
 * De rechten opnieuw zetten, precies zoals in 0033.
 *
 * "drop function" gooit ook de rechten weg, en de nieuwe functie krijgt van
 * Supabase weer automatisch anon en authenticated erbij via de standaardregel
 * in het schema. Intrekken bij PUBLIC alleen haalt die eigen rechten er niet
 * af -- daarom staan anon en authenticated er apart bij. Zonder deze regels
 * staat het gat dat in 0033 en 0034 is gedicht meteen weer open, en dan kan
 * een onbekende bezoeker de hele lijst zelf opvragen.
 */
revoke execute on function public.website_vestigingen() from public, anon, authenticated;
grant  execute on function public.website_vestigingen() to service_role;
