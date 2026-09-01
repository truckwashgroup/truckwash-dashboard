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
