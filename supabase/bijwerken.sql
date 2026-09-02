-- ===========================================================================
--  Bijwerken: migratie 0017 tot en met 0040
--
--  Plak dit in de SQL-editor van Supabase en druk op Run. Opnieuw draaien mag.
--
--  Twijfel je of je een eerdere migratie hebt gedraaid, neem dan
--  supabase/setup.sql -- dat is het geheel, en dat mag ook opnieuw.
--
--  Wat erin zit:
--    0017  een werkgever en zijn chauffeur mogen elkaar bereiken
--    0018  in- en uitklokken gaat via de kassa
--    0019  een bericht als gelezen kunnen melden
--    0020  van melding naar plan
--    0021  je maakt jezelf geen management meer (belangrijk)
--    0022  bijwerken is geen aanmaken -- de bonnen uit de mail
--    0023  uitnodigen, uitschrijven en wissen
--    0024  uren rechtzetten en kilometers
--    0025  de kluis en het koppelen van een kassa
--    0026  vestigingen aanmaken, wijzigen, foto's en veilig wissen
--    0027  een foto bij het artikel (kassa)
--    0028  een kassa is geen aanmelding (kassa) -- draai deze
--    0029  de administratie, en wat er uit een factuur is gelezen
--    0030  0030_gewone_facturen_waren_verdacht.sql
--    0031  0031_bijwerken_is_nog_steeds_geen_aanmaken.sql
--    0032  0032_wat_weg_is_moet_ook_weg_blijven.sql
--    0033  de vestiging vult de website
--    0034  anon hoort hier niet bij te kunnen (beveiliging -- draai deze)
--    0035  de achttien vestigingen komen naar binnen
--    0036  Utrecht bleef op "kasweg 2112" staan (draai deze)
--    0037  een kassa mag klokken
--    0038  een verwijdering moet zichzelf melden (draai deze)
--    0039  verdwaalde regeleindes in de vestigingsteksten
--    0040  bijwerken is geen aanmaken -- nu op alle tabellen (draai deze)
-- ===========================================================================

-- ===========================================================================
--  Berichten over de grens van het eigen bedrijf heen
--
--  Draai dit ná 0016. Opnieuw draaien mag.
--
--  De fout:
--
--      opslaan in notifications: new row violates row-level security
--      policy for table "notifications"
--
--  Dit is de tweede keer dat deze regel omvalt, en om dezelfde reden als de
--  eerste keer (0013): hij noemt wie er mag sturen in plaats van wat er
--  gestuurd wordt. Elke keer dat er iemand bij komt die geen wasser is,
--  breekt hij opnieuw.
--
--  0013 zette hem op `is_staff()` -- werknemer of management. Daar vallen
--  buiten:
--
--    * een werkgever die een chauffeur uitnodigt of loskoppelt
--    * een chauffeur die een koppelverzoek aanneemt of weigert; die heeft
--      vaak helemaal geen rol, hij rijdt alleen voor een bedrijf
--    * een werkgever die zich aanmeldt en dat bij het kantoor meldt
--    * de ontwikkelaar die op een melding antwoordt -- 'developer' is geen
--      'employee', dus die stond er ook buiten
--
--  Het bericht hoort bij de handeling. Wordt het geweigerd, dan blijft het
--  in de wachtrij staan en gaat er niets meer doorheen.
--
--  Wat blijft staan
--  ----------------
--
--  De twee dingen die er werkelijk toe doen, veranderen niet:
--
--    * je stuurt nooit op andermans naam  (from_user_id = my_id())
--    * een bericht aan een hele rol blijft voor een leidinggevende
--
--  Wat verandert is wíé je mag bereiken, en dat wordt nu een vraag over de
--  verhouding tussen twee mensen in plaats van over een rollijst:
--
--    1. wie hier werkt, bereikt zijn collega's
--    2. iedereen bereikt het kantoor -- dat is waar je heen gaat met iets
--    3. een werkgever en zijn chauffeur bereiken elkaar, beide kanten op
--
--  Wat daarmee níét kan: een klant of een chauffeur die zomaar een
--  willekeurige wasmedewerker aanschrijft. Daar is de verhouding niet, dus
--  daar gaat het bericht niet heen.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Mijn eigen mailadres
--
--  Nodig omdat een uitnodiging aan een mailadres hangt en niet aan een
--  dossier: op het moment dat een chauffeur ja zegt, staat zijn id nog niet
--  op de koppeling.
-- ---------------------------------------------------------------------------

create or replace function public.my_email()
returns text language sql stable security definer set search_path = public as $$
  select email from public.profiles where auth_id = auth.uid();
$$;

grant execute on function public.my_email() to authenticated;

-- ---------------------------------------------------------------------------
--  Mag ik deze persoon een bericht sturen?
-- ---------------------------------------------------------------------------

create or replace function public.mag_bericht_sturen(doel text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    -- 1. Wie hier werkt, bereikt zijn collega's.
    --
    --    Ruimer dan is_staff(), want een monteur en de ontwikkelaar werken
    --    hier ook. Dat die er tot nu toe buiten vielen was geen keuze maar
    --    een gevolg van een lijst die niet is meegegroeid.
    public.is_staff()
    or 'technician' = any(public.my_roles())
    or 'developer'  = any(public.my_roles())

    -- 2. Iedereen bereikt het kantoor.
    --
    --    Een werkgever die zich aanmeldt, een klant met een vraag: die
    --    hebben één adres, en dat is management. Eén kant op: hieruit volgt
    --    niet dat management iedereen bereikt -- dat volgt al uit 1.
    or exists (
      select 1 from public.profiles p
       where p.id = doel and p.active and 'management' = any(p.roles)
    )

    -- 3. Een werkgever en zijn chauffeur bereiken elkaar.
    --
    --    De koppeling zelf is het bewijs van de verhouding. Ook een
    --    beëindigde telt hier: juist bij het loskoppelen moet het bericht
    --    aankomen, en dat gaat over dezelfde rij.
    or exists (
      select 1
        from public.employer_links l
        join public.employers e on e.id = l.werkgever_id
       where (
               -- ik ben de chauffeur, het doel beheert het bedrijf
               (l.user_id = public.my_id()
                or lower(l.email) = lower(coalesce(public.my_email(), '')))
               and doel = any(e.beheerders)
             )
          or (
               -- ik beheer het bedrijf, het doel is de chauffeur
               public.my_id() = any(e.beheerders)
               and (
                 l.user_id = doel
                 or lower(l.email) = lower(coalesce(
                      (select p.email from public.profiles p where p.id = doel), ''))
               )
             )
    );
$$;

grant execute on function public.mag_bericht_sturen(text) to authenticated;

-- ---------------------------------------------------------------------------
--  De regel zelf
-- ---------------------------------------------------------------------------

drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert to authenticated
  with check (
    from_user_id = public.my_id()
    and (
      case
        when to_user_id is not null then public.mag_bericht_sturen(to_user_id)
        -- Een bericht aan een hele rol bereikt iedereen tegelijk. Dat hoort
        -- niet bij iemand te kunnen die alleen zijn collega wil bereiken.
        else public.is_lead()
      end
    )
  );

-- ===========================================================================
--  In- en uitklokken gaat via de kassa
--
--  Draai dit ná 0017. Opnieuw draaien mag.
--
--  Tot nu toe kon iedereen in het dashboard op "Starten" drukken en daarmee
--  zijn eigen urenstaat schrijven. Dat hoort niet thuis in een app die op
--  ieders telefoon staat: dan is inklokken iets wat je vanaf de bank doet.
--
--  Klokken hoort bij het apparaat op de vestiging. Daar toets je je
--  persoonlijke code in of scan je je badge (pos_pins), en dáármee ontstaat
--  de urenregel -- op de plek waar je ook werkelijk staat.
--
--  De regel op time_entries stond op:
--
--      using (public.is_management() or user_id = public.my_id())
--
--  Dat tweede deel is precies de zelfbediening die eruit moet. Maar het
--  eerste deel was ook niet genoeg: de kassa schrijft een urenregel voor de
--  persoon die zich zojuist heeft gemeld, en dat is een ander dossier dan
--  dat van het kassa-account zelf. Met de oude regel kon de kassa dus
--  helemaal niets wegschrijven.
--
--  Vandaar een eigen recht: hours.clock. Dat kent het management toe aan het
--  kassa-account, net zoals pos.manage. Het dashboard vraagt er nooit om.
--
--  Kijken blijft zoals het was -- je eigen uren zie je gewoon, en een
--  leidinggevende die van zijn team -- met één toevoeging: het kassa-account
--  moet ook kunnen kijken. Anders vindt het de openstaande regel niet die
--  het wil afsluiten.
-- ===========================================================================

-- De oude regel deed insert, update én delete in één keer.
drop policy if exists time_write on public.time_entries;

/*
 * En de kassa moet ook kunnen kijken.
 *
 * Niet vanzelfsprekend, dus expliciet: om iemand uit te klokken moet het
 * apparaat de regel kunnen vinden die nog openstaat. Zonder leesrecht raakt
 * die update nul rijen en gebeurt er stilletjes niets -- geen foutmelding,
 * alleen een uitklokking die er nooit is gekomen.
 *
 * Het is een apparaat op de vestiging, geen persoon: het ziet urenregels en
 * verder niets. Uurlonen en dossiers zitten in personnel_private en daar
 * komt het niet.
 */
drop policy if exists time_select on public.time_entries;
create policy time_select on public.time_entries for select to authenticated
  using (
    public.is_lead()
    or user_id = public.my_id()
    or public.heeft_recht('hours.clock')
  );

/*
 * Schrijven doet de kassa, of het kantoor als er iets rechtgezet moet
 * worden. Een medewerker schrijft niet in zijn eigen urenstaat -- ook niet
 * als klopt wat hij zou schrijven. Een urenstaat die je zelf kunt bijwerken
 * is geen urenstaat maar een voorstel.
 */
drop policy if exists time_insert on public.time_entries;
create policy time_insert on public.time_entries for insert to authenticated
  with check (public.is_management() or public.heeft_recht('hours.clock'));

/*
 * Bijwerken: de kassa, het kantoor, en -- alleen om een lopende regel af te
 * sluiten -- een leidinggevende. Die staat erbij als iemand aan het eind van
 * de dag vergeet uit te klokken, en zonder dat blijft zo'n regel eeuwig
 * openstaan. Wat hij precies mag bewaakt de trigger hieronder.
 */
drop policy if exists time_update on public.time_entries;
create policy time_update on public.time_entries for update to authenticated
  using (
    public.is_management()
    or public.heeft_recht('hours.clock')
    or (public.is_supervisor() and ended_at is null)
  )
  with check (
    public.is_management()
    or public.heeft_recht('hours.clock')
    or public.is_supervisor()
  );

/*
 * Weggooien doet alleen het kantoor. Een verkeerd gezette uitklokking
 * corrigeer je; een gewerkt uur dat verdwijnt is een gewerkt uur dat niet
 * wordt uitbetaald.
 */
drop policy if exists time_delete on public.time_entries;
create policy time_delete on public.time_entries for delete to authenticated
  using (public.is_management());

-- ---------------------------------------------------------------------------
--  Wat een leidinggevende precies mag
--
--  Beveiligingsregels kijken naar de nieuwe rij, niet naar het verschil met
--  de oude. "Alleen de eindtijd zetten" is een verschil, dus dat hoort in een
--  trigger. Zonder deze zou een leidinggevende via een openstaande regel het
--  begin, de persoon of de vestiging kunnen verzetten.
-- ---------------------------------------------------------------------------

create or replace function public.time_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_management() or public.heeft_recht('hours.clock') then
    return new;
  end if;

  if public.is_supervisor()
     and old.ended_at is null
     and new.ended_at is not null
     and new.user_id     is not distinct from old.user_id
     and new.started_at  is not distinct from old.started_at
     and new.location_id is not distinct from old.location_id
  then
    return new;
  end if;

  raise exception 'Uren schrijf je aan de kassa, niet hier';
end;
$$;

drop trigger if exists time_bewaak on public.time_entries;
create trigger time_bewaak before update on public.time_entries
  for each row execute function public.time_bewaak_wijziging();

-- ===========================================================================
--  Een bericht als gelezen kunnen melden
--
--  Draai dit ná 0018. Opnieuw draaien mag.
--
--  De fout:
--
--      opslaan in notifications: new row violates row-level security
--      policy for table "notifications"
--
--  ...op een bericht met een id als nt_mb_<mailid>_<baas>. Dat zijn de
--  seintjes die de postbus-serverfunctie maakt als er post binnenkomt. Die
--  worden dus niet door de app verstuurd -- ze worden alleen gelézen.
--
--  En daar zat het. De app kent één manier om iets naar de server te
--  brengen: de hele regel opsturen, en de database beslist of dat een nieuwe
--  regel is of een wijziging. Dat is een upsert, en bij een upsert kijkt
--  Postgres naar de regel voor INSERT én naar die voor UPDATE. Allebei
--  moeten ze meewerken.
--
--  De regel voor INSERT zegt: `from_user_id = my_id()`. Terecht -- je
--  verstuurt niet op andermans naam. Maar hij gold ook voor het openklikken
--  van een bericht dat er allang stond. Daarmee kon je alleen berichten als
--  gelezen melden die je zelf had verstuurd, en dat is nou net de categorie
--  die je niet krijgt.
--
--  Bij de seintjes uit de postbus viel het extra hard op: die hebben
--  helemaal geen afzender -- ze komen van "Postbus", niet van een persoon.
--
--  Wat er nu gebeurt: bestaat de regel al, dan is dit geen verzending maar
--  een wijziging, en dan beslist de regel voor UPDATE. Wat je aan een
--  bestaand bericht mag veranderen bewaakt de trigger eronder, en dat is
--  precies één ding: of je het gelezen hebt.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Bestaat dit bericht al?
--
--  Als losse functie, want een regel op notifications die zelf notifications
--  leest draait in een kringetje. Met security definer gaat de vraag langs
--  de regels heen -- en meer dan "ja of nee" komt er niet uit.
-- ---------------------------------------------------------------------------

create or replace function public.bericht_bestaat(bericht_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.notifications n where n.id = bericht_id);
$$;

grant execute on function public.bericht_bestaat(text) to authenticated;

drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert to authenticated
  with check (
    -- Een bestaande regel: dit is een wijziging, geen verzending.
    public.bericht_bestaat(id)
    -- Een nieuwe regel: dan gelden de eisen aan versturen onverkort.
    or (
      from_user_id = public.my_id()
      and (
        case
          when to_user_id is not null then public.mag_bericht_sturen(to_user_id)
          else public.is_lead()
        end
      )
    )
  );

-- ---------------------------------------------------------------------------
--  Wat je aan een bestaand bericht mag veranderen
--
--  Zonder dit zou de ontvanger de tekst van zijn eigen bericht kunnen
--  herschrijven. Dat is niet erg in de zin dat er iets uitlekt, maar een
--  bericht dat achteraf iets anders zegt dan er is verstuurd is geen bericht
--  meer.
--
--  De afzender mag zijn eigen bericht wel bijwerken -- die heeft het
--  geschreven. En het management sowieso.
-- ---------------------------------------------------------------------------

create or replace function public.notif_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Geen ingelogde gebruiker: dan is dit de server zelf (de serverfuncties
  -- draaien met de servicesleutel). Die komt hier niet aan banden te liggen.
  if public.my_id() is null then return new; end if;

  if public.is_management() or old.from_user_id = public.my_id() then
    return new;
  end if;

  if new.to_user_id   is not distinct from old.to_user_id
     and new.to_role  is not distinct from old.to_role
     and new.kind     is not distinct from old.kind
     and new.title    is not distinct from old.title
     and new.body     is not distinct from old.body
     and new.link     is not distinct from old.link
     and new.from_user_id is not distinct from old.from_user_id
     and new.from_name    is not distinct from old.from_name
     and new.created_at   is not distinct from old.created_at
  then
    -- Alleen read_at is veranderd. Dat is het openklikken van de bel.
    return new;
  end if;

  raise exception 'Aan een bericht van iemand anders verandert alleen of je het gelezen hebt';
end;
$$;

drop trigger if exists notif_bewaak on public.notifications;
create trigger notif_bewaak before update on public.notifications
  for each row execute function public.notif_bewaak_wijziging();

-- ===========================================================================
--  Van melding naar plan
--
--  Draai dit ná 0019. Opnieuw draaien mag.
--
--  Een melding is zelden meteen een opdracht. "Hij doet het niet" is waar en
--  onbruikbaar; "kan dit handiger" ook. Wat eraan ontbreekt zijn de vragen
--  die je anders drie dagen later alsnog stelt, als de melder allang is
--  vergeten wat hij precies deed.
--
--  Daarom: eerst een gesprek met de melder -- dat staat als gewone berichten
--  bij de melding, dus daar is hier geen tabel voor nodig -- en daarna een
--  plan in stappen.
--
--  De stappen staan als jsonb in één rij en niet als losse tabel. Ze worden
--  altijd samen gelezen en samen bijgewerkt (iemand loopt het plan langs en
--  zet vinkjes), dus een tweede tabel zou alleen maar een tweede plek zijn
--  waar het uit de pas kan lopen.
--
--  Wie wat mag:
--
--    lezen      wie meldingen mag zien -- de ontwikkelaar en het management
--    maken      wie plannen mag maken (dev.plan)
--    beslissen  het management, of wie dev.approve heeft gekregen
--
--  De melder ziet het plan niet. Hij ziet wél wat eruit besloten is: dat komt
--  als bericht bij zijn melding te staan, inclusief wat er niet gebeurt en
--  waarom. Een half plan lezen is verwarrender dan de uitkomst horen.
-- ===========================================================================

create table if not exists public.dev_plans (
  id                  text primary key,
  ticket_id           text not null references public.tickets(id) on delete cascade,
  ticket_number       text not null default '',
  titel               text not null default '',
  aanleiding          text not null default '',

  -- [{id,titel,wat,waarom,raakt,risico,omvang,gekozen,opmerking}]
  stappen             jsonb not null default '[]'::jsonb,
  buiten_scope        text,

  status              text not null default 'concept'
                      check (status in ('concept','ter beoordeling','goedgekeurd','afgewezen','uitgevoerd')),
  bron                text not null default 'handmatig'
                      check (bron in ('gesprek','vragenlijst','handmatig')),

  gemaakt_door        text,
  gemaakt_door_naam   text default '',
  gemaakt_op          bigint not null default public.now_ms(),

  beoordeeld_door     text,
  beoordeeld_door_naam text,
  beoordeeld_op       bigint,
  opmerking           text,

  uitgevoerd_in       text,
  uitgevoerd_op       bigint,

  updated_at          bigint not null default public.now_ms()
);

create index if not exists dev_plans_ticket_idx  on public.dev_plans (ticket_id);
create index if not exists dev_plans_status_idx  on public.dev_plans (status);
create index if not exists dev_plans_updated_idx on public.dev_plans (updated_at);

drop trigger if exists stamp_dev_plans on public.dev_plans;
create trigger stamp_dev_plans before insert or update on public.dev_plans
  for each row execute function public.stamp_updated_at();

-- ---------------------------------------------------------------------------
--  Beveiliging
-- ---------------------------------------------------------------------------

alter table public.dev_plans enable row level security;

create or replace function public.mag_plannen()
returns boolean language sql stable as $$
  select public.is_management()
      or 'developer' = any(public.my_roles())
      or public.heeft_recht('dev.plan');
$$;

create or replace function public.mag_plan_beslissen()
returns boolean language sql stable as $$
  select public.is_management() or public.heeft_recht('dev.approve');
$$;

grant execute on function public.mag_plannen(), public.mag_plan_beslissen() to authenticated;

drop policy if exists dev_plans_select on public.dev_plans;
create policy dev_plans_select on public.dev_plans for select to authenticated
  using (public.mag_plannen() or public.mag_plan_beslissen());

drop policy if exists dev_plans_insert on public.dev_plans;
create policy dev_plans_insert on public.dev_plans for insert to authenticated
  with check (public.mag_plannen());

drop policy if exists dev_plans_update on public.dev_plans;
create policy dev_plans_update on public.dev_plans for update to authenticated
  using (public.mag_plannen() or public.mag_plan_beslissen())
  with check (public.mag_plannen() or public.mag_plan_beslissen());

drop policy if exists dev_plans_delete on public.dev_plans;
create policy dev_plans_delete on public.dev_plans for delete to authenticated
  using (public.is_management());

/*
 * Wie het plan maakt, keurt het niet zelf goed.
 *
 * Niet omdat de ontwikkelaar niet te vertrouwen is, maar omdat dat het hele
 * punt van deze stap is: er zit iemand tussen die bepaalt wat er gebouwd
 * wordt. Valt die weg, dan is het een formulier en geen beslissing.
 *
 * En een plan dat eenmaal is uitgevoerd staat vast. Achteraf de stappen
 * bijstellen zou betekenen dat er iets anders in de app zit dan er in het
 * plan staat, en dan kun je er niet meer op terugkijken.
 */
create or replace function public.plan_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.my_id() is null then return new; end if;

  if old.status = 'uitgevoerd' and not public.is_management() then
    raise exception 'Een uitgevoerd plan staat vast';
  end if;

  if new.status is distinct from old.status
     and new.status in ('goedgekeurd', 'afgewezen')
  then
    if not public.mag_plan_beslissen() then
      raise exception 'Beslissen over een plan doet het management';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists plan_bewaak on public.dev_plans;
create trigger plan_bewaak before update on public.dev_plans
  for each row execute function public.plan_bewaak_wijziging();

-- ===========================================================================
--  Wat je aan je eigen dossier mag veranderen, en de rondleiding
--
--  Draai dit ná 0020. Opnieuw draaien mag.
--
--  Dit had er vanaf het begin moeten staan.
--
--  De regel op profiles luidt:
--
--      using (public.is_management() or auth_id = auth.uid())
--
--  Dat is prima voor wíé er mag schrijven, maar het zegt niets over wát.
--  Beveiligingsregels in PostgreSQL werken per rij en niet per kolom, dus
--  "je mag je eigen rij bijwerken" betekende letterlijk: je hele rij. Ook de
--  kolom `roles`.
--
--  Daarmee kon iedereen met een account zichzelf management maken. Eén
--  update op zijn eigen profiel en hij zag de omzet, de dossiers, de
--  uurlonen en de rechten van iedereen. Niet via een omweg of een truc --
--  gewoon, omdat het mocht.
--
--  Wat een kolom is die niemand over zichzelf hoort te bepalen, staat
--  hieronder. De rest -- je naam, je telefoonnummer, je voorkeuren -- mag je
--  gewoon zelf zetten, en dat blijft zo.
--
--  De rem zet zo'n kolom stilletjes terug in plaats van de hele wijziging te
--  weigeren. Dat is geen slapheid: de app stuurt een gewijzigd dossier als
--  hele rij op, met wat er lokaal bekend was, dus wie offline zijn naam
--  wijzigt terwijl het kantoor ondertussen zijn rol aanpast stuurt die oude
--  rol mee zonder iets van plan te zijn. Weigeren zou daar een wachtrij
--  opleveren die niet meer leegloopt. Wie het wél probeert bereikt precies
--  hetzelfde als hij nu bereikt: niets.
--
--  En meteen de kolom erbij voor de rondleiding: welke uitleg iemand al
--  heeft gezien. Dat hoort bij het profiel en niet op het apparaat, want
--  anders begint hij op elke telefoon opnieuw.
-- ===========================================================================

alter table public.profiles
  add column if not exists seen_tours text[] not null default '{}';

-- ---------------------------------------------------------------------------
--  De rem
-- ---------------------------------------------------------------------------

create or replace function public.profiel_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- De server zelf (serverfuncties met de servicesleutel) en het management.
  if public.my_id() is null or public.is_management() then
    return new;
  end if;

  /*
   * Iemand anders zijn dossier komt hier niet eens langs -- daar houdt de
   * beveiligingsregel hem al tegen. Wat hier gebeurt is de tweede helft: op
   * je eigen rij zijn dit de kolommen die niet van jou zijn.
   *
   * Terugzetten in plaats van weigeren, met opzet. De app stuurt een
   * gewijzigd dossier als hele rij op, met wat er lokaal bekend was. Heeft
   * het kantoor ondertussen je rol aangepast terwijl jij offline was, dan
   * stuur je die oude rol dus mee zonder dat je iets van plan bent -- en dan
   * hoort er niets te gebeuren, geen foutmelding die de wachtrij laat
   * vastlopen. Wie het wél probeert, bereikt precies hetzelfde: niets.
   */
  new.roles            := old.roles;
  new.grants           := old.grants;
  new.revokes          := old.revokes;
  new.active           := old.active;
  new.all_locations    := old.all_locations;
  new.manages          := old.manages;
  new.location_id      := old.location_id;
  new.company_id       := old.company_id;
  new.supervisor_id    := old.supervisor_id;
  new.personnel_number := old.personnel_number;
  new.job_title        := old.job_title;
  new.contract_hours   := old.contract_hours;
  new.start_date       := old.start_date;
  new.end_date         := old.end_date;
  new.hourly_rate      := old.hourly_rate;
  new.notes            := old.notes;
  new.email            := old.email;
  new.auth_id          := old.auth_id;

  /*
   * Het vinkje "moet zijn wachtwoord nog wijzigen" mag je zelf uitzetten --
   * dat is precies wat er gebeurt als je het hebt gewijzigd. Aanzetten hoort
   * bij het uitnodigen, en dat doet de server.
   */
  if new.must_change_password and not old.must_change_password then
    new.must_change_password := old.must_change_password;
  end if;

  return new;
end;
$$;

drop trigger if exists profiel_bewaak on public.profiles;
create trigger profiel_bewaak before update on public.profiles
  for each row execute function public.profiel_bewaak_wijziging();

-- ===========================================================================
--  Bijwerken is geen aanmaken
--
--  Draai dit ná 0021. Opnieuw draaien mag.
--
--  De fout:
--
--      De database weigert dit voor "expenses": new row violates row-level
--      security policy for table "expenses"
--
--  Dit is dezelfde valstrik als bij de berichten in 0019, en hij zit op meer
--  tabellen dan ik toen doorhad.
--
--  De app kent één manier om iets naar de server te brengen: de hele rij
--  opsturen, en de database laten bepalen of dat nieuw is of een wijziging.
--  Dat is een upsert. En bij een upsert kijkt Postgres naar de regel voor
--  INSERT én naar die voor UPDATE -- allebei moeten ze meewerken.
--
--  Zodra de regel voor INSERT iets zegt over wie de rij heeft gemaakt, gaat
--  dat mis bij elke wijziging door iemand anders:
--
--    expenses         `submitted_by = my_id()`. Een bon die per mail
--                     binnenkwam heeft helemaal geen indiener. Het management
--                     kon hem dus openen, maar niet goedkeuren.
--
--    employer_links   alleen de beheerder van het bedrijf mag er een maken.
--                     Maar een chauffeur die zijn koppelverzoek aanneemt
--                     werkt diezelfde rij bij -- en die is geen beheerder.
--
--    agenda_items     `created_by = my_id()`. Een afspraak van een collega
--                     bijwerken kon dus niet, ook niet als je erbij hoort.
--
--  De regel: bestaat de rij al, dan is dit geen aanmaken maar een wijziging,
--  en dan beslist de regel voor UPDATE. Die stond in alle drie de gevallen
--  al goed.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Bestaat deze rij al?
--
--  Als losse functie, want een regel op een tabel die zichzelf leest draait
--  in een kringetje. Met security definer gaat de vraag langs de regels heen,
--  en er komt niet meer uit dan ja of nee.
--
--  Het type regclass in plaats van tekst is met opzet: daarmee kan er geen
--  tabelnaam in worden gesmokkeld die er niet hoort.
-- ---------------------------------------------------------------------------

create or replace function public.rij_bestaat(tabel regclass, sleutel text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare gevonden boolean;
begin
  execute format('select exists (select 1 from %s where id = $1)', tabel)
    into gevonden using sleutel;
  return gevonden;
end;
$$;

grant execute on function public.rij_bestaat(regclass, text) to authenticated;

-- ---------------------------------------------------------------------------
--  Bonnen
--
--  Een bon die per mail binnenkwam heeft geen indiener -- die komt van de
--  postbus. Het management hoort hem gewoon te kunnen invullen en afhandelen.
-- ---------------------------------------------------------------------------

drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses for insert to authenticated
  with check (
    public.rij_bestaat('public.expenses'::regclass, id)
    or public.is_management()
    or (public.is_staff() and submitted_by = public.my_id())
  );

drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses for update to authenticated
  using (
    public.is_management()
    or (submitted_by = public.my_id() and status = 'open')
  )
  with check (
    public.is_management()
    or (submitted_by = public.my_id() and status = 'open')
  );

-- ---------------------------------------------------------------------------
--  Koppelingen met een werkgever
--
--  Aannemen of weigeren van een koppelverzoek is een wijziging van een rij
--  die er al staat. Wie dat mag, staat in wgk_update.
-- ---------------------------------------------------------------------------

drop policy if exists wgk_insert on public.employer_links;
create policy wgk_insert on public.employer_links for insert to authenticated
  with check (
    public.rij_bestaat('public.employer_links'::regclass, id)
    or public.is_management()
    or exists (
      select 1 from public.employers e
       where e.id = werkgever_id
         and e.status = 'actief'
         and public.my_id() = any(e.beheerders)
    )
  );

-- ---------------------------------------------------------------------------
--  De agenda
-- ---------------------------------------------------------------------------

drop policy if exists agenda_insert on public.agenda_items;
create policy agenda_insert on public.agenda_items for insert to authenticated
  with check (
    public.rij_bestaat('public.agenda_items'::regclass, id)
    or (public.is_staff() and created_by = public.my_id())
  );

-- ===========================================================================
--  Uitnodigen en uitschrijven
--
--  Draai dit ná 0022. Opnieuw draaien mag.
--
--  Twee gaten die aan elkaar hangen.
--
--  1. Dubbele mensen
--
--     Het kantoor maakt een dossier aan. Diezelfde persoon meldt zich daarna
--     zelf aan, want er kwam geen uitnodiging -- en doet dat met zijn privé-
--     adres. De koppeling in handle_new_user kijkt op e-mailadres, dus die
--     ziet twee verschillende mensen. Twee dossiers, twee personeelsnummers,
--     twee keer dezelfde man in het rooster.
--
--     De oplossing zit vooral in het uitnodigen: wie een uitnodiging krijgt
--     hoeft zich niet aan te melden. Wat hier bij komt is de vangnet-kant --
--     bij het toelaten van een aanmelding zien of er al iemand met die naam
--     staat, en dan kunnen koppelen in plaats van een tweede aanmaken.
--
--  2. Niemand kon iemand weghalen
--
--     Er stond geen enkele regel voor verwijderen op profiles. Zonder regel
--     mag het niet, dus een dossier dat er per ongeluk stond bleef er staan.
--
--     Twee manieren, want het is niet één ding:
--
--       uitschrijven   inlog en dossier gaan dicht, de persoon is nergens
--                      meer te kiezen, maar zijn uren, wasbeurten en
--                      getekende contracten blijven staan. Dit is wat de
--                      bewaarplicht van je vraagt: loonadministratie en
--                      contracten zeven jaar.
--
--       wissen         werkelijk alles weg. Voor een AVG-verzoek, en pas als
--                      de bewaarplicht voorbij is. Onomkeerbaar, dus met een
--                      reden erbij die blijft staan nadat de persoon weg is.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Uitgeschreven
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists archived_at     bigint,
  add column if not exists archived_by     text,
  add column if not exists archive_reason  text;

create index if not exists profiles_archived_idx on public.profiles (archived_at);

/*
 * De rem uit 0021 kent deze kolommen nog niet. Zonder dit zou een
 * medewerker zichzelf kunnen uitschrijven -- of erger, zichzelf weer
 * terugzetten nadat het kantoor hem eruit heeft gehaald.
 */
create or replace function public.profiel_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.my_id() is null or public.is_management() then
    return new;
  end if;

  new.roles            := old.roles;
  new.grants           := old.grants;
  new.revokes          := old.revokes;
  new.active           := old.active;
  new.all_locations    := old.all_locations;
  new.manages          := old.manages;
  new.location_id      := old.location_id;
  new.company_id       := old.company_id;
  new.supervisor_id    := old.supervisor_id;
  new.personnel_number := old.personnel_number;
  new.job_title        := old.job_title;
  new.contract_hours   := old.contract_hours;
  new.start_date       := old.start_date;
  new.end_date         := old.end_date;
  new.hourly_rate      := old.hourly_rate;
  new.notes            := old.notes;
  new.email            := old.email;
  new.auth_id          := old.auth_id;
  new.archived_at      := old.archived_at;
  new.archived_by      := old.archived_by;
  new.archive_reason   := old.archive_reason;

  if new.must_change_password and not old.must_change_password then
    new.must_change_password := old.must_change_password;
  end if;

  return new;
end;
$$;

drop trigger if exists profiel_bewaak on public.profiles;
create trigger profiel_bewaak before update on public.profiles
  for each row execute function public.profiel_bewaak_wijziging();

-- ---------------------------------------------------------------------------
--  Wissen: wat er overblijft als de persoon weg is
--
--  Een dossier dat verdwijnt laat niets achter, en dat is precies het
--  probleem: dan kan later niemand meer nagaan dat het is gebeurd, door wie
--  en waarom. Deze regel blijft, met alleen wat nodig is om die vraag te
--  beantwoorden -- geen gegevens van de persoon zelf behalve zijn naam.
-- ---------------------------------------------------------------------------

create table if not exists public.deletion_log (
  id            text primary key,
  soort         text not null default 'medewerker',
  naam          text not null default '',
  /* Het personeelsnummer, zodat een oude urenlijst nog te plaatsen is */
  kenmerk       text,
  reden         text not null default '',
  door          text,
  door_naam     text not null default '',
  at            bigint not null default public.now_ms(),
  updated_at    bigint not null default public.now_ms()
);

create index if not exists deletion_log_at_idx on public.deletion_log (at);

alter table public.deletion_log enable row level security;

drop policy if exists deletion_log_select on public.deletion_log;
create policy deletion_log_select on public.deletion_log for select to authenticated
  using (public.is_management());

/* Schrijven doet de serverfunctie met de servicesleutel, niemand anders. */
drop policy if exists deletion_log_write on public.deletion_log;
create policy deletion_log_write on public.deletion_log for all to authenticated
  using (false) with check (false);

-- ---------------------------------------------------------------------------
--  Verwijderen mag het management
--
--  De serverfunctie doet het echte werk -- die haalt ook het inlogaccount
--  weg, en daar heb je de servicesleutel voor nodig. Maar zonder deze regel
--  zou zelfs dát niet lukken vanuit de app, en dan blijft een verkeerd
--  aangemaakt dossier eeuwig staan.
-- ---------------------------------------------------------------------------

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete to authenticated
  using (public.is_management() and id <> public.my_id());

-- ---------------------------------------------------------------------------
--  Wie is uitgeschreven, telt niet meer mee
--
--  Alleen voor het lezen van de lijst. Wie uitgeschreven is verdwijnt uit
--  het beeld van collega's, maar het management blijft hem zien -- anders
--  kun je een vergissing niet terugdraaien.
-- ---------------------------------------------------------------------------

create or replace function public.is_uitgeschreven(dossier text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select archived_at is not null from public.profiles where id = dossier),
    false);
$$;

grant execute on function public.is_uitgeschreven(text) to authenticated;

-- ===========================================================================
--  Uren rechtzetten en kilometers verantwoorden
--
--  Draai dit ná 0023. Opnieuw draaien mag.
--
--  Twee dingen die een medewerker over zichzelf moet kunnen zeggen, en één
--  ding dat hij juist niet zelf mag bepalen.
--
--  1. Uren rechtzetten
--
--     Klokken gaat sinds 0018 via de kassa, en dat is goed: waar je werkt
--     hoort te blijken uit waar je inklokt. Maar iemand die vergeet in te
--     klokken staat nu met lege handen -- hij was er wel, het staat er niet,
--     en hij kan er zelf niets aan doen.
--
--     Vandaar een verzoek: hij geeft aan wat er had moeten staan en waarom,
--     zijn leidinggevende kijkt ernaar. Niet hijzelf, want dan is het geen
--     urenstaat meer maar een voorstel -- precies wat we in 0018 hebben
--     dichtgezet.
--
--     Alles blijft staan: wat hij vroeg, wat het was, wie besliste en
--     wanneer. Een urenstaat waarin achteraf iets is veranderd zonder spoor
--     is een urenstaat waar je niets meer aan hebt.
--
--  2. Kilometers
--
--     Van adres naar adres, uitgerekend over de weg. Losse kilometers
--     intypen kan niet, en dat is de hele bedoeling: een vergoeding waarbij
--     iedereen zijn eigen getal invult is geen vergoeding maar een
--     vertrouwenskwestie.
--
--     De afstand wordt één keer opgezocht en dan onthouden. Woon-werk is
--     elke dag dezelfde route; die hoeft niet elke dag opnieuw berekend te
--     worden.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Waar iemand woont
--
--  Hoort bij het afgeschermde deel: het adres van een collega gaat niemand
--  anders aan, en zonder adres valt woon-werkverkeer niet uit te rekenen.
-- ---------------------------------------------------------------------------

alter table public.personnel_private
  add column if not exists address  text,
  add column if not exists postcode text,
  add column if not exists city     text;

-- ---------------------------------------------------------------------------
--  Een verzoek om de uren recht te zetten
-- ---------------------------------------------------------------------------

create table if not exists public.hour_requests (
  id             text primary key,
  user_id        text not null,
  user_name      text not null default '',
  /* De regel waar het over gaat; leeg betekent: die is er helemaal niet */
  entry_id       text,
  location_id    text references public.locations(id) on delete set null,

  soort          text not null default 'vergeten'
                 check (soort in ('vergeten','verkeerde tijd','te vroeg uitgeklokt','anders')),
  /* Wat er volgens de medewerker had moeten staan */
  van            bigint not null,
  tot            bigint,
  toelichting    text not null default '',

  status         text not null default 'nieuw'
                 check (status in ('nieuw','goedgekeurd','afgewezen','ingetrokken')),
  aangevraagd_op bigint not null default public.now_ms(),

  beslist_door      text,
  beslist_door_naam text,
  beslist_op        bigint,
  beslissing_reden  text,

  updated_at     bigint not null default public.now_ms()
);

create index if not exists hr_user_idx    on public.hour_requests (user_id);
create index if not exists hr_status_idx  on public.hour_requests (status);
create index if not exists hr_updated_idx on public.hour_requests (updated_at);

-- ---------------------------------------------------------------------------
--  Ritten
-- ---------------------------------------------------------------------------

create table if not exists public.trips (
  id            text primary key,
  user_id       text not null,
  user_name     text not null default '',
  op            bigint not null,

  van_label     text not null default '',
  naar_label    text not null default '',
  /* Wat er werkelijk is opgezocht; hiermee is de afstand na te rekenen */
  van_adres     text not null default '',
  naar_adres    text not null default '',

  /* Kilometers over de weg, één kant op */
  km            numeric not null default 0,
  retour        boolean not null default false,
  doel          text not null default 'woon-werk'
                check (doel in ('woon-werk','klant','vestiging','anders')),
  toelichting   text,

  /* Waar de afstand vandaan komt; 'handmatig' bestaat met opzet niet */
  bron          text not null default 'route'
                check (bron in ('route','vast')),

  status        text not null default 'nieuw'
                check (status in ('nieuw','goedgekeurd','afgewezen')),
  beslist_door      text,
  beslist_door_naam text,
  beslist_op        bigint,

  updated_at    bigint not null default public.now_ms()
);

create index if not exists trips_user_idx    on public.trips (user_id);
create index if not exists trips_op_idx      on public.trips (op);
create index if not exists trips_updated_idx on public.trips (updated_at);

/*
 * Niemand vult zijn eigen kilometers in.
 *
 * Dit staat hier en niet alleen in het scherm, want een scherm is een
 * afspraak en dit is een regel. De afstand komt van de routedienst; de
 * serverfunctie schrijft hem weg.
 */
create or replace function public.rit_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.my_id() is null or public.is_lead() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.km <> 0 then
      raise exception 'De kilometers worden uitgerekend, niet ingevuld';
    end if;
    return new;
  end if;

  if new.km is distinct from old.km
     or new.van_adres is distinct from old.van_adres
     or new.naar_adres is distinct from old.naar_adres
     or new.status is distinct from old.status
  then
    raise exception 'De afstand en de beoordeling bepaal je niet zelf';
  end if;
  return new;
end;
$$;

drop trigger if exists rit_bewaak on public.trips;
create trigger rit_bewaak before insert or update on public.trips
  for each row execute function public.rit_bewaak_wijziging();

-- ---------------------------------------------------------------------------
--  Het geheugen van de routedienst
--
--  Woon-werk is elke dag dezelfde route. Die hoeft niet elke dag opnieuw te
--  worden opgevraagd -- dat kost tijd, en bij een betaalde dienst geld.
-- ---------------------------------------------------------------------------

create table if not exists public.route_cache (
  id          text primary key,
  van         text not null,
  naar        text not null,
  km          numeric not null,
  minuten     integer,
  dienst      text not null default 'ors',
  at          bigint not null default public.now_ms(),
  updated_at  bigint not null default public.now_ms()
);

-- ---------------------------------------------------------------------------
--  Tijdstempels
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['hour_requests','trips','route_cache'] loop
    execute format('drop trigger if exists stamp_%1$s on public.%1$I', t);
    execute format(
      'create trigger stamp_%1$s before insert or update on public.%1$I
       for each row execute function public.stamp_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
--  Beveiliging
-- ---------------------------------------------------------------------------

alter table public.hour_requests enable row level security;
alter table public.trips         enable row level security;
alter table public.route_cache   enable row level security;

/* --- urenverzoeken --- */

drop policy if exists hr_select on public.hour_requests;
create policy hr_select on public.hour_requests for select to authenticated
  using (user_id = public.my_id() or public.is_lead());

drop policy if exists hr_insert on public.hour_requests;
create policy hr_insert on public.hour_requests for insert to authenticated
  with check (
    public.rij_bestaat('public.hour_requests'::regclass, id)
    or (public.is_staff() and user_id = public.my_id() and status = 'nieuw')
  );

-- Beslissen doet de leidinggevende; intrekken mag de aanvrager zelf.
drop policy if exists hr_update on public.hour_requests;
create policy hr_update on public.hour_requests for update to authenticated
  using (public.is_lead() or user_id = public.my_id())
  with check (public.is_lead() or user_id = public.my_id());

create or replace function public.hr_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.my_id() is null or public.is_lead() then return new; end if;

  -- De aanvrager mag precies één ding: zijn eigen verzoek intrekken.
  if new.status = 'ingetrokken'
     and old.status = 'nieuw'
     and old.user_id = public.my_id()
     and new.van is not distinct from old.van
     and new.tot is not distinct from old.tot
  then
    return new;
  end if;

  raise exception 'Over je eigen urenverzoek beslist je leidinggevende';
end;
$$;

drop trigger if exists hr_bewaak on public.hour_requests;
create trigger hr_bewaak before update on public.hour_requests
  for each row execute function public.hr_bewaak_wijziging();

drop policy if exists hr_delete on public.hour_requests;
create policy hr_delete on public.hour_requests for delete to authenticated
  using (public.is_management());

/* --- ritten --- */

drop policy if exists trips_select on public.trips;
create policy trips_select on public.trips for select to authenticated
  using (user_id = public.my_id() or public.is_lead());

drop policy if exists trips_insert on public.trips;
create policy trips_insert on public.trips for insert to authenticated
  with check (
    public.rij_bestaat('public.trips'::regclass, id)
    or (public.is_staff() and user_id = public.my_id())
  );

drop policy if exists trips_update on public.trips;
create policy trips_update on public.trips for update to authenticated
  using (public.is_lead() or (user_id = public.my_id() and status = 'nieuw'))
  with check (public.is_lead() or (user_id = public.my_id() and status = 'nieuw'));

drop policy if exists trips_delete on public.trips;
create policy trips_delete on public.trips for delete to authenticated
  using (public.is_lead() or (user_id = public.my_id() and status = 'nieuw'));

/* --- het routegeheugen --- */

drop policy if exists route_select on public.route_cache;
create policy route_select on public.route_cache for select to authenticated
  using (public.is_staff());

-- Schrijven doet de serverfunctie met de servicesleutel. Zou de app hier
-- mogen schrijven, dan kon iedereen zijn eigen afstand "onthouden".
drop policy if exists route_write on public.route_cache;
create policy route_write on public.route_cache for all to authenticated
  using (false) with check (false);

-- ===========================================================================
--  De kluis, en het koppelen van een kassa
--
--  Twee dingen die bij elkaar horen, want ze gaan over hetzelfde: wie mag er
--  aan het geld, en welk apparaat mag er meepraten.
--
--  ------------------------------------------------------------------------
--  1. De kluis
--  ------------------------------------------------------------------------
--
--  Naast de lade van de kassa staat er op elke vestiging een kluis. Daar gaat
--  de omzet in die niet in de lade hoort, en daar komt het wisselgeld uit.
--  Tot nu toe was dat een boek op de balie; hier wordt het een administratie.
--
--  De keuze die alles verklaart: er worden briefjes en munten geteld, geen
--  bedragen ingetikt.
--
--  Bij een kluis werkt dat namelijk anders dan bij een bon. Wie 340 euro
--  afstort, legt drie briefjes van honderd, twee van twintig en dat kleine
--  beetje neer -- en juist bij dat laatste gaat het mis. Iemand tikt 340 in
--  terwijl er 240 ligt, en dat verschil komt drie weken later boven water,
--  als niemand meer weet wie er die dag stond. Dus slaan we op wat er
--  fysiek bewoog, en rekent de database het bedrag daaruit uit.
--
--   * pos_safes        de kluis, één per vestiging
--   * pos_safe_moves   elke beweging, met de briefjes en munten erbij
--
--  Het saldo is geen kolom maar een som -- net als bij een strippenkaart, en
--  om dezelfde reden: twee mensen die tegelijk offline iets uit de kluis
--  halen zouden elkaars saldo overschrijven.
--
--  Een telling is het enige dat het saldo hard zet. Wat er geteld is staat
--  erin, samen met wat er verwacht werd en het verschil. Dat verschil wordt
--  bewaard zoals het die avond is vastgesteld en nooit stilletjes
--  weggerekend.
--
--  ------------------------------------------------------------------------
--  2. Een kassa koppelen
--  ------------------------------------------------------------------------
--
--  Tot nu toe richtte je een kassa in door er met een account op in te
--  loggen en zelf een kassa aan te maken. Dat werkt, maar het betekent dat
--  op elke tablet achter de balie iemands wachtwoord staat, en dat het
--  kantoor niet weet welke apparaten er meedoen.
--
--  Nu gaat het andersom. Het kantoor maakt de kassa aan en zet er een code
--  bij die één keer geldig is. Die code wordt op de kassa ingetoetst, en de
--  serverfunctie kassa-koppelen geeft dat apparaat zijn eigen inlog. Zo
--  hoort er bij elk apparaat een naam in een lijst, en kan het kantoor er
--  van een afstand de stekker uit trekken.
--
--   * pos_pairings     de eenmalige codes
--   * pos_devices      welk apparaat op welke kassa staat, en of het nog mag
--
--  Waarom "eruit gooien" twee stappen is: op een kassa kan omzet staan die
--  nog niet verstuurd is. Trek je de inlog er direct onderuit, dan komt die
--  omzet nergens meer aan. Dus zet het kantoor het apparaat op
--  'ingetrokken'; de kassa ziet dat, stuurt eerst zijn wachtrij leeg, wist
--  zichzelf en meldt dat terug met wiped_at. Daarna kan het account weg.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De kluis
-- ---------------------------------------------------------------------------

create table if not exists public.pos_safes (
  id          text primary key,
  location_id text references public.locations(id) on delete cascade,
  name        text not null default 'Kluis',
  active      boolean not null default true,
  note        text,
  updated_at  bigint not null default public.now_ms()
);

-- Eén kluis per vestiging. Twee zou betekenen dat het geld in de ene of in
-- de andere kan zitten, en dan telt niemand meer iets.
create unique index if not exists pos_safes_location_key
  on public.pos_safes (location_id);

/*
 * Elke vestiging krijgt zijn kluis, ook de vestigingen die er al zijn.
 *
 * Dit gebeurt hier en niet in de app, om een simpele reden: de kassa mag
 * geen kluizen aanmaken. Zou hij dat wel mogen, dan maakt een apparaat met
 * een verkeerd ingestelde vestiging een tweede kluis aan, en verdwijnt het
 * geld in een administratie die niemand bekijkt.
 */
insert into public.pos_safes (id, location_id, name)
select 'kluis_' || l.id, l.id, 'Kluis ' || l.name
  from public.locations l
 where not exists (select 1 from public.pos_safes s where s.location_id = l.id)
on conflict do nothing;

create or replace function public.pos_kluis_bij_vestiging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.pos_safes (id, location_id, name)
  values ('kluis_' || new.id, new.id, 'Kluis ' || new.name)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists locations_kluis on public.locations;
create trigger locations_kluis after insert on public.locations
  for each row execute function public.pos_kluis_bij_vestiging();

-- ---------------------------------------------------------------------------
--  Bewegingen in de kluis
--
--  De richting zit in `soort` en niet in het teken van het bedrag. Dat is
--  met opzet: een min die je zelf moet intikken is een min die iemand ooit
--  vergeet. Wat erin gaat is een afstorting, wisselgeld of een inleg; wat
--  eruit gaat gaat naar de bank, naar de lade of naar een uitgave.
--
--  `coins` is altijd een positief aantal per soort briefje of munt:
--  {"b100": 3, "b20": 2, "m50": 1}. De sleutels zijn b<euro> voor briefjes
--  en m<cent> voor munten -- b5 is dus het briefje van vijf, m5 de munt van
--  vijf cent.
-- ---------------------------------------------------------------------------

create table if not exists public.pos_safe_moves (
  id           text primary key,
  safe_id      text not null references public.pos_safes(id) on delete cascade,
  location_id  text references public.locations(id) on delete set null,
  soort        text not null default 'inleg'
               check (soort in ('afstorting','wisselgeld','naar-bank',
                                'van-bank','uitgave','inleg','telling')),
  -- Wat er fysiek bewoog. Bij een telling leeg; daar staat het in counted.
  coins        jsonb not null default '{}'::jsonb,
  -- Alleen bij een telling: de volledige samenstelling zoals geteld. Dit is
  -- het enige dat het saldo hard zet.
  counted      jsonb,
  -- Het bedrag met teken, afgeleid uit coins en soort en hier vastgelegd.
  -- Vastgelegd en niet berekend bij het opvragen: als er later een beweging
  -- bijkomt die nog in een wachtrij stond, moet je kunnen zien wat het die
  -- dag was.
  amount       numeric not null default 0,
  -- Alleen bij een telling.
  expected     numeric,
  difference   numeric,
  -- Waar het vandaan kwam of naartoe ging, als dat de kassalade was.
  session_id   text references public.pos_cash_sessions(id) on delete set null,
  register_id  text references public.pos_registers(id) on delete set null,
  reason       text not null default '',
  user_id      text references public.profiles(id) on delete set null,
  user_name    text not null default '',
  at           bigint not null default public.now_ms(),
  updated_at   bigint not null default public.now_ms()
);

create index if not exists pos_safe_moves_safe_idx    on public.pos_safe_moves (safe_id, at);
create index if not exists pos_safe_moves_session_idx on public.pos_safe_moves (session_id);
create index if not exists pos_safe_moves_updated_idx on public.pos_safe_moves (updated_at);

-- ---------------------------------------------------------------------------
--  Een beweging in de kluis staat vast
--
--  Om dezelfde reden als bij een afgerekende bon: een kasadministratie die je
--  achteraf kunt bijschaven is geen administratie. Een vergissing corrigeer
--  je met een tegenboeking of met een telling, niet met de gum.
--
--  Opnieuw versturen mag wél. Een kassa die zijn wachtrij twee keer
--  aanbiedt, biedt dezelfde waarden aan; `is distinct from` laat dat door.
-- ---------------------------------------------------------------------------

create or replace function public.pos_kluis_vastzetten()
returns trigger language plpgsql as $$
begin
  if new.soort    is distinct from old.soort
  or new.coins    is distinct from old.coins
  or new.counted  is distinct from old.counted
  or new.amount   is distinct from old.amount
  or new.safe_id  is distinct from old.safe_id
  or new.at       is distinct from old.at
  or new.user_id  is distinct from old.user_id
  then
    raise exception 'Deze kluisboeking staat vast. Zet een tegenboeking of een telling tegenover een vergissing.';
  end if;
  return new;
end;
$$;

drop trigger if exists pos_safe_moves_vast on public.pos_safe_moves;
create trigger pos_safe_moves_vast before update on public.pos_safe_moves
  for each row execute function public.pos_kluis_vastzetten();

create or replace function public.pos_kluis_niet_wissen()
returns trigger language plpgsql as $$
begin
  raise exception 'Een kluisboeking mag niet verwijderd worden. Zet er een tegenboeking tegenover; dan blijft te zien wat er gebeurd is.';
end;
$$;

drop trigger if exists pos_safe_moves_niet_wissen on public.pos_safe_moves;
create trigger pos_safe_moves_niet_wissen before delete on public.pos_safe_moves
  for each row execute function public.pos_kluis_niet_wissen();

/**
 * Wat één briefje of munt waard is, uit zijn sleutel.
 *
 * b100 -> 100.00, m50 -> 0.50. Een onbekende sleutel is nul en geen fout:
 * komt er ooit een nieuwe munt bij, dan moet een oude telling nog leesbaar
 * zijn in plaats van de hele functie te laten omvallen.
 */
create or replace function public.pos_munt_waarde(sleutel text)
returns numeric language sql immutable as $$
  select case
    when sleutel ~ '^b[0-9]+$' then substring(sleutel from 2)::numeric
    when sleutel ~ '^m[0-9]+$' then substring(sleutel from 2)::numeric / 100
    else 0
  end;
$$;

grant execute on function public.pos_munt_waarde(text) to authenticated;

-- ---------------------------------------------------------------------------
--  Wat er in de kluis zit
--
--  Voor het dashboard, dat niet de hele geschiedenis van een kluis wil
--  ophalen om één getal te laten zien. De kassa rekent hetzelfde uit in
--  src/lib/kluis.ts, en die moet het offline kunnen -- vandaar dat het op
--  twee plekken staat. De regel is dezelfde: vanaf de laatste telling
--  optellen, en zonder telling vanaf nul.
--
--  Waarom er op (at, id) gesorteerd wordt en niet alleen op at: twee boekingen
--  kunnen in dezelfde milliseconde vallen. Stond hier alleen `at > telling.at`,
--  dan viel een boeking van hetzelfde moment als de telling uit het saldo --
--  geen fout, alleen een bedrag dat niet klopt. Het id erbij maakt de volgorde
--  overal dezelfde. Willekeurig, maar overal op dezelfde manier willekeurig, en
--  dat is precies wat hier nodig is.
-- ---------------------------------------------------------------------------

create or replace function public.pos_kluis_saldo(kluis text)
returns numeric language sql stable security definer set search_path = public as $$
  with laatste as (
    -- Op tijd én id, want twee boekingen kunnen in dezelfde milliseconde
    -- vallen. Zie de kanttekening hieronder.
    select at, id,
           coalesce((select sum((value)::numeric * public.pos_munt_waarde(key))
                       from jsonb_each_text(m.counted)), 0) as basis
      from public.pos_safe_moves m
     where m.safe_id = kluis and m.soort = 'telling' and m.counted is not null
     order by m.at desc, m.id desc
     limit 1
  )
  select coalesce((select basis from laatste), 0)
       + coalesce((
           select sum(m.amount) from public.pos_safe_moves m
            where m.safe_id = kluis
              and m.soort <> 'telling'
              and (
                not exists (select 1 from laatste)
                or (m.at, m.id) > (select at, id from laatste)
              )
         ), 0);
$$;

grant execute on function public.pos_kluis_saldo(text) to authenticated;

-- ---------------------------------------------------------------------------
--  Eenmalige codes om een kassa te koppelen
--
--  De code staat leesbaar in de tabel, en dat hoort ook: iemand van het
--  kantoor leest hem van zijn scherm en tikt hem op de kassa in. Wat hem
--  veilig maakt is niet dat hij geheim is opgeslagen maar dat hij één keer
--  werkt en verloopt -- en dat alleen wie kassa's mag beheren hem kan zien.
-- ---------------------------------------------------------------------------

create table if not exists public.pos_pairings (
  id              text primary key,
  code            text not null,
  location_id     text not null references public.locations(id) on delete cascade,
  -- Voor welke kassa. Het kantoor maakt de kassa aan en dan de code; zo weet
  -- het apparaat meteen welke code op zijn bonnen komt.
  register_id     text references public.pos_registers(id) on delete cascade,
  created_by      text references public.profiles(id) on delete set null,
  created_by_name text not null default '',
  expires_at      bigint not null,
  used_at         bigint,
  used_by_device  text,
  note            text,
  updated_at      bigint not null default public.now_ms()
);

create unique index if not exists pos_pairings_code_key on public.pos_pairings (code);
create index if not exists pos_pairings_location_idx on public.pos_pairings (location_id);

-- ---------------------------------------------------------------------------
--  De apparaten
--
--  Elk apparaat heeft zijn eigen inlog. Niet het account van een medewerker:
--  dan staat er een wachtwoord van een mens op een tablet achter de balie,
--  en verliest die mens zijn toegang als het apparaat wordt geblokkeerd.
--
--  status:
--    actief        doet mee
--    geblokkeerd   tijdelijk uit; de kassa gaat op slot maar blijft zijn
--                  wachtrij versturen. Precies wat je wil als een tablet
--                  kwijt is en de omzet er nog op staat.
--    ingetrokken   eruit. De kassa stuurt zijn wachtrij leeg, wist zichzelf
--                  en zet wiped_at. Daarna mag het account weg.
-- ---------------------------------------------------------------------------

create table if not exists public.pos_devices (
  id           text primary key,
  register_id  text references public.pos_registers(id) on delete cascade,
  location_id  text references public.locations(id) on delete set null,
  -- Wat het apparaat van zichzelf weet. Blijft staan als de app opnieuw
  -- wordt geïnstalleerd, zodat hetzelfde apparaat niet twee keer in de
  -- lijst komt.
  device_key   text not null default '',
  name         text not null default '',
  platform     text not null default '',
  app_version  text,
  -- Het inlogaccount dat bij dit apparaat hoort.
  auth_user_id uuid,
  profile_id   text references public.profiles(id) on delete set null,
  status       text not null default 'actief'
               check (status in ('actief','geblokkeerd','ingetrokken')),
  paired_at    bigint not null default public.now_ms(),
  last_seen_at bigint,
  wiped_at     bigint,
  note         text,
  updated_at   bigint not null default public.now_ms()
);

/*
 * Eén apparaat per kassa.
 *
 * Twee apparaten op dezelfde kassa geven dezelfde bonnummers, en dan blijft
 * de tweede bon in de wachtrij hangen met een fout over een dubbele sleutel.
 * De app waarschuwde daarvoor; nu houdt de database het tegen. Een
 * ingetrokken apparaat telt niet mee -- de opvolger moet erin kunnen.
 */
create unique index if not exists pos_devices_register_key
  on public.pos_devices (register_id)
  where status in ('actief','geblokkeerd');

create index if not exists pos_devices_location_idx on public.pos_devices (location_id);
create index if not exists pos_devices_updated_idx  on public.pos_devices (updated_at);

-- ---------------------------------------------------------------------------
--  Een apparaat is geen medewerker
--
--  Het inlogaccount van een kassa heeft een personeelsdossier nodig, want
--  daar hangt alles aan: welke vestiging, en dus welke gegevens het apparaat
--  mag zien. Maar het is geen mens. Zonder dit vlaggetje staat "Kassa
--  KAS-UTR-1" tussen het personeel in het rooster, in de urenstaat en in de
--  lijst waaruit je aan de kassa iemand kiest.
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists is_device boolean not null default false;

create index if not exists profiles_is_device_idx on public.profiles (is_device);

-- ---------------------------------------------------------------------------
--  Het bonnummer komt van de kassa, de bovengrens van de server
--
--  De kassa nummert zijn bonnen zelf door, op het apparaat, zodat het ook
--  zonder internet doorloopt. last_seq is de hoogste die de server gezien
--  heeft; een opnieuw ingericht apparaat telt daar vanaf verder.
--
--  Dat getal stuurde de kassa eerst zelf mee. Dat kan niet meer: een
--  apparaataccount mag geen kassa's wijzigen -- en dat is goed, want dan kan
--  een apparaat ook zijn eigen instellingen niet omzetten. Dus rekent de
--  server het uit op het moment dat er een bon binnenkomt. Dat is
--  bovendien betrouwbaarder: het volgt de bonnen die er echt zijn.
-- ---------------------------------------------------------------------------

create or replace function public.pos_seq_bijwerken()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.register_id is not null and new.seq is not null then
    update public.pos_registers
       set last_seq = greatest(last_seq, new.seq)
     where id = new.register_id and last_seq < new.seq;
  end if;
  return new;
end;
$$;

drop trigger if exists pos_sales_seq on public.pos_sales;
create trigger pos_sales_seq after insert on public.pos_sales
  for each row execute function public.pos_seq_bijwerken();

-- ---------------------------------------------------------------------------
--  Tijdstempels
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'pos_safes','pos_safe_moves','pos_pairings','pos_devices'
  ] loop
    execute format('drop trigger if exists stamp_%1$s on public.%1$I', t);
    execute format(
      'create trigger stamp_%1$s before insert or update on public.%1$I
       for each row execute function public.stamp_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
--  Beveiliging op rijniveau
--
--  Dezelfde verdeling als bij de rest van de kassa: wie op een vestiging
--  werkt mag de kluis van die vestiging zien en erin boeken; de app bepaalt
--  wie er daadwerkelijk bij mag met het recht pos.safe. Dat de app dat doet
--  en niet de database heeft een reden: de rollen staan in permissions.ts en
--  die kan de database niet narekenen.
--
--  Wat de database wél hard afdwingt, en dat is het belangrijkste:
--  boekingen kunnen niet meer gewijzigd of gewist worden.
-- ---------------------------------------------------------------------------

alter table public.pos_safes      enable row level security;
alter table public.pos_safe_moves enable row level security;
alter table public.pos_pairings   enable row level security;
alter table public.pos_devices    enable row level security;

-- ------------------------------- de kluis ---------------------------------

drop policy if exists pos_safes_select on public.pos_safes;
create policy pos_safes_select on public.pos_safes for select to authenticated
  using (public.is_staff() and public.in_my_locations(location_id));

-- Aanmaken en omzetten doet het kantoor. De kassa leest alleen.
drop policy if exists pos_safes_write on public.pos_safes;
create policy pos_safes_write on public.pos_safes for all to authenticated
  using (public.mag_kassa_beheren() and public.in_my_locations(location_id))
  with check (public.mag_kassa_beheren() and public.in_my_locations(location_id));

drop policy if exists pos_safe_moves_select on public.pos_safe_moves;
create policy pos_safe_moves_select on public.pos_safe_moves for select to authenticated
  using (public.is_staff() and public.in_my_locations(location_id));

drop policy if exists pos_safe_moves_insert on public.pos_safe_moves;
create policy pos_safe_moves_insert on public.pos_safe_moves for insert to authenticated
  with check (public.is_staff() and public.in_my_locations(location_id));

-- Wijzigen mag; de trigger hierboven bepaalt dat er niets te wijzigen valt
-- behalve de toelichting. Zonder deze regel zou een kassa die zijn wachtrij
-- opnieuw aanbiedt vastlopen op een rij die er al staat.
drop policy if exists pos_safe_moves_update on public.pos_safe_moves;
create policy pos_safe_moves_update on public.pos_safe_moves for update to authenticated
  using (public.is_staff() and public.in_my_locations(location_id))
  with check (public.is_staff() and public.in_my_locations(location_id));

-- ------------------------------- de codes ---------------------------------

-- Een koppelcode is een sleutel tot de gegevens van een vestiging. Alleen
-- wie kassa's beheert ziet hem, en niemand anders -- ook geen collega op
-- dezelfde vestiging.
drop policy if exists pos_pairings_all on public.pos_pairings;
create policy pos_pairings_all on public.pos_pairings for all to authenticated
  using (public.mag_kassa_beheren() and public.in_my_locations(location_id))
  with check (public.mag_kassa_beheren() and public.in_my_locations(location_id));

-- --------------------- de kassa mag zijn eigen instelling ------------------

/*
 * Een apparaat mag van zijn eigen kassa de printer en de pinautomaat zetten.
 *
 * Dat hoort namelijk bij het apparaat en niet bij het kantoor: welke bonprinter
 * er aan deze balie hangt, weet degene die ervoor staat. Zonder deze regel is
 * de enige manier om dat in te stellen een account met kassabeheer -- en dan
 * kan datzelfde apparaat ook aan de prijzen.
 *
 * Wat er niet bij hoort: de code, de naam, de vestiging en het aan-uitvinkje.
 * Daar zit de rem eronder voor.
 */
drop policy if exists pos_registers_eigen on public.pos_registers;
create policy pos_registers_eigen on public.pos_registers for update to authenticated
  using (exists (
    select 1 from public.pos_devices d
     where d.register_id = pos_registers.id
       and d.auth_user_id = auth.uid()
       and d.status = 'actief'))
  with check (exists (
    select 1 from public.pos_devices d
     where d.register_id = pos_registers.id
       and d.auth_user_id = auth.uid()
       and d.status = 'actief'));

create or replace function public.pos_kassa_eigen_instelling()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  /*
   * Het bonnummer gaat nooit achteruit -- voor niemand, ook niet voor het
   * kantoor.
   *
   * last_seq is een hoogwatermerk: de hoogste bon die de server gezien heeft.
   * Een kassa stuurt bij het opslaan van zijn printerinstelling de hele regel
   * mee, inclusief het nummer dat híj kende. Is dat een oud nummer -- omdat er
   * inmiddels bonnen van een ander apparaat binnenkwamen -- dan zou de
   * bovengrens zakken, en begint een volgend apparaat opnieuw te tellen bij
   * een nummer dat al bestaat. Dan blijven bonnen in de wachtrij hangen op een
   * dubbele sleutel, en dat is precies de fout die nergens hardop klinkt.
   */
  if new.last_seq < old.last_seq then
    new.last_seq := old.last_seq;
  end if;

  if public.mag_kassa_beheren() then return new; end if;

  -- Gaat dit niet over het apparaat zelf, dan bepaalt de regel erboven al of
  -- het mag; hier valt niets te knijpen.
  if auth.uid() is null
  or not exists (select 1 from public.pos_devices d
                  where d.register_id = old.id and d.auth_user_id = auth.uid())
  then
    return new;
  end if;

  if new.code        is distinct from old.code
  or new.name        is distinct from old.name
  or new.location_id is distinct from old.location_id
  or new.active      is distinct from old.active
  then
    raise exception 'Een kassa mag van zichzelf alleen de printer en de pinautomaat zetten. De code, de naam en de vestiging komen uit het dashboard.';
  end if;
  return new;
end;
$$;

drop trigger if exists pos_registers_eigen_instelling on public.pos_registers;
create trigger pos_registers_eigen_instelling before update on public.pos_registers
  for each row execute function public.pos_kassa_eigen_instelling();

-- ----------------------------- de apparaten -------------------------------

drop policy if exists pos_devices_select on public.pos_devices;
create policy pos_devices_select on public.pos_devices for select to authenticated
  using (public.is_staff() and public.in_my_locations(location_id));

drop policy if exists pos_devices_write on public.pos_devices;
create policy pos_devices_write on public.pos_devices for all to authenticated
  using (public.mag_kassa_beheren() and public.in_my_locations(location_id))
  with check (public.mag_kassa_beheren() and public.in_my_locations(location_id));

/*
 * Een apparaat mag van zijn eigen regel bijhouden dat hij er nog is, en
 * melden dat hij zichzelf gewist heeft. Niets anders -- de trigger eronder
 * houdt de rest tegen.
 *
 * Dat laatste is wat "op afstand eruit gooien" werkend maakt: het kantoor
 * zet de status op ingetrokken, de kassa stuurt zijn wachtrij leeg en zet
 * wiped_at. Pas dan mag het account weg, want anders zou de omzet die nog
 * op dat apparaat stond nergens meer aankomen.
 */
drop policy if exists pos_devices_eigen on public.pos_devices;
create policy pos_devices_eigen on public.pos_devices for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

create or replace function public.pos_apparaat_eigen_regel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  /*
   * Deze rem geldt alleen voor het apparaat zelf.
   *
   * Eerst stond hier "wie geen kassa's beheert mag niets", en dat leek
   * hetzelfde. Het was het niet: bij een serverfunctie en bij een migratie is
   * auth.uid() leeg, dus mag_kassa_beheren() is dan onwaar -- en dan hield
   * deze trigger juist de kant tegen die er wel over gaat. Op afstand
   * intrekken werkte daardoor niet.
   *
   * Wie überhaupt aan deze tabel mag komen, bepalen de regels erboven. Hier
   * gaat het alleen om wat een apparaat aan zijn eigen regel mag veranderen.
   */
  if old.auth_user_id is null
  or auth.uid() is null
  or old.auth_user_id <> auth.uid()
  or public.mag_kassa_beheren()
  then
    return new;
  end if;

  if new.register_id  is distinct from old.register_id
  or new.location_id  is distinct from old.location_id
  or new.status       is distinct from old.status
  or new.auth_user_id is distinct from old.auth_user_id
  or new.profile_id   is distinct from old.profile_id
  or new.device_key   is distinct from old.device_key
  then
    raise exception 'Een kassa mag van zijn eigen regel alleen bijhouden dat hij er nog is. Blokkeren en intrekken gebeurt in het dashboard.';
  end if;
  return new;
end;
$$;

drop trigger if exists pos_devices_eigen_regel on public.pos_devices;
create trigger pos_devices_eigen_regel before update on public.pos_devices
  for each row execute function public.pos_apparaat_eigen_regel();

-- ===========================================================================
--  De vestigingen zelf beheren
--
--  De vestigingen stonden er wel, maar er was geen enkele manier om er een
--  bij te maken, er een te wijzigen of er een weg te halen. Ze kwamen uit de
--  eerste vulling en daar bleef het bij.
--
--  Drie dingen gebeuren hier:
--
--    1. de vestiging krijgt de gegevens die je van een vestiging wil hebben:
--       e-mailadres, openingstijden, een notitie, en de coordinaten die bij
--       het adres horen
--    2. er komen foto's bij, in een eigen emmer
--    3. wissen wordt afgeschermd -- en dat is het belangrijkste stuk
--
--  Waarom dat derde. Op locations hangen tweeentwintig verwijzingen, en een
--  flink deel daarvan staat op "on delete cascade": installaties, storingen,
--  werkbonnen, onderhoudsschema's, voorraad, overlegkanalen en de kluis.
--  Een vestiging wissen zou die allemaal meenemen zonder een woord. De rest
--  staat op "set null", wat net zo stil is: negentien mensen die opeens geen
--  vestiging meer hebben.
--
--  Dus: de database weigert het, en zegt erbij wat eraan hangt.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De vestiging zelf
-- ---------------------------------------------------------------------------

alter table public.locations add column if not exists email         text;
alter table public.locations add column if not exists notes         text;

-- Wat de kaartendienst van het adres maakte. geo_label is wat er gevonden is,
-- en dat is met opzet apart van wat er is ingetikt: als die twee uit elkaar
-- lopen wil je dat zien en niet dat de app je adres stilletjes herschrijft.
alter table public.locations add column if not exists lat           double precision;
alter table public.locations add column if not exists lon           double precision;
alter table public.locations add column if not exists geo_label     text;
alter table public.locations add column if not exists geo_at        bigint;

-- {"ma":{"van":"07:00","tot":"18:00"}, "zo":null, ...}  null = dicht
alter table public.locations add column if not exists opening_hours jsonb
  not null default '{}'::jsonb;

-- Waarom een vestiging uit staat. Zonder reden is "actief = false" over een
-- half jaar een raadsel.
alter table public.locations add column if not exists inactive_reason text;
alter table public.locations add column if not exists inactive_at     bigint;

-- ---------------------------------------------------------------------------
--  Wie mag dit?
--
--  Tot nu toe alleen het management. Het recht locations.manage bestond al in
--  de app maar de database keek er niet naar, dus uitdelen had geen effect.
-- ---------------------------------------------------------------------------

create or replace function public.mag_vestigingen_beheren()
returns boolean language sql stable as $$
  select public.is_management() or public.heeft_recht('locations.manage');
$$;

grant execute on function public.mag_vestigingen_beheren() to authenticated;

drop policy if exists locations_write on public.locations;
create policy locations_write on public.locations for all to authenticated
  using (public.mag_vestigingen_beheren())
  with check (public.mag_vestigingen_beheren());

-- ---------------------------------------------------------------------------
--  Foto's
--
--  Een eigen tabel en niet een kolom op locations. Er zijn er meer dan een,
--  ze hebben een volgorde en een bijschrift, en een rij met een lijst erin is
--  een rij die je bij elke wijziging in zijn geheel moet overschrijven.
-- ---------------------------------------------------------------------------

create table if not exists public.location_photos (
  id               text primary key,
  location_id      text not null references public.locations(id) on delete cascade,
  storage_path     text not null,
  mime             text not null,
  size_bytes       integer not null default 0,
  width            integer,
  height           integer,
  caption          text,
  sort             integer not null default 0,
  is_cover         boolean not null default false,
  uploaded_by      text,
  uploaded_by_name text,
  uploaded_at      bigint not null default public.now_ms(),
  updated_at       bigint not null default public.now_ms()
);

create index if not exists location_photos_loc_idx
  on public.location_photos (location_id, sort);
create index if not exists location_photos_updated_idx
  on public.location_photos (updated_at);

-- Een vestiging heeft er hoogstens een die vooraan staat. Zonder deze index
-- kun je er twee aanzetten en is het maar net welke de lijst als eerste ziet.
create unique index if not exists location_photos_cover_idx
  on public.location_photos (location_id) where is_cover;

drop trigger if exists stamp_location_photos on public.location_photos;
create trigger stamp_location_photos before insert or update on public.location_photos
  for each row execute function public.stamp_updated_at();

alter table public.location_photos enable row level security;

-- Iedereen die is ingelogd mag ze zien, net als de vestigingen zelf. Het is
-- een foto van een wasstraat langs de snelweg; die staat ook op de website.
drop policy if exists location_photos_select on public.location_photos;
create policy location_photos_select on public.location_photos for select to authenticated
  using (true);

drop policy if exists location_photos_write on public.location_photos;
create policy location_photos_write on public.location_photos for all to authenticated
  using (public.mag_vestigingen_beheren())
  with check (public.mag_vestigingen_beheren());

-- ---------------------------------------------------------------------------
--  De emmer
--
--  Openbaar leesbaar, anders dan de dossiers. Dat is een keuze en geen
--  slordigheid: een foto van een vestiging is geen geheim, en negentien
--  ondertekende adressen ophalen bij elke keer dat het scherm opengaat maakt
--  de lijst traag en offline leeg.
--
--  Schrijven mag alleen wie vestigingen beheert. Openbaar lezen is niet
--  hetzelfde als openbaar volzetten.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vestigingen', 'vestigingen', true, 10485760,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
  set public = true,
      file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists vestigingen_lezen on storage.objects;
create policy vestigingen_lezen on storage.objects for select to authenticated
  using (bucket_id = 'vestigingen');

drop policy if exists vestigingen_schrijven on storage.objects;
create policy vestigingen_schrijven on storage.objects for insert to authenticated
  with check (bucket_id = 'vestigingen' and public.mag_vestigingen_beheren());

drop policy if exists vestigingen_bijwerken on storage.objects;
create policy vestigingen_bijwerken on storage.objects for update to authenticated
  using (bucket_id = 'vestigingen' and public.mag_vestigingen_beheren())
  with check (bucket_id = 'vestigingen' and public.mag_vestigingen_beheren());

drop policy if exists vestigingen_wissen on storage.objects;
create policy vestigingen_wissen on storage.objects for delete to authenticated
  using (bucket_id = 'vestigingen' and public.mag_vestigingen_beheren());

-- ---------------------------------------------------------------------------
--  Wat hangt er aan deze vestiging?
--
--  Geeft per soort terug hoeveel er zijn. Het scherm gebruikt dit om te
--  vertellen waarom wissen niet kan; de trigger hieronder gebruikt hetzelfde
--  antwoord om het ook echt tegen te houden. Een van de twee zou niet genoeg
--  zijn: een scherm is te omzeilen en een trigger legt niets uit.
-- ---------------------------------------------------------------------------

create or replace function public.vestiging_bezet(loc text)
returns table (wat text, aantal bigint)
language sql stable security definer set search_path = public as $$
  select 'medewerkers'::text, count(*) from public.profiles
   where location_id = loc or loc = any(coalesce(manages, array[]::text[]))
  union all select 'wasbeurten',   count(*) from public.wash_jobs        where location_id = loc
  union all select 'diensten',     count(*) from public.shifts           where location_id = loc
  union all select 'urenregels',   count(*) from public.time_entries     where location_id = loc
  union all select 'installaties', count(*) from public.assets           where location_id = loc
  union all select 'storingen',    count(*) from public.faults           where location_id = loc
  union all select 'werkbonnen',   count(*) from public.work_orders      where location_id = loc
  union all select 'onderhoud',    count(*) from public.maintenance_plans where location_id = loc
  union all select 'voorraad',     count(*) from public.inventory_items  where location_id = loc
  union all select 'kassa''s',     count(*) from public.pos_registers    where location_id = loc
  union all select 'kluisboekingen', count(*) from public.pos_safe_moves where location_id = loc
  union all select 'overlegkanalen', count(*) from public.channels       where location_id = loc
$$;

grant execute on function public.vestiging_bezet(text) to authenticated;

create or replace function public.vestiging_bewaak_wissen()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  bezet text;
begin
  select string_agg(wat || ': ' || aantal, ', ' order by aantal desc)
    into bezet
    from public.vestiging_bezet(old.id)
   where aantal > 0;

  if bezet is not null then
    raise exception
      'Deze vestiging kan niet weg, er hangt nog van alles aan (%). Zet hem uit in plaats van hem te wissen.',
      bezet
      using errcode = 'foreign_key_violation';
  end if;

  return old;
end;
$$;

drop trigger if exists vestiging_wissen on public.locations;
create trigger vestiging_wissen before delete on public.locations
  for each row execute function public.vestiging_bewaak_wissen();

-- ---------------------------------------------------------------------------
--  Een nieuwe vestiging krijgt een kluis
--
--  0025 gaf elke bestaande vestiging er een. Wie er daarna een aanmaakt hoort
--  er ook een te krijgen, anders staat er bij de eerste afstorting op de
--  kassa geen kluis om in te boeken.
--
--  Het aanmaken gebeurt hier en niet in de app: de app die de vestiging maakt
--  is niet altijd dezelfde als de app die de kassa neerzet.
-- ---------------------------------------------------------------------------

create or replace function public.vestiging_krijgt_kluis()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.pos_safes (id, location_id, name)
  values ('kluis_' || new.id, new.id, 'Kluis ' || new.name)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists vestiging_kluis on public.locations;
create trigger vestiging_kluis after insert on public.locations
  for each row execute function public.vestiging_krijgt_kluis();

-- ===========================================================================
--  Een foto bij het artikel
--
--  Aan een balie zoek je niet op naam maar op hoe iets eruitziet. Twee flessen
--  ruitenwisservloeistof van hetzelfde merk verschillen in de winter en de
--  zomer een letter in de naam en een kleur op het etiket; wie er de hele dag
--  staat kiest op die kleur, niet op die letter.
--
--  Waarom de foto in de rij staat en niet in een bucket
--  ---------------------------------------------------
--
--  Supabase heeft opslag voor bestanden, en dat is de gewone plek voor een
--  plaatje. Hier niet, om één reden: de kassa moet het zonder internet doen.
--  Een foto achter een URL is een foto die er niet is als de lijn eruit ligt --
--  en dan staat er op het kassascherm een rij grijze vlakken op precies het
--  moment dat het rustig moet blijven werken.
--
--  Een foto in de rij komt mee met dezelfde synchronisatie als de prijs, staat
--  daarna in de lokale cache van elk apparaat, en werkt dus altijd. De prijs
--  daarvan is grootte, en die houden we klein: de kassa verkleint elke foto
--  vóór het opslaan tot een paar tienden van een kilobyte. Zie
--  src/lib/afbeelding.ts in de kassa-app.
--
--  De grens hieronder is de rem daaronder. Zonder die rem zet iemand ooit een
--  foto van vier megabyte in een artikel, en dan sleept elke kassa die bij
--  elke synchronisatie mee.
-- ===========================================================================

alter table public.pos_products
  add column if not exists image text;

/*
 * Een data-URI van maximaal ongeveer 150 kB.
 *
 * Ruim boven wat de kassa maakt (die mikt op 48 kB aan beeldgegevens, wat als
 * base64 zo'n 64 kB wordt), zodat een foto die elders is toegevoegd er ook
 * langs komt. En ruim onder wat een tabel met artikelen zwaar maakt.
 *
 * De controle staat er als NOT VALID: dan geldt hij voor alles wat er vanaf nu
 * in gaat, zonder dat het draaien van deze migratie op een bestaande database
 * kan struikelen over een rij die er al staat. Nieuwe rijen zijn waar het om
 * gaat -- een bestaande te grote foto is een last, geen fout.
 */
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'pos_products_image_maat'
       and conrelid = 'public.pos_products'::regclass
  ) then
    alter table public.pos_products
      add constraint pos_products_image_maat
      check (image is null or length(image) <= 150000) not valid;
  end if;
end $$;

-- ===========================================================================
--  Een kassa is geen aanmelding
--
--  Toen de eerste kassa met een koppelcode werd gekoppeld, stond hij daarna in
--  het dashboard onder Aanmeldingen -- met een melding aan het management erbij
--  dat er iemand nieuw was. Dat is niet zomaar lelijk: het management moet dan
--  een beslissing nemen over een apparaat dat het zelf heeft aangezet, en een
--  lijst waar dingen in staan die niemand hoeft te beoordelen is een lijst die
--  je op een gegeven moment niet meer opent.
--
--  Waar het vandaan kwam: handle_new_user() draait bij elk nieuw inlogaccount.
--  Vindt hij geen dossier op dat e-mailadres, dan is het volgens hem een
--  aanmelding -- dossier op inactief, rij in signups, seintje naar het
--  management. Dat is precies goed voor een mens die zich meldt.
--
--  Maar de serverfunctie kassa-koppelen maakt ook een inlogaccount aan: elk
--  apparaat krijgt zijn eigen inlog, zodat er geen wachtwoord van een mens op
--  een tablet achter de balie staat. En dat account liep door dezelfde trechter.
--
--  Vanaf nu stapt de trigger daar uit. Het dossier van een apparaat wordt door
--  kassa-koppelen zelf gezet, met is_device erop, en er komt geen aanmelding en
--  geen melding bij.
--
--  Waarom het vlaggetje uit de metagegevens mag komen
--  -------------------------------------------------
--
--  In 0007 staat met nadruk dat rollen niet uit de gegevens van de client
--  worden overgenomen: die zijn niet te vertrouwen. Dat geldt hier ook, en
--  toch mag dit -- omdat deze vlag alleen maar minder kan opleveren.
--
--  Zet iemand bij het aanmelden zelf 'apparaat' in zijn metagegevens, dan
--  krijgt hij geen dossier en geen aanmelding, en dus nergens toegang: geen
--  rollen, geen vestiging, is_staff() onwaar. Hij heeft dan een inlog waarmee
--  je niets kunt. Een vlag die alleen deuren kan sluiten, hoeft niet
--  gecontroleerd te worden.
-- ===========================================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  existing_id text;
  nieuw_id    text;
  aanmelding  text;
  volle_naam  text;
  soort       text;
begin
  /*
   * Een apparaat, geen mens.
   *
   * kassa-koppelen zet in de metagegevens dat dit een kassa is, en zet daarna
   * zelf het dossier neer -- met is_device, met de vestiging en op actief. Hier
   * hoeft dus niets te gebeuren, en er hoort vooral geen aanmelding te komen.
   */
  if coalesce(new.raw_user_meta_data->>'apparaat', '') = 'true' then
    return new;
  end if;

  volle_naam := coalesce(
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    split_part(new.email, '@', 1));

  -- 1. Staat er al een dossier klaar op dit e-mailadres? Dan koppelen we dat.
  --    Het management heeft die persoon dus zelf toegevoegd; de rollen die
  --    daar staan gelden, en hij kan meteen aan de slag.
  select id into existing_id
    from public.profiles
   where lower(email) = lower(new.email)
     and auth_id is null
   limit 1;

  if existing_id is not null then
    update public.profiles set auth_id = new.id where id = existing_id;
    return new;
  end if;

  -- 2. Anders is dit een aanmelding. Het dossier komt er wel, maar zonder
  --    rollen en op inactief: een account is nog geen toegang.
  nieuw_id := 'u_' || replace(new.id::text, '-', '');

  insert into public.profiles (id, auth_id, email, name, roles, active, phone, location_id)
  values (
    nieuw_id,
    new.id,
    new.email,
    volle_naam,
    array[]::text[],
    false,
    nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data->>'location_id', '')), '')
  )
  on conflict (id) do nothing;

  soort := coalesce(new.raw_user_meta_data->>'signup_kind', 'werknemer');
  if soort not in ('werknemer', 'klant') then
    soort := 'werknemer';
  end if;

  aanmelding := 'sg_' || replace(new.id::text, '-', '');

  insert into public.signups (
    id, name, email, phone, kind, company_name, location_id, message,
    status, created_at, auth_id, profile_id)
  values (
    aanmelding,
    volle_naam,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), ''),
    soort,
    nullif(trim(coalesce(new.raw_user_meta_data->>'company_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data->>'location_id', '')), ''),
    left(coalesce(new.raw_user_meta_data->>'message', ''), 600),
    'nieuw',
    public.now_ms(),
    new.id,
    nieuw_id
  )
  on conflict (id) do nothing;

  -- 3. Het management een seintje geven, zodat de aanmelding niet weken
  --    blijft liggen omdat niemand toevallig op dat tabblad keek.
  insert into public.notifications (
    id, to_role, kind, title, body, from_user_id, from_name, created_at, link)
  values (
    'nt_' || aanmelding,
    'management',
    'taak',
    'Nieuwe aanmelding: ' || volle_naam,
    volle_naam || ' meldt zich aan als ' || soort || ' (' || new.email || ').',
    -- Bewust zonder afzender: dit bericht komt van het systeem, niet van de
    -- aanmelder. Stond zijn eigen id hier, dan zou hij zijn eigen aanmelding
    -- in zijn berichten terugzien -- de regels laten je zien wat je zelf
    -- verstuurt.
    null,
    'Aanmelding',
    public.now_ms(),
    'aanmeldingen'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
--  Opruimen wat er al ligt
--
--  De kassa's die vóór deze migratie gekoppeld zijn, staan als aanmelding in de
--  lijst. Die halen we hier weg -- en niet alleen de aanmelding zelf, ook het
--  seintje eraan, want een melding die naar een aanmelding wijst die niet meer
--  bestaat is erger dan geen melding.
--
--  Herkennen doen we ze aan het vlaggetje op het inlogaccount, en niet aan
--  is_device op het dossier. Dat laatste lijkt logischer maar werkt hier niet:
--  is_device komt er pas op als kassa-koppelen het dossier heeft bijgewerkt, en
--  bij een kassa die halverwege is blijven steken is dat juist niet gebeurd.
--  Het vlaggetje staat er vanaf het moment dat het account gemaakt is.
-- ---------------------------------------------------------------------------

create or replace function public.is_apparaataccount(wie uuid)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select coalesce(
    (select coalesce(u.raw_user_meta_data->>'apparaat', '') = 'true'
       from auth.users u where u.id = wie),
    false);
$$;

delete from public.notifications
 where id in (
   select 'nt_' || s.id from public.signups s
    where s.auth_id is not null and public.is_apparaataccount(s.auth_id)
 );

delete from public.signups s
 where s.auth_id is not null and public.is_apparaataccount(s.auth_id);

-- ---------------------------------------------------------------------------
--  Een apparaat telt niet mee als medewerker
--
--  Dit is de kant die de app niet kan afdwingen. Overal waar in het dashboard
--  mensen worden opgesomd -- personeel, rooster, urenstaat, keuzelijsten --
--  hoort is_device eruit gefilterd te worden. Dat gebeurt in de app, en dat
--  blijft zo: de database weet niet wat een lijst is.
--
--  Wat de database wél kan, is ervoor zorgen dat een apparaat nooit per
--  ongeluk als mens in beeld komt doordat iemand er rollen aan hangt. Een
--  kassa heeft precies één rol nodig -- employee, voor de leesrechten op zijn
--  vestiging -- en verder niets.
-- ---------------------------------------------------------------------------

create or replace function public.apparaat_blijft_apparaat()
returns trigger language plpgsql as $$
begin
  if new.is_device then
    if new.roles is distinct from array['employee']::text[] then
      raise exception
        'Een kassa-account houdt de rol employee en niets anders. Wil je dit een medewerker maken, haal dan eerst is_device eraf.';
    end if;
    if new.manages is not null and array_length(new.manages, 1) > 0 then
      raise exception 'Een kassa-account heeft geen leiding over vestigingen.';
    end if;
    if coalesce(new.all_locations, false) then
      raise exception 'Een kassa-account hoort bij één vestiging, niet bij alle.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_apparaat on public.profiles;
create trigger profiles_apparaat before insert or update on public.profiles
  for each row execute function public.apparaat_blijft_apparaat();

-- ===========================================================================
--  De administratie
--
--  Er is een rol bij gekomen. Wat er goedgekeurd moet worden -- kostenposten,
--  urenwijzigingen, aanpassingen in een dossier, aanmeldingen -- stond in
--  vier verschillende schermen van het managementdashboard. Wie vier lijsten
--  moet openen om te weten of hij klaar is, denkt op een gegeven moment dat
--  hij klaar is.
--
--  Deze migratie doet drie dingen:
--
--    1. de administratie telt mee als personeel (is_staff)
--    2. wie kosten mag goedkeuren, mag ze ook zien en aftekenen -- tot nu toe
--       stond daar alleen "management", en het recht expenses.approve deed
--       in de database dus niets
--    3. er komt een veld bij waar in staat wat er uit een factuur is gelezen
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De administratie is personeel
--
--  is_staff() bepaalt op tientallen plekken of je iets mag zien: het rooster,
--  de wasbeurten, de voorraad, de berichten. Iemand van de administratie is
--  gewoon iemand die hier werkt, dus die hoort erbij.
--
--  Let op wat dit niet doet: het geeft geen enkel recht om iets te wijzigen.
--  Dat staat per tabel apart geregeld, en daar staat management of een
--  specifiek recht.
-- ---------------------------------------------------------------------------

create or replace function public.is_staff()
returns boolean language sql stable as $$
  select 'employee' = any(public.my_roles())
      or 'administratie' = any(public.my_roles())
      or 'management' = any(public.my_roles());
$$;

-- ---------------------------------------------------------------------------
--  Wie mag kosten beoordelen
--
--  Het recht expenses.approve bestond al in de app, maar de database keek er
--  niet naar: daar gold alleen is_management(). Je kon het dus uitdelen zonder
--  dat er iets veranderde. Dat is het gevaarlijkste soort recht -- een dat er
--  is en niets doet.
-- ---------------------------------------------------------------------------

create or replace function public.mag_kosten_beslissen()
returns boolean language sql stable as $$
  select public.is_management() or public.heeft_recht('expenses.approve');
$$;

grant execute on function public.mag_kosten_beslissen() to authenticated;

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select to authenticated
  using (
    public.mag_kosten_beslissen()
    or submitted_by = public.my_id()
  );

/*
 * De insertregel blijft zoals 0022 hem achterliet: rij_bestaat() vooraan,
 * anders valt een bijwerkende upsert over de insertcontrole. Alleen
 * is_management() is vervangen door de nieuwe functie.
 */
drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses for insert to authenticated
  with check (
    public.rij_bestaat('public.expenses'::regclass, id)
    or public.mag_kosten_beslissen()
    or (public.is_staff() and submitted_by = public.my_id())
  );

drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses for update to authenticated
  using (
    public.mag_kosten_beslissen()
    or (submitted_by = public.my_id() and status = 'open')
  )
  with check (
    public.mag_kosten_beslissen()
    or (submitted_by = public.my_id() and status = 'open')
  );

-- ---------------------------------------------------------------------------
--  Wat er uit de factuur is gelezen
--
--  Een eigen veld, en niet in supplier / amount_excl / vat_pct. Dat is het
--  hele punt: wat de app eruit haalt is een voorstel, wat in die velden staat
--  is wat een mens heeft goedgekeurd. Landen ze op dezelfde plek, dan kun je
--  een jaar later niet meer nagaan wie wat heeft ingevuld -- en dat is
--  precies de vraag die dan gesteld wordt.
-- ---------------------------------------------------------------------------

alter table public.expenses add column if not exists gelezen jsonb;

/*
 * De uitkomst van het lezen hoort niet met de hand bijgewerkt te worden.
 * Hij komt van de serverfunctie, die met de servicesleutel werkt en dus
 * buiten deze regel valt. Wie hem in de app zou aanpassen, maakt van een
 * verslag een bewering.
 */
create or replace function public.lezing_blijft_lezing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- De serverfunctie schrijft hem; die werkt met de servicesleutel en heeft
  -- dus geen my_id(). Alleen wat uit de app komt wordt teruggezet.
  if public.my_id() is null then return new; end if;

  if new.gelezen is distinct from old.gelezen then
    new.gelezen := old.gelezen;
  end if;
  return new;
end;
$$;

drop trigger if exists expenses_lezing on public.expenses;
create trigger expenses_lezing before update on public.expenses
  for each row execute function public.lezing_blijft_lezing();

-- ---------------------------------------------------------------------------
--  Wat de administratie verder moet kunnen zien
--
--  Urenwijzigingen en dossierwijzigingen stonden op "de leidinggevende of
--  het management". De administratie beoordeelt ze ook, dus die komt erbij --
--  via het recht dat er al voor bestaat en niet via de rolnaam. Dan kun je
--  het per persoon dichtzetten zonder dat je de rol hoeft af te pakken.
-- ---------------------------------------------------------------------------

drop policy if exists hr_select on public.hour_requests;
create policy hr_select on public.hour_requests for select to authenticated
  using (
    user_id = public.my_id()
    or public.is_lead()
    or public.heeft_recht('hours.approve')
  );

drop policy if exists hr_update on public.hour_requests;
create policy hr_update on public.hour_requests for update to authenticated
  using (public.is_lead() or public.heeft_recht('hours.approve') or user_id = public.my_id())
  with check (public.is_lead() or public.heeft_recht('hours.approve') or user_id = public.my_id());

/*
 * En de wacht op die tabel moet hem ook als beslisser zien. Zonder dit stukje
 * mag de administratie het verzoek wél openen en wél opslaan, maar zet de
 * trigger de beslissing terug -- en dat is precies het soort stilte waar je
 * een middag aan kwijt bent.
 */
create or replace function public.hr_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.my_id() is null
     or public.is_lead()
     or public.heeft_recht('hours.approve')
  then
    return new;
  end if;

  -- De aanvrager mag precies één ding: zijn eigen verzoek intrekken.
  if new.status = 'ingetrokken'
     and old.status = 'nieuw'
     and old.user_id = public.my_id()
     and new.van is not distinct from old.van
     and new.tot is not distinct from old.tot
  then
    return new;
  end if;

  raise exception 'Over je eigen urenverzoek beslist je leidinggevende';
end;
$$;

-- ===========================================================================
--  Gewone facturen stonden als verdacht in de postbus
--
--  De bijlagecontrole hield een PDF tegen zodra er /OpenAction, /AA,
--  /EmbeddedFile of /RichMedia in stond. Dat leek redelijk en was het niet:
--
--    /OpenAction   staat in bijna elke PDF uit Word, InDesign of LaTeX en zet
--                  meestal alleen de beginweergave
--    /AA           hangt aan de formuliervelden van elke invulbare factuur
--    /EmbeddedFile is juist het kenmerk van een ZUGFeRD- of Factur-X-factuur:
--                  de Europese e-factuur met de gegevens als XML erin
--
--  Gevolg was dubbel. De bijlage ging op slot in het scherm, dus niemand kon
--  de factuur bekijken. En de AI las hem ook niet, want die sloeg alles over
--  wat niet 'schoon' was. Precies bij de bon die aandacht vroeg gebeurde er
--  dus niets, zonder dat iemand zag waarom.
--
--  De controle zelf is aangepast (supabase/functions/ontvang-mail/controle.ts).
--  Maar wat er al is binnengekomen draagt die uitkomst met zich mee, en dat
--  repareert zichzelf niet. Deze migratie haalt de uitkomst weg bij precies
--  die vier redenen -- niet bij alle verdachte bijlagen, want JavaScript en
--  /Launch blijven een reden om iets tegen te houden.
--
--  Zonder uitkomst geldt een bijlage als "van vóór de controle": hij gaat open
--  met een waarschuwing erbij. Dat is wat we willen -- niet stilletjes op
--  schoon zetten, want gecontroleerd is hij niet.
-- ===========================================================================

do $$
declare
  geraakt integer;
begin
  if not exists (select 1 from pg_tables
                  where schemaname = 'public' and tablename = 'mailbox') then
    return;
  end if;

  /*
   * De bijlagen staan als jsonb-array op het bericht. Uitpakken, de regels
   * bijwerken die het betreft, en weer inpakken -- met behoud van de volgorde,
   * want die bepaalt welke bijlage het scherm als eerste toont.
   */
  with geraakte as (
    select
      m.id,
      jsonb_agg(
        case
          when b.waarde ->> 'controle' = 'verdacht'
           and b.waarde ->> 'controleReden' ~ '(OpenAction|automatische actie|ingesloten bestand|ingesloten media|een actie die bij het openen afgaat)'
          then (b.waarde - 'controle' - 'controleReden' - 'controleOp')
               || jsonb_build_object(
                    'controleHersteld',
                    'De bijlagecontrole hield dit bestand eerder tegen om een reden die '
                    || 'niet klopte. Hij is nooit opnieuw nagekeken.')
          else b.waarde
        end
        order by b.volgnr
      ) as nieuw
      from public.mailbox m
      cross join lateral jsonb_array_elements(m.attachments)
                 with ordinality as b(waarde, volgnr)
     where m.attachments is not null
       and jsonb_typeof(m.attachments) = 'array'
     group by m.id
    having bool_or(
      b.waarde ->> 'controle' = 'verdacht'
      and b.waarde ->> 'controleReden' ~ '(OpenAction|automatische actie|ingesloten bestand|ingesloten media|een actie die bij het openen afgaat)'
    )
  )
  update public.mailbox m
     set attachments = g.nieuw
    from geraakte g
   where g.id = m.id;

  get diagnostics geraakt = row_count;
  raise notice 'Bijlagen vrijgegeven op % berichten', geraakt;
end $$;

-- ===========================================================================
--  Bijwerken is nog steeds geen aanmaken
--
--  Migratie 0022 repareerde dit voor expenses, employer_links en agenda_items.
--  Het bleek geen eigenschap van die drie tabellen te zijn maar van de manier
--  waarop de app opslaat, en dus zat het er nog op zes andere.
--
--  Wat er aan de hand is, nog een keer, want het is niet vanzelfsprekend:
--
--  De app stuurt een gewijzigde rij als geheel op, met een upsert. PostgREST
--  maakt daar "insert ... on conflict do update" van. PostgreSQL evalueert bij
--  zo'n opdracht de WITH CHECK van de INSERT-regel, óók als de rij allang
--  bestaat en er alleen wordt bijgewerkt.
--
--  Staat er in die insertregel iets over eigendom -- "je mag alleen namens
--  jezelf melden" -- dan klopt dat bij het aanmaken en klopt het niet meer
--  zodra iemand anders de rij bijwerkt. De ontwikkelaar die een melding
--  afhandelt is niet de melder. De leidinggevende die een wijzigingsverzoek
--  goedkeurt is niet de aanvrager. En de status is dan geen 'open' meer.
--
--  Het gevolg is een foutmelding die over rechten gaat terwijl er niets mis
--  is met de rechten, en een wijziging die in de wachtrij blijft staan.
--
--  De oplossing is dezelfde als in 0022: bestaat de rij al, dan is dit geen
--  aanmaken en gaat de insertregel opzij. Wat er dan wél mag, bepaalt de
--  updateregel -- en die staat er al, ongewijzigd. Er gaat dus geen deur
--  open die dicht hoorde te zijn; de deur die dicht zat was de verkeerde.
--
--  Niet aangeraakt: pos_safe_moves. Daar kan dit niet gebeuren, want een
--  kluisboeking wordt nooit bijgewerkt -- er staat een trigger op die dat
--  weigert. Wat niet wordt bijgewerkt, kan niet over deze val struikelen.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Meldingen
--
--  Dit is de fout die gemeld werd. De ontwikkelaar die een melding oppakt,
--  van status verandert of er een reactie op zet, is niet degene die hem heeft
--  gemaakt -- en de insertregel eist dat wel.
-- ---------------------------------------------------------------------------

drop policy if exists tickets_insert on public.tickets;
create policy tickets_insert on public.tickets for insert to authenticated
  with check (
    public.rij_bestaat('public.tickets'::regclass, id)
    or reported_by = public.my_id()
  );

drop policy if exists messages_insert on public.ticket_messages;
create policy messages_insert on public.ticket_messages for insert to authenticated
  with check (
    public.rij_bestaat('public.ticket_messages'::regclass, id)
    or (
      author_id = public.my_id()
      and (
        public.is_developer()
        or exists (
          select 1 from public.tickets t
           where t.id = ticket_id and t.reported_by = public.my_id()
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
--  Wijzigingsverzoeken op een dossier
--
--  Deze was gegarandeerd stuk en het is nooit gemeld. De insertregel eist
--  status = 'open' én dat jij de aanvrager bent. Op het moment dat iemand het
--  verzoek goedkeurt is de status geen 'open' meer en is de beslisser niet de
--  aanvrager -- dus faalt precies de handeling waar het verzoek voor bestaat.
-- ---------------------------------------------------------------------------

drop policy if exists cr_insert on public.change_requests;
create policy cr_insert on public.change_requests for insert to authenticated
  with check (
    public.rij_bestaat('public.change_requests'::regclass, id)
    or (
      public.is_lead()
      and aangevraagd_door = public.my_id()
      and status = 'open'
    )
  );

-- ---------------------------------------------------------------------------
--  Werkgevers
--
--  Zelfde verhaal: een aanvraag komt binnen met status 'aangevraagd' op naam
--  van de aanvrager. Zodra het management hem goedkeurt klopt geen van beide
--  voorwaarden meer.
-- ---------------------------------------------------------------------------

drop policy if exists wg_insert on public.employers;
create policy wg_insert on public.employers for insert to authenticated
  with check (
    public.rij_bestaat('public.employers'::regclass, id)
    or public.is_management()
    or (status = 'aangevraagd' and aangevraagd_door = public.my_id())
  );

-- ---------------------------------------------------------------------------
--  Overleg
--
--  Een bericht bijwerken -- een correctie, of het weghalen door iemand die
--  mag modereren -- struikelt over "author_id = mijn id". Een kanaal
--  bijwerken struikelt over de voorwaarden waaronder je er een mag aanmaken.
-- ---------------------------------------------------------------------------

drop policy if exists chat_insert on public.chat_messages;
create policy chat_insert on public.chat_messages for insert to authenticated
  with check (
    public.rij_bestaat('public.chat_messages'::regclass, id)
    or (
      public.is_staff()
      and author_id = public.my_id()
      and public.can_see_channel(channel_id)
    )
  );

drop policy if exists channels_insert on public.channels;
create policy channels_insert on public.channels for insert to authenticated
  with check (
    public.rij_bestaat('public.channels'::regclass, id)
    or (
      public.is_staff()
      and (
        public.is_management()
        or public.is_supervisor()
        or (kind = 'gesprek' and public.my_id() = any(member_ids))
      )
    )
  );

-- ---------------------------------------------------------------------------
--  Opleiding
--
--  De minst waarschijnlijke van het stel -- een leidinggevende valt al onder
--  is_lead() -- maar de val zit er wel, en hem hier laten zitten betekent dat
--  iemand er over een half jaar opnieuw achter komt.
-- ---------------------------------------------------------------------------

drop policy if exists progress_insert on public.course_progress;
create policy progress_insert on public.course_progress for insert to authenticated
  with check (
    public.rij_bestaat('public.course_progress'::regclass, id)
    or user_id = public.my_id()
    or public.is_lead()
  );

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

/*
 * Eerst weg, dan opnieuw -- en niet "create or replace".
 *
 * Postgres weigert een vervanging zodra de teruggegeven kolommen veranderen:
 * "cannot change return type of existing function". Dat is precies wat er
 * gebeurde toen 0035 er een kolom bij zette. Bij de eerste keer draaien merk
 * je dat niet; bij de TWEEDE keer wel, want dan komt dit bestand langs terwijl
 * de functie al de nieuwe vorm heeft, en dan valt supabase/bijwerken.sql
 * halverwege om. En dat bestand belooft juist dat opnieuw draaien altijd mag.
 */
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
 * PUBLIC. Alleen "grant to service_role" laat die standaard gewoon staan:
 * iedereen kan de functie dan aanroepen. En omdat het security definer-
 * functies zijn, stapt zo'n aanroep dwars door de beveiligingsregels op
 * locations en profiles heen. Dat is het omgekeerde van wat hierboven staat.
 *
 * Waarom anon en authenticated er apart bij staan
 * -----------------------------------------------
 *
 * Omdat "revoke from public" ze op Supabase NIET raakt. Supabase zet in elk
 * project een standaardregel klaar:
 *
 *   alter default privileges in schema public
 *     grant execute on functions to anon, authenticated, service_role;
 *
 * Daardoor krijgt elke nieuwe functie een EIGEN recht voor anon en
 * authenticated, en niet een recht via PUBLIC. Intrekken bij PUBLIC haalt die
 * eigen rechten er niet af. Gemeten op de echte database:
 *
 *   anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
 *
 * De eerste versie van deze migratie trok alleen bij PUBLIC in en leek te
 * werken, want in de test (PGlite) bestaat die standaardregel niet en erft
 * anon wél via PUBLIC. De test stond groen en het gat stond open. De stub in
 * scripts/sqltest.mjs bootst die regel nu na, zodat dit verschil niet meer
 * tussen wal en schip valt.
 *
 * De website haalt dit op via een serverfunctie met de servicesleutel. Anon
 * uitvoerrecht geven kan later alsnog, maar dan als besluit en niet als
 * bijvangst van een standaardinstelling.
 */
revoke execute on function public.website_vestigingen()        from public, anon, authenticated;
revoke execute on function public.website_aantal_medewerkers() from public, anon, authenticated;

grant execute on function public.website_vestigingen() to service_role;
grant execute on function public.website_aantal_medewerkers() to service_role;

-- ===========================================================================
--  Anon hoort hier niet bij te kunnen
--
--  Aanleiding: bij het nameten van 0033 bleek dat een bezoeker zonder inlog,
--  met alleen de publieke sleutel, twee functies kon aanroepen die daar niet
--  voor bedoeld zijn. Gemeten via de REST-laag, zonder enige sessie:
--
--    POST /rest/v1/rpc/pos_kluis_saldo  {"kluis":"..."}   -> 200, een bedrag
--    POST /rest/v1/rpc/vestiging_bezet  {"loc":"..."}     -> 200, een lijst
--
--  Dat is geen bewuste keuze geweest. In 0025 en 0026 staat letterlijk:
--
--    grant execute on function public.pos_kluis_saldo(text)  to authenticated;
--    grant execute on function public.vestiging_bezet(text)  to authenticated;
--
--  "to authenticated" betekent: ingelogd, en verder niemand. Maar Supabase
--  zet in elk project deze standaardregel klaar:
--
--    alter default privileges in schema public
--      grant execute on functions to anon, authenticated, service_role;
--
--  Daardoor krijgt elke nieuwe functie er anon gratis bij. De grant erna
--  bevestigt alleen wat er al stond; hij neemt niets weg. Deze migratie laat
--  de code dus doen wat er al stond -- ze verandert geen bedoeling.
--
--  Waarom dit veilig is
--  --------------------
--
--  Beide functies zijn security definer: ze draaien met de rechten van de
--  eigenaar en stappen dwars door de regels op de onderliggende tabellen
--  heen. Precies daarom moet de deur ervoor kloppen.
--
--  Nagekeken voordat dit werd ingetrokken:
--
--    - Geen van beide komt voor in een beveiligingsregel (using / with check).
--      Zat er wel een in, dan zou intrekken bij anon elke anonieme aanvraag op
--      die tabel een foutmelding geven in plaats van een lege lijst.
--    - Geen van beide apps roept ze aan. De enige rpc-aanroep in het dashboard
--      en de kassa samen is server_time_ms.
--    - vestiging_bezet wordt wel gebruikt binnen een trigger (0026, regel
--      196). Een trigger draait onder de eigenaar en heeft dit recht niet
--      nodig.
--
--  authenticated houdt zijn recht. Alleen anon gaat eraf.
--
--  LET OP: pos_kluis_saldo hoort bij de kassa (0025). Dit raakt geen enkele
--  regel van die functie zelf -- alleen wie hem mag aanroepen, en dat wordt
--  wat er in 0025 al als bedoeling staat.
-- ===========================================================================

-- Waarom PUBLIC er ook bij staat, en niet alleen anon
-- --------------------------------------------------
--
-- Er zitten twee rechten op deze functies, en je moet ze allebei weghalen:
--
--   =X/postgres        het recht van PUBLIC -- van Postgres zelf
--   anon=X/postgres    het eigen recht van anon -- van Supabase' standaardregel
--
-- anon is lid van PUBLIC. Trek je alleen het eigen recht in, dan kan anon het
-- nog steeds via PUBLIC. Trek je alleen bij PUBLIC in, dan kan anon het nog
-- steeds via zijn eigen recht. Precies die eerste helft ging in de eerste
-- versie van 0033 mis, en de tweede helft in de eerste versie van dit
-- bestand. Allebei betrapt door de controle in scripts/sqltest.mjs.
--
-- authenticated raakt zijn recht via PUBLIC hier ook kwijt, en krijgt het
-- daarom hieronder expliciet terug. Dat is meteen netter: dan staat er in de
-- rechten wie het mag in plaats van "iedereen behalve".

revoke execute on function public.pos_kluis_saldo(text) from public, anon;
revoke execute on function public.vestiging_bezet(text) from public, anon;

-- En teruggeven wat de bedoeling was, zodat opnieuw draaien altijd mag.
grant execute on function public.pos_kluis_saldo(text) to authenticated;
grant execute on function public.vestiging_bezet(text) to authenticated;

-- ===========================================================================
--  De achttien vestigingen komen naar binnen
--
--  Tot nu toe stonden de vestigingen op twee plekken, en geen van beide was
--  compleet. De app kende er twee -- het hoofdkantoor en een proefinvoer met
--  het adres "kasweg 2112". De website kende er achttien, met echte adressen,
--  telefoonnummers en openingstijden, maar die stonden in met de hand
--  geschreven HTML.
--
--  Vanaf hier is de app de bron. Deze migratie zet de achttien erin, precies
--  zoals ze op de site staan, zodat de site er daarna hetzelfde uitziet en
--  alleen zijn gegevens ergens anders vandaan haalt. Wie voortaan een adres
--  wijzigt of een uur van zaterdag afhaalt, doet dat op een plek.
--
--  Waar de gegevens vandaan komen
--  ------------------------------
--
--  Uit bouw/site.json van het merksiteproject. Dat bestand is destijds van
--  truckwash1group.nl geschraapt en is de bron waaruit de achttien
--  vestigingspagina's worden gegenereerd. Adres, postcode, plaats, telefoon,
--  e-mail, coordinaten, openingstijden, de introtekst en de routebeschrijving
--  zijn een-op-een overgenomen.
--
--  Wat NIET is overgenomen, en waarom
--  ----------------------------------
--
--    het aantal wasstraten   staat nergens op de site. Elke vestiging krijgt
--                            de standaardwaarde. Dit is het enige veld dat
--                            met de hand moet worden nagelopen, en tot dat
--                            gebeurd is hoort het niet op de site te staan.
--
--    de foto's               de site verwijst naar afbeeldingen op
--                            truckwash1group.nl. Die kopieren hoort bij het
--                            fotoscherm van de vestiging, niet bij een
--                            migratie.
--
--  Opnieuw draaien mag
--  -------------------
--
--  "on conflict do nothing", en niet "do update". Dat is met opzet: dit
--  bestand komt in supabase/bijwerken.sql terecht, en dat mag altijd opnieuw.
--  Met "do update" zou een tweede keer draaien alles terugzetten naar wat de
--  site ooit zei -- en daarmee elke wijziging wissen die daarna in de app is
--  gemaakt. Een importmigratie hoort een keer te importeren en zich daarna
--  stil te houden.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De punten op de vestigingspagina
--
--  Per vestiging staat er een lijstje op de site: "500 meter vanaf Flora
--  Holland", "Handwash met spons", "Haal en brengservice". Dat is geen
--  dienstenlijst maar het rijtje redenen om juist hier te stoppen, en het
--  verschilt echt per vestiging -- van de achttien lijsten zijn er twaalf
--  verschillend.
--
--  Los van de kolom diensten. Die bevat sleutels die naar een dienstpagina
--  wijzen; dit is vrije tekst die alleen op deze pagina staat.
-- ---------------------------------------------------------------------------

alter table public.locations
  add column if not exists punten text[] not null default '{}';

comment on column public.locations.punten is
  'Opsomming op de vestigingspagina van de website. Vrije tekst, een regel per '
  'punt. Los van de kolom diensten -- dat zijn sleutels naar een dienstpagina.';

-- ---------------------------------------------------------------------------
--  De achttien
-- ---------------------------------------------------------------------------

insert into public.locations (
  id, code, name, address, postcode, city, phone, email, lat, lon,
  opening_hours, website_slug, intro, bereikbaar, bijzonder, diensten, punten,
  kind, active, op_website
)
select
  v.id, v.code, v.name, v.address, v.postcode, v.city, v.phone, v.email,
  v.lat, v.lon, v.opening_hours, v.website_slug, v.intro, v.bereikbaar,
  v.bijzonder, v.diensten, v.punten,
  'vestiging', true, true
from (values
  ('loc_aalsmeer', 'TW-AAL', 'Truckwash Aalsmeer', 'Afmijnstraat 4', '1187 ZZ', 'Amstelveen', '0203035112', 'aalsmeer@truckwash1group.nl', 52.2606023, 4.7997808, '{"ma":{"van":"07:00","tot":"19:00"},"di":{"van":"07:00","tot":"19:00"},"wo":{"van":"07:00","tot":"19:00"},"do":{"van":"07:00","tot":"21:00"},"vr":{"van":"07:00","tot":"21:00"},"za":{"van":"07:00","tot":"15:00"},"zo":null}'::jsonb, 'aalsmeer', 'Je vindt Truckwash 1 Aalsmeer op het bedrijventerrein Greenpoort aan de Afmijnstraat 4 in Amstelveen, langs de N201. Truckwash Aalsmeer is vanaf de A4 makkelijk te bereiken.', 'Vanuit Amsterdam neem je afslag 3 richting Hoofddorp en vervolgens via de N201. Vanuit Den Haag neem je ook afslag 3 richting Aalsmeer en vervolgens via de N201.', null, array['alcoa-velgen-reinigen', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['500 meter vanaf Flora Holland bloemenveiling', '5 minuten vanaf Schiphol Airport', '8 minuten vanaf snelweg A4', 'Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van uw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren']::text[]),
  ('loc_amsterdam', 'TW-AMS', 'Truckwash Amsterdam', 'Galwin 4', '1046AW', 'Amsterdam', '0203035135', 'amsterdam@truckwash1group.nl', 52.3956631, 4.8003185, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"13:00"},"zo":null}'::jsonb, 'amsterdam', 'Welkom bij Truckwash 1 Amsterdam, dé toonaangevende bestemming voor het grondig reinigen van vrachtwagens. Je vindt onze wasstraat aan Galwin 4 op bedrijventerrein Sloterdijk, nabij industriewijk Westpoort. Vanaf de A5 neem je afslag 3 Amsterdam-Westpoort.', 'Met twee moderne wasstraten is Truckwash 1 Amsterdam perfect uitgerust voor het reinigen van alle soorten vrachtwagens en bestelwagens. Onze wasstraten voldoen aan strenge normen en maken gebruik van de nieuwste reinigingsprogramma’s, waardoor je voertuig weer in optimale staat wordt gebracht. Terwijl ons gespecialiseerde personeel aan de slag gaat, kun je een kop koffie nuttigen in de wachtruimte.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van uw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_asten', 'TW-AST', 'Truckwash Asten', 'Nobisweg 5', '5721 VA', 'Asten', '+31(0)493 670242', 'asten@truckwash1group.nl', 51.4162996, 5.7567305, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"14:00"},"zo":null}'::jsonb, 'asten', 'Je vindt Truckwash 1 Asten direct langs de A67 in Asten, op het terrein van truckstop Nobis aan de Nobisweg 5.', 'Truckwash 1 Asten beschikt over 2 professionele wasstraten, geschikt voor alle soorten vrachtwagens en bestelwagens. Onze wasstraten voldoen aan de hoogste eisen en beschikken over de modernste reinigingsprogramma’s om jou wagen weer spik en span te maken.', null, array['alcoa-velgen-reinigen']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Velgen reinigen', 'Alcoa reiniging', 'Velgen reiniging', 'Zuren / Ontvetten', 'Wassen met spons']::text[]),
  ('loc_bodegraven', 'TW-BOD', 'Truckwash Bodegraven', 'Europaweg 1e', '2411 NE', 'Bodegraven', '0172619499', 'bodegraven@truckwash1group.nl', 52.0698105, 4.7445157, '{"ma":{"van":"08:00","tot":"19:00"},"di":{"van":"08:00","tot":"19:00"},"wo":{"van":"08:00","tot":"19:00"},"do":{"van":"08:00","tot":"21:00"},"vr":{"van":"07:00","tot":"21:00"},"za":{"van":"07:00","tot":"13:00"},"zo":null}'::jsonb, 'bodegraven', 'Je vindt Truckwash 1 Bodegraven op het bedrijven terrein Broekvelden aan de Europaweg 1e in Bodegraven, naast Goedhart Motoren. Truckwash Bodegraven is het beste te bereiken vanaf de A12 afslag 12a of afslag 12 Reeuwijk of vanaf de N11 afslag Bodegraven. Truckwash Bodegraven beschikt over 3 moderne wasstraten waarvan 1 LZV straat.', 'Twee straten zijn voorzien van een onderwasser voor de onderkant van jouw wagen. Elke straat is voorzien van een warmwatercleaner zodat we in elke hal de trailer inwendig kunnen reinigen. Door de drie straten en het efficiënt reinigen van jouw voertuigen verlagen wij de wachttijden tot een minimum.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van uw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_hazeldonk', 'TW-HAZ', 'Truckwash Hazeldonk', 'Hazeldonk 6005', '4836 LA', 'Breda', '076 596 3278', 'breda@truckwash1group.nl', 51.4902708, 4.7441562, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"12:00"},"zo":null}'::jsonb, 'hazeldonk', 'Truckwash 1 Hazeldonk is gevestigd in de voormalige Truckwash Hazeldonk locatie aan de Hazeldonk 6005, naast de Q8.
De Truckwash 1 locatie ligt strategisch gelegen aan de A16, bij de grens tussen België en Nederland.', 'De Truckwash wordt compleet gerenoveerd en krijgt een nieuwe machine, en word ingericht op de mogelijkheid om te kunnen voorwassen zodat het proces efficiënt verloopt.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling']::text[], array['We zullen van Maandag t/m Zaterdag geopend zijn', 'We accepteren alle betaalmogelijkheden die u van ons gewend bent', 'We bieden speciale behandelingen aan zoals een alcoa behandeling', 'Chauffeurs kunnen sparen voor leuke truck accessoires', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging', 'HACCP reiniging']::text[]),
  ('loc_doetinchem', 'TW-DOE', 'Truckwash Doetinchem', 'Braamtseweg 10', '7007 CK', 'Doetinchem', '088-0600 100', 'doetinchem@truckwash1group.nl', 51.9463034, 6.2834481, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"13:00"},"zo":null}'::jsonb, 'doetinchem', 'De nieuwe vestiging in Doetinchem ligt direct aan de A18 (afslag 3), een van de belangrijkste oost-westas voor het vrachtverkeer in de Achterhoek en het grensgebied met Duitsland. De locatie is daarmee ideaal bereikbaar voor transporteurs die rijden op de corridors richting het Ruhrgebied, Münster en verder.', 'Route plannen 
 Openingstijden 
 Vandaag geopend van 08.00 - 18.00', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Ontsmetten en/of desinfecteren', 'Handwash met spons', 'Alcoa / Dura Bright behandeling', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van laadruimtes (HACCP & NAO)', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_ede', 'TW-EDE', 'Truckwash Ede', 'Francis Baconstraat 2', '6718 XA', 'Ede', '0318452282', 'ede@truckwash1group.nl', 52.0356369, 5.6076683, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"13:00"},"zo":null}'::jsonb, 'ede', 'Je vindt Truckwash 1 Ede op het bedrijventerrein BT A12 op een A locatie op nog geen 5 minuten van de A12 (knooppunt Maanderbroek), en maar 2 minuten van de afslag 1 van de A30 (achter het Plantion).', 'Truckwash Ede beschikt over 2 moderne wasstraten en in 1 straat een onderwas voor de onderkant van jouw wagen. Door de twee straten en het efficiënt reinigen van jouw voertuigen verlagen wij de wachttijden tot een minimum. Je kunt ook een bezoek brengen aan onze shop of natuurlijk een kop koffie nuttigen.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats', 'vogelgriep']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van jouw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Bodemreiniging', 'Vogelgriep reiniging en desinfectie', 'Haal en brengservice (informeer contactpersoon)']::text[]),
  ('loc_eindhoven', 'TW-EIN', 'Truckwash Eindhoven', 'Het Schakelplein 30', '5651 GR', 'Eindhoven', '+31 (0) 40 262 02 22', 'eindhoven@truckwash1group.nl', 51.4659684, 5.4186163, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"12:00"},"zo":null}'::jsonb, 'eindhoven', 'Je vindt Truckwash 1 Eindhoven vlak bij de A2 (afrit 29, Eindhoven Airport/acht) en Eindhoven Airport (volg de N2). Op het bedrijventerrein Eindhoven-acht.', 'Truckwash 1 Eindhoven beschikt over 3 moderne wasstraten, speciaal voor vrachtwagens en bestelwagens, die voldoen aan de hoogste eisen. Kan je bedrijfswagen weer een wasbeurt gebruiken? Rij dan door de modernste wasstraat van Eindhoven en terwijl je wagen wordt gewassen, kun je een gratis kopje koffie halen bij ons restaurant. Of je nu het chassis, de buitenzijde of de binnenkant van de oplegger wilt laten reinigen: bij ons is (bijna) alles mogelijk. Onze wasstraat is bijzonder milieuvriendelijk.', null, array['alcoa-velgen-reinigen', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van jouw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Alcoa reiniging', 'HACCP reiniging', 'Velgen reiniging']::text[]),
  ('loc_groenlo', 'TW-GRO', 'Truckwash Groenlo', 'Noordgang 8', '7141JP', 'Groenlo', '0544745006', 'groenlo@truckwash1group.nl', 52.0616814, 6.6250053, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"14:00"},"zo":null}'::jsonb, 'groenlo', 'Truckwash 1 Groenlo is uitstekend bereikbaar via de N18 (Twenteroute) en vormt een logische stop voor chauffeurs in de Achterhoek en richting Duitsland. Dankzij de ligging vlak bij deze hoofdroute ben je snel van de weg af en eenvoudig weer onderweg.', 'Route plannen 
 Openingstijden 
 Vandaag geopend van 08.00 - 18.00', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Ontsmetten en/of desinfecteren', 'Handwash met spons', 'Alcoa / Dura Bright behandeling', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van laadruimtes (HACCP & NAO)', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_holten', 'TW-HOL', 'Truckwash Holten', 'Handelsweg 34', '7451PJ', 'Holten', '0548855574', 'holten@truckwash1group.nl', 52.2755805, 6.4011927, '{"ma":{"van":"07:00","tot":"18:00"},"di":{"van":"07:00","tot":"18:00"},"wo":{"van":"07:00","tot":"18:00"},"do":{"van":"07:00","tot":"18:00"},"vr":{"van":"07:00","tot":"21:00"},"za":{"van":"07:00","tot":"13:00"},"zo":null}'::jsonb, 'holten', 'Welkom bij Truckwash 1 Holten, dé toonaangevende bestemming in Twente voor het grondig reinigen van vrachtwagens. Je vindt onze vrachtwagen wasstraat aan de Handelsweg 34, aan de N332.', 'Truckwash 1 Holten is uitgerust met maar liefst 5 banen. Drie moderne wasstraten voor het reinigen van alle soorten vrachtwagens en bestelwagens. Daarnaast hebben we nog twee plaatsen voor het uitspuiten van de binnenkant. Onze wasstraten voldoen aan strenge normen en maken gebruik van effectieve reinigingsprogramma’s, waardoor je voertuig weer in optimale staat wordt gebracht. Terwijl ons gespecialiseerde personeel aan de slag gaat, kun je in onze wachtruimte genieten van een kop koffie.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Ontsmetten en/of desinfecteren', 'Handwash met spons', 'Alcoa / Dura Bright behandeling', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van je laadruimtes (HACCP & NAO)', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_maasvlakte', 'TW-MAA', 'Truckwash Maasvlakte', 'Luzonstraat 10', '3199 KX', 'Maasvlakte', '0181 44 25 60', 'maasvlakte@truckwash1group.nl', 51.9276713, 4.023263, '{"ma":{"van":"08:00","tot":"21:00"},"di":{"van":"08:00","tot":"21:00"},"wo":{"van":"08:00","tot":"21:00"},"do":{"van":"08:00","tot":"21:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"13:00"},"zo":null}'::jsonb, 'maasvlakte', 'Je vindt Truckwash 1 Maasvlakte op de Maasvlakte Plaza in Rotterdam aan de Luzonstraat 10. Truckwash Maasvlakte is de grootste Truckwash van Europa en is het beste te bereiken via de A15 naar de N15. Naast ons terrein zit de Maasvlakte Plaza, chauffeur restaurant genaamd Routiers, en de Maasvlakte Plaza Truckparking.', 'Truckwash 1 Maasvlakte beschikt over 6 wasstraten. Door de vier straten en het efficiënt reinigen van jouw voertuigen verlagen wij de wachttijden tot een minimum.', 'Op zondag alleen op afspraak.', array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats', 'truckparking', 'wegrestaurant-a2']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van je laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_rilland', 'TW-RIL', 'Truckwash Rilland', 'De Poort 24a', '4411PA', 'Rilland', '0113560028', 'rilland@truckwash1group.nl', 51.4222148, 4.1914538, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"21:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"07:00","tot":"16:00"},"zo":null}'::jsonb, 'rilland', 'Je vindt Truckwash 1 Rilland op het bedrijventerrein De Poort, naast het tankstation De Meeuw. Onze locatie is het best te bereiken via de A58. We zijn gevestigd op De Poort 24a.', 'We beschikken over 2 moderne wasstraten en 1 hal in het midden die gebruikt kan worden voor het inwendig reinigen van trailers en/of zelfservice.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van uw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_roosendaal', 'TW-ROO', 'Truckwash Roosendaal', 'Stepvelden 23', '4704RM', 'Roosendaal', '0165529496', 'roosendaal@truckwash1group.nl', 51.5539283, 4.4635791, '{"ma":{"van":"07:00","tot":"21:00"},"di":{"van":"07:00","tot":"21:00"},"wo":{"van":"07:00","tot":"21:00"},"do":{"van":"07:00","tot":"21:00"},"vr":{"van":"07:00","tot":"21:00"},"za":{"van":"07:00","tot":"16:00"},"zo":null}'::jsonb, 'roosendaal', 'Je vindt Truckwash 1 Roosendaal op het bedrijventerrein de Borchwerf aan de Stepvelden 23, Roosendaal. Jouw locatie is het best te bereiken via de A17 afslag 20. We beschikken over 2 moderne wasstraten van 35 meter lang. Alle voertuigen die niet in een normale wasstraat passen kunnen bij ons terecht.', 'Ben je op zoek naar een truckwash in de buurt van Hazeldonk (Breda )? Dan is Truckwash 1 in Roosendaal het dichtste bij jou in de buurt.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van jouw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Stickerverwijdering in trailers', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)']::text[]),
  ('loc_rotterdam', 'TW-ROT', 'Truckwash Rotterdam', 'Tweedweg 20', '3197 LM', 'Rotterdam-Botlek', '0102967764', 'rotterdam@truckwash1group.nl', 51.8734417, 4.2631194, '{"ma":{"van":"07:00","tot":"21:00"},"di":{"van":"07:00","tot":"21:00"},"wo":{"van":"07:00","tot":"21:00"},"do":{"van":"07:00","tot":"21:00"},"vr":{"van":"07:00","tot":"21:00"},"za":{"van":"07:00","tot":"16:00"},"zo":null}'::jsonb, 'rotterdam', 'Truckwash 1 Rotterdam zit in de Botlek aan de Tweedweg 20. Bereikbaar via de A15 (afslag 15). Met 4 wasstraten is dit een van onze grootste locaties. Naast het terrein: een ADR truckparking (betaald), truckerrestaurant Routiers, een Q8 truck-tankstation en een gratis parkeerplaats. Kortom alles op één plek. Geen afspraak nodig.', 'Door de vier straten en het efficiënt reinigen van je voertuigen verlagen we de wachttijden tot een minimum. Elke hal beschikt over een warmwater cleaner zodat we op iedere baan ook de trailer inwendig kunnen reinigen. Moet je even wachten? Dan kun je gebruik maken van de stofzuiger om je cabine schoon te maken. Je kunt ook een bezoek brengen aan onze shop of natuurlijk een kop koffie nuttigen. Lang onderweg geweest? Je kunt bij ons gebruik maken van de douches.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats', 'truckparking', 'wegrestaurant-a2']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van uw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_steenwijk', 'TW-STE', 'Truckwash Steenwijk', 'Oostermeentherand 8', '8332JZ', 'Steenwijk', '0521745003', 'Steenwijk@truckwash1group.nl', 52.7974282, 6.1293435, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"18:00"},"za":{"van":"08:00","tot":"13:00"},"zo":null}'::jsonb, 'steenwijk', 'Truckwash 1 Steenwijk ligt op korte afstand van de A32 (afslag Steenwijk) en is daarmee ideaal bereikbaar voor chauffeurs die rijden tussen Zwolle, Meppel en Leeuwarden. De aanrijroute is overzichtelijk en geschikt voor zwaar transport.', 'Door de combinatie van moderne apparatuur en een vlot werkend team kun je hier rekenen op een snelle doorloop zonder concessies te doen aan kwaliteit. Efficiënt wassen met een schoon en representatief resultaat.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Ontsmetten en/of desinfecteren', 'Handwash met spons', 'Alcoa / Dura Bright behandeling', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van laadruimtes (HACCP & NAO)', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_utrecht', 'TW-UTR', 'Truckwash Utrecht', 'Reactorweg 27', '3542 AD', 'Utrecht', '0307740744', 'utrecht@truckwash1group.nl', 52.10574, 5.0633264, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"13:00"}}'::jsonb, 'utrecht', 'Je vindt Truckwash 1 Utrecht op het bedrijventerrein Lage Weide aan de Reactorweg 27. Lage Weide is het best te bereiken vanaf de A2 afslag 7. (In het pand van Van Leeuwen Trucks & vans). Truckwash Utrecht beschikt over 2 moderne wasstraten.', 'Door de twee straten en het efficiënt reinigen van je voertuigen verlagen we de wachttijden tot een minimum. Moet je even wachten? Dan kun je gebruik maken van de stofzuiger om je cabine schoon te maken. Je kunt ook een bezoek brengen aan onze shop of natuurlijk een kop koffie nuttigen.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van je laadruimtes (HACCP & NAO):', 'Ontsmetten en/of desinfecteren', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_venlo', 'TW-VEN', 'Truckwash Venlo', 'Columbusweg 47', '5928LA', 'Venlo', '0773230405', 'venlo@truckwash1group.nl', 51.3958245, 6.0898586, '{"ma":{"van":"08:00","tot":"19:00"},"di":{"van":"08:00","tot":"19:00"},"wo":{"van":"08:00","tot":"19:00"},"do":{"van":"08:00","tot":"21:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"13:00"},"zo":null}'::jsonb, 'venlo', 'Welkom bij Truckwash 1 Venlo, dé toonaangevende bestemming in Venlo en omstreken voor het grondig reinigen van vrachtwagens. Je vindt onze wasstraat aan de Columbusweg 47 op bedrijventerrein Trade Port West. Vanaf de A67 neem je afslag 39 Sevenum.', 'Truckwash 1 Venlo is uitgerust met twee moderne wasstraten voor het reinigen van alle soorten vrachtwagens en bestelwagens. Onze wasstraten voldoen aan strenge normen en maken gebruik van de nieuwste reinigingsprogramma’s, waardoor uw voertuig weer in optimale staat wordt gebracht. Wassen gebeurt bovendien op een duurzame manier . Terwijl ons gespecialiseerde personeel aan de slag gaat, kun je in onze wachtruimte genieten van een kop koffie.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Ontsmetten en/of desinfecteren', 'Handwash met spons', 'Alcoa / Dura Bright behandeling', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van uw laadruimtes (HACCP & NAO)', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_wehl', 'TW-WEH', 'Truckwash Wehl', 'Kryptonstraat 6A', '7031GG', 'Wehl', '088-0600100', 'holten@truckwash1group.nl', 51.9464915, 6.2251281, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"16:00"},"zo":null}'::jsonb, 'wehl', 'Truckwash 1 Wehl is goed bereikbaar via de A18 (afslag Wehl/Doetinchem) en ligt centraal in de Achterhoek. De ligging maakt deze locatie een vaste stop voor transportbewegingen in Oost-Nederland en richting Duitsland.', 'De locatie is volledig ingericht op efficiënt werken, met aandacht voor kwaliteit en zorgvuldige reiniging. Zo vervolg je je route met een schone vrachtwagen en minimale tijd van de weg.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Ontsmetten en/of desinfecteren', 'Handwash met spons', 'Alcoa / Dura Bright behandeling', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van laadruimtes (HACCP & NAO)', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[])
) as v (
  id, code, name, address, postcode, city, phone, email, lat, lon,
  opening_hours, website_slug, intro, bereikbaar, bijzonder, diensten, punten
)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
--  De proefinvoer bijwerken
--
--  Er stond al een "Truckwash Utrecht" met de code TW-UTR en het adres
--  "kasweg 2112". Die code botst met de echte Utrecht-vestiging hierboven, dus
--  die is door "do nothing" overgeslagen -- en dan bleef de proefinvoer staan
--  met het verkeerde adres erin.
--
--  Bijwerken en niet weggooien: er kunnen al uren, wasbeurten of roosters aan
--  deze vestiging hangen, en die verwijzen naar dit id. Een nieuwe rij naast
--  de oude zou Utrecht twee keer in elke keuzelijst zetten.
--
--  De voorwaarde op het adres maakt dit eenmalig. Heeft iemand het adres al
--  goedgezet -- met de hand of door deze migratie -- dan gebeurt er niets meer,
--  en blijft alles wat daarna in de app is gewijzigd gewoon staan.
-- ---------------------------------------------------------------------------

update public.locations bestaand
   set name          = echt.name,
       address       = echt.address,
       postcode      = echt.postcode,
       city          = echt.city,
       phone         = echt.phone,
       email         = echt.email,
       lat           = echt.lat,
       lon           = echt.lon,
       opening_hours = echt.opening_hours,
       website_slug  = echt.website_slug,
       intro         = echt.intro,
       bereikbaar    = echt.bereikbaar,
       diensten      = echt.diensten,
       punten        = echt.punten,
       op_website    = true,
       updated_at    = public.now_ms()
  from public.locations echt
 where bestaand.code = 'TW-UTR'
   and echt.id       = 'loc_utrecht'
   and bestaand.id  <> echt.id
   and lower(trim(coalesce(bestaand.address, ''))) = 'kasweg 2112';

-- De rij waaruit is overgenomen mag daarna weg: hij is nooit in gebruik
-- geweest en zou Utrecht anders dubbel in de lijst zetten.
delete from public.locations
 where id = 'loc_utrecht'
   and exists (
     select 1 from public.locations b
      where b.code = 'TW-UTR' and b.id <> 'loc_utrecht'
        and b.website_slug = 'utrecht');

-- ---------------------------------------------------------------------------
--  Hoeveel mensen er werken
--
--  De telling voor de vacaturepagina zat er naast. Hij sloot iedereen uit met
--  de rol "klant" of "werkgever", en dat is te streng: rollen stapelen in dit
--  systeem. Wie werknemer is en daarnaast een klantaccount heeft, is nog
--  steeds gewoon een collega. Gemeten op de echte database gaf dat 1 in plaats
--  van 6 -- en 1 is een getal dat je niet op een vacaturepagina wilt zetten
--  voor een bedrijf met negentien vestigingen.
--
--  De nieuwe regel is eenvoudiger en zegt wat hij bedoelt: iedereen die de rol
--  werknemer heeft, actief is, niet is uitgeschreven, en geen kassa is.
-- ---------------------------------------------------------------------------

create or replace function public.website_aantal_medewerkers()
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer
    from public.profiles
   where active
     and archived_at is null
     and not coalesce(is_device, false)
     and 'employee' = any(coalesce(roles, array[]::text[]));
$$;

-- ---------------------------------------------------------------------------
--  De punten mee naar buiten
--
--  website_vestigingen() gaf ze nog niet terug, en zonder die lijst kan de
--  site de vestigingspagina niet maken zoals hij nu is.
-- ---------------------------------------------------------------------------

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
  punten      text[]
)
language sql stable security definer set search_path = public as $$
  select
    l.website_slug, l.name, l.address, l.postcode, l.city,
    l.phone, l.email, l.lat, l.lon, l.bays,
    l.opening_hours, l.intro, l.bereikbaar, l.bijzonder, l.diensten, l.punten
  from public.locations l
  where l.op_website
    and l.active
    and l.website_slug is not null
  order by l.name;
$$;

/*
 * De rechten opnieuw zetten.
 *
 * "drop function" gooit ook de rechten weg, en de nieuwe functie krijgt van
 * Supabase weer automatisch anon en authenticated erbij -- zie 0033 en 0034.
 * Zonder deze twee regels staat het gat dat daar is gedicht meteen weer open.
 */
revoke execute on function public.website_vestigingen()        from public, anon, authenticated;
revoke execute on function public.website_aantal_medewerkers() from public, anon, authenticated;

grant execute on function public.website_vestigingen()        to service_role;
grant execute on function public.website_aantal_medewerkers() to service_role;

-- ===========================================================================
--  Utrecht bleef op "kasweg 2112" staan
--
--  0035 zou achttien vestigingen invoeren en heeft er zeventien gedaan.
--  Utrecht ontbreekt, en de proefinvoer met het adres "kasweg 2112" staat er
--  nog. Gemeten na afloop: 19 rijen, 17 met punten, en de rij met code TW-UTR
--  heeft geen website_slug.
--
--  Waarom het misging
--  ------------------
--
--  0035 voegt in met "on conflict (code) do nothing". Dat is met opzet -- een
--  importmigratie mag bij een tweede keer draaien niets overschrijven. Maar de
--  code TW-UTR was al bezet door de proefinvoer, dus de echte Utrecht werd
--  overgeslagen en de rij loc_utrecht is nooit ontstaan.
--
--  En precies die rij had de reparatie eronder als bron nodig:
--
--    update ... from public.locations echt where echt.id = 'loc_utrecht'
--
--  Geen bronrij, geen update. Geen foutmelding ook: nul rijen bijwerken is
--  voor Postgres een geldig antwoord. De migratie meldde succes en deed de
--  helft.
--
--  Waarom de test het niet ving
--  ----------------------------
--
--  Die botsing bestond in de test ook -- een fixture maakte een vestiging aan
--  met de code TW-UTR. Toen 0035 daarop stukliep is de fixture hernoemd naar
--  TST-UTR. Daarmee verdween de botsing uit de test, en dus ook het enige
--  geval waarvoor de reparatie geschreven was. De test werd groen door het
--  probleem weg te halen in plaats van het na te rekenen.
--
--  In scripts/sqltest.mjs wordt de situatie nu nagebouwd zoals hij op de
--  echte database was, en pas daarna wordt dit bestand gedraaid.
--
--  Wat deze migratie doet
--  ----------------------
--
--  De bestaande rij bijwerken, niet vervangen. Aan die rij kunnen uren,
--  wasbeurten, roosters en een kluis hangen, en die verwijzen naar zijn id.
--  Weggooien en opnieuw invoeren zou dat meenemen.
--
--  Het aantal wasstraten blijft staan zoals het staat. De site zegt "2
--  moderne wasstraten" in de introtekst, maar in de app staat 3 -- met de hand
--  ingevuld, en dat is vermoedelijk de werkelijkheid. Een migratie hoort geen
--  getal te overschrijven dat iemand zelf heeft nagekeken.
-- ===========================================================================

update public.locations
   set name          = 'Truckwash Utrecht',
       address       = 'Reactorweg 27',
       postcode      = '3542 AD',
       city          = 'Utrecht',
       phone         = '0307740744',
       email         = 'utrecht@truckwash1group.nl',
       lat           = 52.10574,
       lon           = 5.0633264,
       opening_hours = '{"ma":{"van":"08:00","tot":"18:00"},'
                       '"di":{"van":"08:00","tot":"18:00"},'
                       '"wo":{"van":"08:00","tot":"18:00"},'
                       '"do":{"van":"08:00","tot":"18:00"},'
                       '"vr":{"van":"08:00","tot":"21:00"},'
                       '"za":{"van":"08:00","tot":"13:00"}}'::jsonb,
       website_slug  = 'utrecht',
       intro         = 'Je vindt Truckwash 1 Utrecht op het bedrijventerrein '
                       'Lage Weide aan de Reactorweg 27. Lage Weide is het best '
                       'te bereiken vanaf de A2 afslag 7. (In het pand van Van '
                       'Leeuwen Trucks & vans). Truckwash Utrecht beschikt over '
                       '2 moderne wasstraten.',
       bereikbaar    = 'Door de twee straten en het efficiënt reinigen van je '
                       'voertuigen verlagen we de wachttijden tot een minimum. '
                       'Moet je even wachten? Dan kun je gebruik maken van de '
                       'stofzuiger om je cabine schoon te maken. Je kunt ook een '
                       'bezoek brengen aan onze shop of natuurlijk een kop '
                       'koffie nuttigen.',
       diensten      = array[
                         'alcoa-velgen-reinigen',
                         'haal-en-brengservice',
                         'haccp-certificaat-en-behandeling',
                         'nao-wasplaats'
                       ]::text[],
       punten        = array[
                         'Alcoa / Dura Bright behandeling',
                         'Handwash met spons',
                         'Het reinigen van alle aluminium onderdelen',
                         'Het inwendig reinigen van je laadruimtes (HACCP & NAO):',
                         'Ontsmetten en/of desinfecteren',
                         'Haal en brengservice (informeer contactpersoon)',
                         'Wassen op afspraak (informeer contactpersoon)',
                         'Alcoa reiniging'
                       ]::text[],
       op_website    = true,
       updated_at    = public.now_ms()
 where code = 'TW-UTR'
   -- Eenmalig, en daarmee opnieuw te draaien: zodra het adres klopt, of zodra
   -- iemand er in de app iets aan heeft veranderd, gebeurt hier niets meer.
   and lower(trim(coalesce(address, ''))) = 'kasweg 2112';

/*
 * Het gat dat 0035 openliet.
 *
 * Was er nooit een proefinvoer geweest, dan had 0035 Utrecht gewoon ingevoerd
 * en doet de update hierboven niets. Deze regel vangt dat geval af, zodat dit
 * bestand op elke database hetzelfde eindresultaat geeft: precies een Utrecht,
 * op de website, met een slug.
 *
 * De insert vindt geen bestaande rij met deze code, want die zou hierboven al
 * zijn bijgewerkt en dan is aan de where-voorwaarde voldaan.
 */
insert into public.locations (
  id, code, name, address, postcode, city, phone, email, lat, lon,
  website_slug, kind, active, op_website
)
select
  'loc_utrecht', 'TW-UTR', 'Truckwash Utrecht', 'Reactorweg 27', '3542 AD',
  'Utrecht', '0307740744', 'utrecht@truckwash1group.nl', 52.10574, 5.0633264,
  'utrecht', 'vestiging', true, true
where not exists (
  select 1 from public.locations where website_slug = 'utrecht'
);

-- ===========================================================================
--  Een kassa mag klokken
--
--  Wat er gebeurde: iemand klokte in op de kassa, zag "is ingeklokt", stond
--  onder "Nu aan het werk" -- en de urenregel kwam nooit in de administratie.
--  De database weigerde hem, en de kassa gooide hem na acht pogingen weg.
--
--  Dat weggooien is in de kassa rechtgezet (versie 0.10.0: zo'n weigering
--  verbruikt geen pogingen meer en er komt een melding aan de balie). Dit is
--  de andere helft: de weigering zelf.
--
--  Waarom hij geweigerd werd
--  -------------------------
--
--  Sinds 0018 gaat klokken via de kassa, en de regel daar is:
--
--      insert on time_entries: is_management() or heeft_recht('hours.clock')
--
--  heeft_recht() kijkt in profiles.grants. Een gekoppelde kassa krijgt sinds
--  0025 zijn eigen inlogaccount met een dossier erbij -- rol employee, een
--  vestiging, en verder niets. Geen grants dus, en dus geen hours.clock.
--
--  De rechten van de kassa en de rechten van de medewerker zijn twee
--  verschillende dingen, en dat is precies waar dit misging. In de app wordt
--  gekeken of degene die er staat mag klokken; de database kijkt naar het
--  apparaat dat het verzoek stuurt. Beide horen te kloppen, en van die tweede
--  was niemand zich bewust.
--
--  Waarom juist dit recht, en niet meer
--  ------------------------------------
--
--  Klokken is het enige wat een kassa doet en wat niet elders kan: mensen
--  klokken in bij het apparaat waar ze langslopen. Alles wat de kassa verder
--  wegschrijft -- bonnen, kasmutaties, kluisboekingen, wasopdrachten, voorraad
--  -- komt al langs op is_staff() plus de eigen vestiging, en dat heeft dit
--  dossier.
--
--  pos.manage krijgt hij níet. Dat zou betekenen dat de inloggegevens van een
--  tablet achter de balie genoeg zijn om prijzen te wijzigen. Wat daar nog wél
--  aan vastzit staat onderaan dit bestand.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De kassa's die er al staan
-- ---------------------------------------------------------------------------

update public.profiles
   set grants = (
     select array_agg(distinct g)
       from unnest(coalesce(grants, array[]::text[]) || array['hours.clock']) as g
   )
 where is_device
   and not ('hours.clock' = any(coalesce(grants, array[]::text[])));

-- ---------------------------------------------------------------------------
--  En de kassa's die er nog bij komen
--
--  De serverfunctie kassa-koppelen zet dit recht ook zelf op het dossier. Deze
--  trigger is de rem eronder: hij vult het aan als het er niet op staat.
--
--  Twee plekken voor hetzelfde is meestal een fout, hier niet. De functie is de
--  gewone weg; deze trigger vangt de gevallen die daar niet langskomen -- een
--  dossier dat met de hand op is_device wordt gezet, of een kassa die gekoppeld
--  is met een oudere versie van de functie. Een kassa waarvan de uren stil
--  wegvallen is te duur om van één plek af te laten hangen.
-- ---------------------------------------------------------------------------

create or replace function public.apparaat_mag_klokken()
returns trigger language plpgsql as $$
begin
  if new.is_device
     and not ('hours.clock' = any(coalesce(new.grants, array[]::text[])))
  then
    new.grants := coalesce(new.grants, array[]::text[]) || array['hours.clock'];
  end if;
  return new;
end;
$$;

/*
 * Vóór profiles_apparaat, want die controleert wat er op het dossier staat en
 * deze vult het aan. Triggers met dezelfde tijd lopen op alfabet, en
 * "profiles_apparaat_klokken" komt na "profiles_apparaat" -- dus krijgt hij een
 * naam die eerder komt. Dat is lelijk en het staat er daarom bij.
 */
drop trigger if exists profiles_a_klokken on public.profiles;
create trigger profiles_a_klokken before insert or update on public.profiles
  for each row execute function public.apparaat_mag_klokken();

-- ---------------------------------------------------------------------------
--  Wat de kassa hierna nog steeds niet mag, en waarom dat een keuze is
--
--  Twee schermen in de kassa schrijven naar tabellen die mag_kassa_beheren()
--  vragen, en dat heeft een apparaataccount niet:
--
--    Beheer -> Artikelen        pos_products
--    Beheer -> Nummers, badges  pos_pins
--
--  Die blijven dus weigeren. Dat is geen vergissing maar het is ook niet af:
--  een scherm dat invoer aanneemt en het daarna niet kan opslaan, is dezelfde
--  soort fout als de inklokking die verdween -- alleen valt hij nu wél op,
--  want de kassa laat sinds 0.10.0 zien wat er in de wachtrij vastzit.
--
--  Er zijn twee eerlijke uitkomsten, en het is een keuze welke:
--
--    1. Prijzen en badges horen bij het kantoor, zoals vestigingen, kassa's en
--       kluizen. Dan gaan die twee schermen uit de kassa en komen ze in het
--       dashboard.
--    2. De kassa mag het. Dan krijgt het apparaataccount pos.manage, en zijn de
--       inloggegevens van een tablet achter de balie genoeg om prijzen te
--       wijzigen.
--
--  Zolang die keuze niet gemaakt is, doet deze migratie het minste van de twee:
--  klokken werkt, en prijzen blijven waar ze zijn.
-- ---------------------------------------------------------------------------

-- ===========================================================================
--  Een verwijdering moet zichzelf melden
--
--  Wat er gebeurde
--  ---------------
--
--  Op een werkplek stonden twee meldingen eeuwig in de wachtrij:
--
--    notifications  nt_sg_6fef2842...  111 pogingen
--    notifications  nt_sg_c2606e6b...  111 pogingen
--    "new row violates row-level security policy for table notifications"
--
--  Die twee waren gemaakt door de edge function kassa-koppelen bij een
--  aanmelding van een kassa, en door diezelfde functie weer weggehaald zodra
--  de kassa gekoppeld was (kassa-koppelen/index.ts, regel 425):
--
--    await admin.from('notifications').delete().eq('id', `nt_sg_${...}`)
--
--  Op de server klopte dat. Alleen: het ophalen vraagt om alles wat sinds de
--  vorige keer is veranderd, en een rij die er niet meer is verandert nooit
--  meer. De werkplek hield dus twee meldingen die nergens anders bestonden.
--
--  Daarna ging het pas mis. Zodra iemand ze als gelezen aanvinkte, ging er een
--  wijziging de wachtrij in. PostgREST maakt van een wijziging op een
--  verdwenen rij een nieuwe rij, en dan geldt de insert-regel:
--
--    bericht_bestaat(id) or (from_user_id = my_id() and ...)
--
--  Het origineel bestond niet meer, dus die eerste helft was onwaar. En de
--  afzender was de edge function en niet degene die zat te klikken, dus de
--  tweede ook. Terecht geweigerd -- en daarmee een regel die nooit meer weg
--  zou gaan.
--
--  De oorzaak, en waar hij zit
--  ---------------------------
--
--  0032 heeft hiervoor de verwijderlijst gemaakt: schrijf bij een verwijdering
--  op wélke rij van wélke tabel weg is, dan kan het ophalen dat doorgeven. Die
--  lijst werd alleen met de hand gevuld, op de plekken waar toen aan gedacht
--  is -- bij het wissen van een medewerker. Elke andere verwijdering, waar dan
--  ook vandaan, bleef stil.
--
--  Dus niet kassa-koppelen aanpassen. Dat repareert dit ene geval en laat de
--  volgende open. Een trigger op de tabel vangt élke verwijdering: uit een
--  edge function, uit de SQL-editor, uit een andere app, of uit een migratie.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De trigger
--
--  security definer, want wie de rij mag verwijderen hoeft daarmee nog geen
--  schrijfrecht op de verwijderlijst te hebben. Zonder dat zou een verwijdering
--  die wél is toegestaan alsnog stukbreken op het opschrijven ervan.
--
--  Hij mag nooit de verwijdering zelf tegenhouden. Vandaar de exception-vanger:
--  een rij die niet in de lijst komt is vervelend, een rij die niet weg kan is
--  erger.
-- ---------------------------------------------------------------------------

create or replace function public.meld_verwijdering()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.deletion_log (id, soort, tabel, record_id, naam, reden)
    values (
      'dl_' || replace(gen_random_uuid()::text, '-', ''),
      tg_table_name,
      tg_table_name,
      old.id,
      -- Een naam als de tabel er een heeft, anders het id. De lijst wordt ook
      -- door mensen gelezen.
      coalesce(
        case when to_jsonb(old) ? 'name'  then to_jsonb(old)->>'name'
             when to_jsonb(old) ? 'title' then to_jsonb(old)->>'title'
             when to_jsonb(old) ? 'naam'  then to_jsonb(old)->>'naam'
        end,
        old.id),
      'verwijderd');
  exception when others then
    -- Nooit de verwijdering blokkeren om het logboek.
    null;
  end;
  return old;
end;
$$;

comment on function public.meld_verwijdering() is
  'Schrijft elke verwijdering in deletion_log, zodat het ophalen hem kan '
  'doorgeven. Zonder dit houdt elk apparaat een rij die nergens meer bestaat, '
  'en probeert die bij de eerste wijziging terug te schrijven.';

-- ---------------------------------------------------------------------------
--  Waar hij op staat
--
--  De tabellen waar de server rijen weghaalt achter de app om, en waar de app
--  een eigen kopie van bewaart. notifications is de gemeten aanleiding;
--  signups gaat langs dezelfde weg -- kassa-koppelen raakt ze allebei aan.
--
--  Niet op alles gezet. Een trigger op elke tabel klinkt grondig, maar dan
--  loopt de verwijderlijst vol met rijen waar geen apparaat een kopie van
--  heeft, en wordt het ophalen duurder zonder dat iemand er iets aan heeft.
-- ---------------------------------------------------------------------------

drop trigger if exists notifications_verwijderd on public.notifications;
create trigger notifications_verwijderd
  after delete on public.notifications
  for each row execute function public.meld_verwijdering();

drop trigger if exists signups_verwijderd on public.signups;
create trigger signups_verwijderd
  after delete on public.signups
  for each row execute function public.meld_verwijdering();

-- ---------------------------------------------------------------------------
--  De twee die er al stonden
--
--  Ze zijn weggehaald voordat deze trigger bestond, dus staan ze in geen
--  enkele verwijderlijst. Voor de apparaten die ze nog hebben is dat het
--  verschil tussen "gaat vanzelf over" en "blijft eeuwig hangen".
--
--  Alleen die twee met de hand toevoegen zou dit ene geval oplossen. Beter is
--  de hele klasse: elke melding die met nt_sg_ begint hoort bij een
--  kassa-aanmelding en wordt door kassa-koppelen weggehaald zodra de kassa
--  gekoppeld is. Voor elke kassa die al gekoppeld is, staat die melding dus
--  nergens meer -- terwijl een werkplek hem nog kan hebben.
--
--  We weten niet welke ids dat waren; die rijen zijn weg. Maar we weten wel
--  welke aanmeldingen er zijn geweest, en het id was daaruit af te leiden:
--  'nt_sg_' plus het aanmeld-id zonder streepjes.
-- ---------------------------------------------------------------------------

insert into public.deletion_log (id, soort, tabel, record_id, naam, reden)
select
  'dl_sg_' || replace(s.id, '-', ''),
  'notifications',
  'notifications',
  'nt_sg_' || replace(s.id, '-', ''),
  'Aanmelding ' || coalesce(s.name, s.id),
  'de kassa is gekoppeld; de melding is toen weggehaald'
from public.signups s
where not exists (
        select 1 from public.notifications n
         where n.id = 'nt_sg_' || replace(s.id, '-', ''))
  and not exists (
        select 1 from public.deletion_log d
         where d.tabel = 'notifications'
           and d.record_id = 'nt_sg_' || replace(s.id, '-', ''))
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
--  En de twee die niemand meer kan afleiden
--
--  De regel hierboven leidt het meldings-id af uit de aanmelding. Dat werkt
--  alleen zolang die aanmelding er nog staat -- en bij deze twee is ook die
--  weg. Ze zijn afgelezen van een werkplek waar ze vastzaten:
--
--    notifications  nt_sg_6fef28421615442aa565a91e03cdc657  111 pogingen
--    notifications  nt_sg_c2606e6bf5b54f1380dce4748bcb90a6  111 pogingen
--
--  Twee ids met de hand in een migratie is lelijk, en dat is het eerlijke
--  woord ervoor. Het alternatief is een werkplek die blijft klagen over twee
--  meldingen die nergens meer bestaan, en dat is erger. Voor elk apparaat dat
--  ze niet heeft is dit een regel die niets doet.
-- ---------------------------------------------------------------------------

insert into public.deletion_log (id, soort, tabel, record_id, naam, reden)
values
  ('dl_nt_6fef28421615442aa565a91e03cdc657', 'notifications', 'notifications',
   'nt_sg_6fef28421615442aa565a91e03cdc657', 'Aanmelding van een kassa',
   'weggehaald bij het koppelen, voordat verwijderingen werden gemeld'),
  ('dl_nt_c2606e6bf5b54f1380dce4748bcb90a6', 'notifications', 'notifications',
   'nt_sg_c2606e6bf5b54f1380dce4748bcb90a6', 'Aanmelding van een kassa',
   'weggehaald bij het koppelen, voordat verwijderingen werden gemeld')
on conflict (id) do nothing;

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

-- ===========================================================================
--  Bijwerken is nog steeds geen aanmaken -- nu op alle tabellen
--
--  "De database weigert dit voor X: new row violates row-level security
--  policy" is in dit project inmiddels vijf keer gemeld, elke keer op een
--  andere tabel: log_events, tickets, notifications, en nu channels. Steeds
--  dezelfde oorzaak, steeds één tabel tegelijk gerepareerd. Dat is vier keer
--  het symptoom behandelen.
--
--  Wat er aan de hand is
--  ---------------------
--
--  De app stuurt wijzigingen als een upsert: "zet deze rij neer, en bestaat
--  hij al, werk hem dan bij". PostgREST beoordeelt zo'n verzoek altijd óók
--  tegen de insert-regel -- ook als het feitelijk een bijwerking is.
--
--  Het gevolg: je mag een rij wijzigen, je mag hem niet aanmaken, en dus
--  wordt je wijziging geweigerd. De foutmelding zegt "new row", terwijl er
--  geen nieuwe rij is.
--
--  In de praktijk gebeurt dat zo. Iemand haalt een overlegkanaal op, leest het
--  laatste bericht, en de app schrijft terug wanneer hij het gelezen heeft. Op
--  dat moment is hij geen beheerder van dat kanaal -- hij hoeft het ook niet
--  aan te maken, het bestaat al -- maar de insert-regel kijkt daar niet naar.
--
--  De oplossing die er al was
--  --------------------------
--
--  0031 heeft daarvoor rij_bestaat() gemaakt: bestaat de rij al, dan mag het
--  verzoek door, en beslist de update-regel wat er werkelijk gewijzigd mag
--  worden. Dat geeft dus niets weg -- wie niets mag wijzigen, wijzigt nog
--  steeds niets. Het haalt alleen de verkeerde vraag weg.
--
--  Die reparatie is toen op zes tabellen gezet. Gemeten vandaag: dertien
--  tabellen hebben hem nog steeds niet.
--
--    dev_plans   documents   faults   mailbox   profiles   signups
--    stock_movements   time_entries   wash_jobs
--    pos_safe_moves   pos_sales   pos_subscriptions   pos_subscription_uses
--
--  Hier krijgen ze hem alle dertien. De oorspronkelijke regel blijft er
--  woordelijk in staan -- er komt alleen een uitweg vóór, voor het geval de
--  rij er al is.
--
--  log_events staat er niet bij: die laat invoegen al onvoorwaardelijk toe.
--
--  Over de pos_-tabellen
--  ---------------------
--
--  Die horen bij de kassa. Dit raakt geen enkele regel over wie wat mag: de
--  toegevoegde tak staat alleen toe wat de update-regel van diezelfde tabel al
--  toestond. Ze staan er wel bij, want een klasse half repareren is precies
--  hoe dit vier keer eerder is teruggekomen.
--
--  Vanaf nu bewaakt scripts/sqltest.mjs dit: komt er een tabel bij zonder de
--  uitweg, dan valt de bouw om in plaats van dat iemand er over een half jaar
--  tegenaan loopt.
--
--  Opnieuw draaien mag.
-- ===========================================================================

drop policy if exists dev_plans_insert on public.dev_plans;
create policy dev_plans_insert on public.dev_plans for insert to authenticated
  with check (
    public.rij_bestaat('public.dev_plans'::regclass, id::text)
    or (public.mag_plannen())
  );

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert to authenticated
  with check (
    public.rij_bestaat('public.documents'::regclass, id::text)
    or (public.is_management())
  );

drop policy if exists faults_insert on public.faults;
create policy faults_insert on public.faults for insert to authenticated
  with check (
    public.rij_bestaat('public.faults'::regclass, id::text)
    or (public.is_staff() and public.in_my_locations(location_id))
  );

drop policy if exists mailbox_insert on public.mailbox;
create policy mailbox_insert on public.mailbox for insert to authenticated
  with check (
    public.rij_bestaat('public.mailbox'::regclass, id::text)
    or (public.is_management() or public.is_developer())
  );

drop policy if exists pos_safe_moves_insert on public.pos_safe_moves;
create policy pos_safe_moves_insert on public.pos_safe_moves for insert to authenticated
  with check (
    public.rij_bestaat('public.pos_safe_moves'::regclass, id::text)
    or (public.is_staff() and public.in_my_locations(location_id))
  );

drop policy if exists pos_sales_insert on public.pos_sales;
create policy pos_sales_insert on public.pos_sales for insert to authenticated
  with check (
    public.rij_bestaat('public.pos_sales'::regclass, id::text)
    or (public.is_staff() and public.in_my_locations(location_id))
  );

drop policy if exists pos_subscription_uses_insert on public.pos_subscription_uses;
create policy pos_subscription_uses_insert on public.pos_subscription_uses for insert to authenticated
  with check (
    public.rij_bestaat('public.pos_subscription_uses'::regclass, id::text)
    or (public.is_staff())
  );

drop policy if exists pos_subscriptions_insert on public.pos_subscriptions;
create policy pos_subscriptions_insert on public.pos_subscriptions for insert to authenticated
  with check (
    public.rij_bestaat('public.pos_subscriptions'::regclass, id::text)
    or (public.is_staff() and public.in_my_locations(location_id))
  );

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
  with check (
    public.rij_bestaat('public.profiles'::regclass, id::text)
    or (public.is_management())
  );

drop policy if exists signups_insert on public.signups;
create policy signups_insert on public.signups for insert to authenticated
  with check (
    public.rij_bestaat('public.signups'::regclass, id::text)
    or (public.is_management())
  );

drop policy if exists stock_insert on public.stock_movements;
create policy stock_insert on public.stock_movements for insert to authenticated
  with check (
    public.rij_bestaat('public.stock_movements'::regclass, id::text)
    or (public.is_staff())
  );

drop policy if exists time_insert on public.time_entries;
create policy time_insert on public.time_entries for insert to authenticated
  with check (
    public.rij_bestaat('public.time_entries'::regclass, id::text)
    or (public.is_management() or public.heeft_recht('hours.clock'))
  );

drop policy if exists wash_jobs_insert on public.wash_jobs;
create policy wash_jobs_insert on public.wash_jobs for insert to authenticated
  with check (
    public.rij_bestaat('public.wash_jobs'::regclass, id::text)
    or (public.is_staff() or company_id = public.my_company())
  );
