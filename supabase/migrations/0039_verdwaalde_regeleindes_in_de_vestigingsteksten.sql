-- ===========================================================================
--  Verdwaalde regeleindes in de vestigingsteksten
--
--  Bij het naderhand vergelijken van de site met de nulmeting bleken vier van
--  de vijfenveertig pagina's te verschillen. De inhoud was gelijk; het enige
--  verschil was een onzichtbaar teken:
--
--    ...naast de Q8.^M
--
--  Dat is een carriage return (chr(13)), het regeleindeteken van Windows. Hij
--  staat in de tekst zelf, niet aan het eind van de regel in het bestand.
--
--  Waar hij vandaan komt
--  ---------------------
--
--  De achttien vestigingen zijn met 0035 ingevoerd uit site.json. Die migratie
--  is op een Windows-machine geschreven, en git zet .sql-bestanden daar om naar
--  CRLF -- de waarschuwing "LF will be replaced by CRLF" kwam bij elke commit
--  langs. In een tekst die over meerdere regels is samengesteld belandt dat
--  teken binnen de waarde in plaats van erbuiten.
--
--  Gemeten: 1 intro en 2 bereikbaar-teksten, van de achttien.
--
--  Waarom het opruimen hoort
--  -------------------------
--
--  Het valt niemand op. Het is geen zichtbaar teken, de pagina ziet er goed
--  uit, en HTML vouwt witruimte toch samen. Maar zolang het er staat is elke
--  vergelijking tussen de site en de database vals: er verschijnen verschillen
--  die geen verschillen zijn, en dan leer je die vergelijking negeren -- en
--  precies dan glipt er een keer een echt verschil doorheen.
--
--  Ook de andere kant is nu afgedekt: bouw/omzet.cjs in het siteproject haalt
--  regeleindes eruit voordat er HTML van wordt gemaakt. Dit repareert wat er
--  staat, dat voorkomt dat het langs een andere weg terugkomt.
--
--  Opnieuw draaien mag; de tweede keer valt er niets meer op te ruimen.
-- ===========================================================================

update public.locations
   set intro      = nullif(replace(coalesce(intro, ''),      chr(13), ''), ''),
       bereikbaar = nullif(replace(coalesce(bereikbaar, ''), chr(13), ''), ''),
       bijzonder  = nullif(replace(coalesce(bijzonder, ''),  chr(13), ''), ''),
       punten     = (
         select coalesce(array_agg(replace(p, chr(13), '') order by nr), '{}')
           from unnest(punten) with ordinality as t(p, nr)
       ),
       updated_at = public.now_ms()
 where intro      like '%' || chr(13) || '%'
    or bereikbaar like '%' || chr(13) || '%'
    or bijzonder  like '%' || chr(13) || '%'
    or exists (select 1 from unnest(punten) p where p like '%' || chr(13) || '%');
