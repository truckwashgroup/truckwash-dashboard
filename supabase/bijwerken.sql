-- ===========================================================================
--  Bijwerken: migratie 0017 tot en met 0025
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
