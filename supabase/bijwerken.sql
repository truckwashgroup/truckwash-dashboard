-- ===========================================================================
--  Bijwerken: migratie 0017 tot en met 0022
--
--  Plak dit in de SQL-editor van Supabase en druk op Run.
--
--  Opnieuw draaien mag: alles hieronder is zo geschreven dat het niets stuk
--  maakt als het er al staat. Twijfel je of je een eerdere migratie hebt
--  gedraaid, neem dan supabase/setup.sql -- dat is het geheel, en dat mag
--  ook opnieuw.
--
--  Wat erin zit:
--    0017  een werkgever en zijn chauffeur mogen elkaar bereiken
--    0018  in- en uitklokken gaat via de kassa
--    0019  een bericht als gelezen kunnen melden
--    0020  van melding naar plan
--    0021  je maakt jezelf geen management meer (belangrijk)
--    0022  bijwerken is geen aanmaken -- de bonnen uit de mail
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
