-- ===========================================================================
--  Wat drie keer hetzelfde was, hoeft de vierde keer niet opnieuw
--
--  De vraag van Casper: "Als hij 3x is goedgekeurd, en de volgende is
--  hetzelfde, maar met een andere datum en factuurnummer, dan mag je hem
--  automatisch goedkeuren."
--
--  Dat is een goede regel, en tegelijk de gevaarlijkste die in dit systeem
--  zit: hier gaat er geld weg zonder dat iemand keek. Daarom staat hij
--  standaard UIT, en zitten er vier sloten op.
--
--  Slot 1: alleen wat een MENS drie keer goedkeurde
--  -----------------------------------------------
--
--  De drie eerdere goedkeuringen moeten van een mens zijn. Zou een
--  automatische goedkeuring meetellen, dan bevestigt het systeem na verloop
--  van tijd zijn eigen vergissingen -- precies het gat dat bij het
--  grootboekgeheugen (0044) al is dichtgezet. Nu blijft het oordeel altijd
--  terug te voeren op drie mensen die ja zeiden.
--
--  Slot 2: hetzelfde bedrag, binnen een marge
--  ------------------------------------------
--
--  "Hetzelfde" is bij een maandfactuur nooit tot op de cent hetzelfde: een
--  afvalcontainer verschilt met de weegbon, elektra met het verbruik. Daarom
--  een marge (standaard 2%) ten opzichte van de MEDIAAN van de drie, niet van
--  de laatste. Eén uitschieter verschuift de mediaan niet, en dus ook niet wat
--  er voortaan vanzelf doorgaat.
--
--  Slot 3: een plafond
--  -------------------
--
--  Boven een bedrag (standaard 500 euro exclusief btw) gaat er nooit iets
--  vanzelf doorheen, hoe vertrouwd de leverancier ook is. Een leverancier die
--  elke maand 40 euro stuurt en ineens 4.000, is geen gewoonte maar een vraag.
--
--  Slot 4: geen twijfel, geen dubbele
--  ----------------------------------
--
--  Wat de lezer niet zeker wist gaat nooit vanzelf door, en een factuurnummer
--  dat al bij deze leverancier bestaat al helemaal niet -- dat is een
--  herinnering of een dubbele, en die betaal je niet twee keer.
--
--  Wat je terugziet
--  ----------------
--
--  Een automatisch goedgekeurde bon draagt goedkeuring_bron = 'automatisch',
--  de naam "Automatisch" bij de goedkeurder en een zin in goedkeuring_reden
--  die zegt waaróm. Het management krijgt er een melding van. Afkeuren kan
--  gewoon; dan wordt het weer mensenwerk.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Wat er op de kostenpost bijkomt
-- ---------------------------------------------------------------------------

alter table public.expenses add column if not exists goedkeuring_bron text;

do $$
begin
  alter table public.expenses drop constraint if exists expenses_goedkeuring_bron_check;
  alter table public.expenses add constraint expenses_goedkeuring_bron_check
    check (goedkeuring_bron is null or goedkeuring_bron in ('mens', 'automatisch'));
exception when others then
  raise notice 'goedkeuring_bron-controle niet gezet: %', sqlerrm;
end $$;

/* Waarom hij vanzelf doorging. Eén zin, voor op het scherm en voor later. */
alter table public.expenses add column if not exists goedkeuring_reden text;

comment on column public.expenses.goedkeuring_bron is
  'Wie deze kostenpost heeft goedgekeurd: "mens" of "automatisch" (0050). '
  'Leeg bij bonnen van voor die migratie en bij alles wat nog openstaat.';

-- ---------------------------------------------------------------------------
--  De instellingen
--
--  Standaard uit. Dit is de enige plek in het systeem waar geld wordt
--  goedgekeurd zonder dat er iemand kijkt; dat zet je zelf aan, bewust, als
--  je de eerste maanden hebt gezien dat de lezer klopt.
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_auto_goedkeuren', 'auto_goedkeuren', 'nee',
   'Mag een factuur zichzelf goedkeuren als dezelfde leverancier voor '
   'ongeveer hetzelfde bedrag al een aantal keer door een mens is '
   'goedgekeurd? "ja" of "nee". Standaard nee.'),
  ('in_auto_goedkeuren_vanaf', 'auto_goedkeuren_vanaf', '3',
   'Hoeveel keer een mens dezelfde leverancier voor ongeveer hetzelfde bedrag '
   'moet hebben goedgekeurd voordat de volgende vanzelf doorgaat. Minimaal 2.'),
  ('in_auto_goedkeuren_marge', 'auto_goedkeuren_marge', '2',
   'Hoeveel procent het bedrag mag afwijken van de mediaan van de eerdere '
   'goedkeuringen en toch "hetzelfde" heet. Standaard 2.'),
  ('in_auto_goedkeuren_max', 'auto_goedkeuren_max', '500',
   'Bedrag exclusief btw waarboven nooit iets vanzelf wordt goedgekeurd, hoe '
   'vertrouwd de leverancier ook is. Standaard 500 euro.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
--  Het oordeel
--
--  Eén functie die alles nakijkt en zegt wat hij vindt, met de reden erbij.
--  Beslissen doet hij niet: hij geeft antwoord, en de aanroeper (de post, via
--  _gedeeld/verwerking.ts) keurt goed of laat hem staan. Zo is dit oordeel los
--  te lezen, los te testen, en straks ook los aan te roepen vanuit een scherm
--  dat wil laten zien waarom iets wel of niet vanzelf doorging.
--
--  security definer omdat hij over alle vestigingen heen telt; wie hem mag
--  aanroepen staat onderaan.
-- ---------------------------------------------------------------------------

create or replace function public.mag_automatisch_goedkeuren(
  leverancier_in    text,
  bedrag_in         numeric,
  factuurnummer_in  text default null,
  expense_in        text default null
)
returns table (mag boolean, waarom text, keren integer, gewoonte numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  /*
   * De leverancier heet hier partij en niet sleutel.
   *
   * Dat is geen smaak: instellingen heeft een kolom die sleutel heet, en
   * PL/pgSQL kiest bij gelijke namen de variabele. Elke select op de
   * instellingen viel daardoor om met "column reference sleutel is
   * ambiguous" -- pas bij het draaien, niet bij het aanmaken.
   */
  partij    text := lower(trim(coalesce(leverancier_in, '')));
  aan       text;
  vanaf     integer;
  marge     numeric;
  plafond   numeric;
  bedragen  numeric[];
  midden    numeric;
  afwijking numeric;
  al_gezien integer;
begin
  keren := 0;
  gewoonte := null;

  select lower(trim(coalesce(i.waarde, 'nee'))) into aan
    from public.instellingen i where i.sleutel = 'auto_goedkeuren';
  if coalesce(aan, 'nee') <> 'ja' then
    mag := false; waarom := 'Automatisch goedkeuren staat uit.'; return next; return;
  end if;

  if partij = '' then
    mag := false; waarom := 'Geen leverancier op het stuk.'; return next; return;
  end if;
  if bedrag_in is null or bedrag_in <= 0 then
    mag := false; waarom := 'Geen bedrag gelezen.'; return next; return;
  end if;

  /* De instellingen, met een bodem eronder: een "vanaf 1" zou betekenen dat
     één goedkeuring genoeg is, en dat is geen gewoonte maar een toevalstreffer. */
  select greatest(2, coalesce(nullif(trim(i.waarde), '')::integer, 3)) into vanaf
    from public.instellingen i where i.sleutel = 'auto_goedkeuren_vanaf';
  vanaf := coalesce(vanaf, 3);

  select greatest(0, least(25, coalesce(nullif(trim(i.waarde), '')::numeric, 2))) into marge
    from public.instellingen i where i.sleutel = 'auto_goedkeuren_marge';
  marge := coalesce(marge, 2);

  select coalesce(nullif(trim(i.waarde), '')::numeric, 500) into plafond
    from public.instellingen i where i.sleutel = 'auto_goedkeuren_max';
  plafond := coalesce(plafond, 500);

  if bedrag_in > plafond then
    mag := false;
    waarom := format('Boven het plafond van %s euro; hier kijkt altijd iemand naar.',
                     trim(to_char(plafond, 'FM999999990.99')));
    return next; return;
  end if;

  /*
   * Een factuurnummer dat al bij deze leverancier staat is een herinnering of
   * een dubbele. Nooit vanzelf. De eigen rij telt niet mee -- die staat er op
   * dit moment al.
   */
  if coalesce(trim(factuurnummer_in), '') <> '' then
    select count(*)::integer into al_gezien
      from public.expenses e
     where lower(trim(coalesce(e.supplier, ''))) = partij
       and trim(coalesce(e.factuurnummer, '')) = trim(factuurnummer_in)
       and (expense_in is null or e.id <> expense_in);
    if coalesce(al_gezien, 0) > 0 then
      mag := false;
      waarom := format('Factuurnummer %s staat al bij deze leverancier.', trim(factuurnummer_in));
      return next; return;
    end if;
  end if;

  /*
   * De eerdere goedkeuringen, nieuwste eerst, en alleen die van een mens.
   * goedkeuring_bron is leeg bij alles van voor deze migratie; dat is
   * mensenwerk geweest en telt dus mee.
   */
  select array_agg(recent.b order by recent.d desc nulls last) into bedragen
    from (
      select e.amount_excl as b, e.approved_at as d
        from public.expenses e
       where lower(trim(coalesce(e.supplier, ''))) = partij
         and e.status = 'goedgekeurd'
         and coalesce(e.goedkeuring_bron, 'mens') = 'mens'
         and e.amount_excl > 0
         and (expense_in is null or e.id <> expense_in)
       order by e.approved_at desc nulls last
       limit 12
    ) recent;

  keren := coalesce(array_length(bedragen, 1), 0);
  if keren < vanaf then
    mag := false;
    waarom := format('Deze leverancier is %s keer door een mens goedgekeurd; er zijn er %s nodig.',
                     keren, vanaf);
    return next; return;
  end if;

  /*
   * De mediaan van de laatste <vanaf> bedragen, niet het gemiddelde: één
   * jaarafrekening ertussen zou het gemiddelde optillen en daarmee de grens
   * verschuiven voor alles wat daarna komt.
   */
  select percentile_cont(0.5) within group (order by w.b) into midden
    from unnest(bedragen[1:vanaf]) as w(b);
  gewoonte := round(midden, 2);

  if midden is null or midden <= 0 then
    mag := false; waarom := 'Geen bruikbaar bedrag om mee te vergelijken.'; return next; return;
  end if;

  afwijking := abs(bedrag_in - midden) / midden * 100;
  if afwijking > marge then
    mag := false;
    waarom := format('Wijkt %s%% af van de gebruikelijke %s euro; dat is meer dan de %s%% die mag.',
                     trim(to_char(afwijking, 'FM999990.9')),
                     trim(to_char(midden, 'FM999999990.99')),
                     trim(to_char(marge, 'FM999990.99')));
    return next; return;
  end if;

  mag := true;
  waarom := format('%s eerdere facturen van deze leverancier zijn met de hand goedgekeurd rond %s euro; dit bedrag wijkt %s%% af.',
                   vanaf,
                   trim(to_char(midden, 'FM999999990.99')),
                   trim(to_char(afwijking, 'FM999990.9')));
  return next;
end;
$$;

revoke execute on function public.mag_automatisch_goedkeuren(text, numeric, text, text)
  from public, anon, authenticated;
grant  execute on function public.mag_automatisch_goedkeuren(text, numeric, text, text)
  to authenticated, service_role;

comment on function public.mag_automatisch_goedkeuren(text, numeric, text, text) is
  'Mag deze factuur zichzelf goedkeuren? Geeft ja/nee met de reden, hoe vaak '
  'deze leverancier eerder door een mens is goedgekeurd, en het bedrag dat '
  'daarbij gebruikelijk was. Beslist niets zelf.';
