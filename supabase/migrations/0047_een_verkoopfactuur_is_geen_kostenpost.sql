-- ===========================================================================
--  Een verkoopfactuur is geen kostenpost
--
--  Draai dit ná 0046. Opnieuw draaien mag.
--
--  Wat er misging
--  --------------
--
--  Alles wat met een PDF op een inkoopadres binnenkwam werd een kostenpost.
--  Ook een factuur die Truckwash zélf aan een klant had gestuurd -- een klant
--  die hem terugmailt met een vraag, een collega die hem doorstuurt "voor de
--  administratie". Die stond dan aan de kostenkant, met het eigen btw-nummer
--  als leverancier, en niemand zag het verschil met een echte rekening.
--
--  De lezer kijkt nu wie er bovenaan het stuk staat. Is dat Truckwash, dan
--  haalt de post de zojuist aangemaakte kostenpost weer weg en zet op het
--  bericht dat het een verkoopfactuur is. Daarvoor is deze kolom.
--
--  Bewust geen verkoopadministratie. Alleen herkennen, apart zetten en
--  duidelijk laten zien; wat er verder mee moet is aan de administratie.
-- ===========================================================================

alter table public.mailbox add column if not exists soort text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mailbox_soort_check') then
    alter table public.mailbox
      add constraint mailbox_soort_check
      check (soort is null or soort in ('inkoop','verkoop','overig'));
  end if;
end $$;

comment on column public.mailbox.soort is
  'Wat de post ervan maakte: inkoop (er is een kostenpost van gemaakt), '
  'verkoop (een factuur van Truckwash zelf, geen kostenpost) of overig (geen '
  'bijlage om te lezen). Leeg zolang de lezer er nog niet naar keek of het '
  'niet zeker wist, en bij post van vóór deze migratie.';

-- Het scherm zet de verkoopfacturen bij elkaar; dat hoort niet de hele
-- postbus door te lopen.
create index if not exists mailbox_soort_idx on public.mailbox (soort) where soort is not null;

-- ---------------------------------------------------------------------------
--  De eigen nummers, voor het tweede slot
--
--  De post haalt een kostenpost pas weg als het stuk naast de lezing
--  "verkoop" van het model óók een nummer van Truckwash zelf draagt: KvK,
--  btw-nummer of IBAN. Het model alleen is niet genoeg -- een andere wasserij
--  met "Truckwash" in de naam of een scan met een stempel "ontvangen" leest
--  het soms als verkoop, en een weggehaalde kostenpost komt niet vanzelf
--  terug.
--
--  Bewust leeg aangemaakt. Zolang ze leeg zijn wordt er niets weggehaald en
--  blijft elke factuur een kostenpost, met de twijfel erop. Invullen in het
--  ontwikkelaarsscherm bij de inkoopadressen, of hier met een update.
--  Meerdere nummers mag, met een komma ertussen (één per werkmaatschappij).
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_eigen_kvk', 'eigen_kvk', '',
   'Het KvK-nummer van Truckwash 1 Group (meerdere mag, met een komma). De '
   'post gebruikt het om een doorgestuurde verkoopfactuur van Truckwash zelf '
   'te herkennen; leeg betekent dat er nooit een kostenpost wordt weggehaald.'),
  ('in_eigen_btw', 'eigen_btw', '',
   'Het btw-nummer van Truckwash 1 Group, bijvoorbeeld NL123456789B01 '
   '(meerdere mag, met een komma). Zelfde doel als het KvK-nummer.'),
  ('in_eigen_iban', 'eigen_iban', '',
   'De eigen bankrekening(en) van Truckwash, met een komma ertussen. Zelfde '
   'doel als het KvK-nummer: staat deze op een factuur als rekening om op te '
   'betalen, dan is het een factuur van Truckwash zelf.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
--  De verwijdering moet zichzelf melden
--
--  Dit is de eerste plek waar de server een kostenpost weghaalt achter de app
--  om. Een apparaat dat de bon net had opgehaald houdt hem anders in zijn
--  lokale kopie staan -- precies het spook uit 0032 en 0038, nu op expenses.
--  Dezelfde trigger als daar, zodat elk apparaat hem bij het volgende ophalen
--  opruimt.
-- ---------------------------------------------------------------------------

drop trigger if exists expenses_verwijderd on public.expenses;
create trigger expenses_verwijderd
  after delete on public.expenses
  for each row execute function public.meld_verwijdering();
