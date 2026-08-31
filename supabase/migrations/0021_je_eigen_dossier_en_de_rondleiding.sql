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
