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
