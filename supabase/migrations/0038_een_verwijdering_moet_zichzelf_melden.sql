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
