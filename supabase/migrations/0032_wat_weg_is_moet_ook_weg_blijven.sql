-- ===========================================================================
--  Wat weg is, moet ook wegblijven
--
--  Een gewiste medewerker bleef in elk apparaat staan. Niet als restje in de
--  database -- daar was hij echt weg -- maar in de kopie die elke app lokaal
--  bijhoudt. Gevolg: hij stond nog in de personeelslijst, en je kon hem niet
--  opnieuw aanmaken omdat de dubbelcontrole hem daar zag staan.
--
--  Waarom dat gebeurde
--  -------------------
--
--  De app haalt wijzigingen op met "geef me alles wat is veranderd sinds
--  <tijdstip>" en zet die er lokaal overheen. Dat werkt voor nieuwe en
--  gewijzigde rijen, en het kan per definitie niet werken voor verwijderde
--  rijen: een rij die er niet meer is, komt niet mee in een lijst van rijen
--  die er wel zijn. Er was dus geen enkele manier waarop een apparaat kon
--  wéten dat er iets was weggehaald.
--
--  Dit is geen fout in één functie maar een gat in de opzet. Het raakt elke
--  harde verwijdering, niet alleen die van een medewerker.
--
--  De oplossing
--  ------------
--
--  Er was al een deletion_log -- die bestond om te kunnen navertellen wie wat
--  wanneer heeft gewist. Alleen stond er niet in wélke rij het betrof, dus je
--  kon er niets mee opruimen. Met die twee velden erbij wordt hij tegelijk de
--  lijst waaraan de apps kunnen zien wat ze moeten weggooien.
--
--  Bewust geen "verwijderd"-vlaggetje op de rij zelf. Dan blijft een gewist
--  personeelsdossier met BSN en rekeningnummer gewoon staan, en dat is precies
--  wat wissen niet moet zijn.
-- ===========================================================================

alter table public.deletion_log add column if not exists tabel     text;
alter table public.deletion_log add column if not exists record_id text;

create index if not exists deletion_log_record_idx
  on public.deletion_log (tabel, record_id);

/*
 * De oude regels weten niet welke rij het was; die zijn geschreven voordat
 * deze kolommen bestonden. Voor medewerkers valt dat te herstellen: het
 * dossier-id is niet bewaard, maar de naam wel, en de app kan daar niets mee.
 *
 * Dus laten we ze leeg. Een lege waarde betekent "onbekend, sla over", en dat
 * is eerlijker dan iets verzinnen. De apparaten die nu een spook hebben staan
 * ruimen dat op bij de eerstvolgende volledige verversing.
 */

comment on column public.deletion_log.tabel is
  'Welke tabel de rij in stond, in de naamgeving van de app (users, expenses, ...). Leeg bij regels van vóór deze migratie.';
comment on column public.deletion_log.record_id is
  'Het id van de rij die is weggehaald, zodat elk apparaat weet wat het lokaal moet weggooien.';

-- ---------------------------------------------------------------------------
--  Wie mag dit lezen
--
--  Iedereen die is ingelogd. Er staat niets gevoeligs in -- een naam, een
--  personeelsnummer en een reden -- en elk apparaat moet kunnen ophalen wat er
--  is weggehaald. Zonder leesrecht blijft het spook staan, en dan lost deze
--  migratie niets op.
--
--  Schrijven blijft bij het management, zoals het al was.
-- ---------------------------------------------------------------------------

drop policy if exists deletion_log_select on public.deletion_log;
create policy deletion_log_select on public.deletion_log for select to authenticated
  using (true);
