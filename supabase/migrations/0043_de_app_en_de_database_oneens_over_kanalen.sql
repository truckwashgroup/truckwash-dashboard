-- ===========================================================================
--  De app en de database waren het oneens over wie een kanaal mag maken
--
--  Gemeld: drieëntwintig overlegkanalen, honderd pogingen elk, allemaal
--  geweigerd met "new row violates row-level security policy for table
--  channels". De kanalen deugden, de regel deugde, en toch kwam er niets door.
--
--  Wat er aan de hand was
--  ----------------------
--
--  Twee plekken beslissen of je een kanaal mag aanmaken, en ze kijken naar
--  verschillende dingen.
--
--    de app         perms.can('chat.manage')  -- een RECHT
--    de database    is_management() or is_supervisor()  -- een ROL
--
--  Zolang die twee samenvallen merkt niemand het. Maar het recht chat.manage
--  is ook los toe te kennen aan iemand zonder die rollen, en dan zegt de app
--  ja en de database nee.
--
--  Het gevolg is erger dan een geweigerde knop. Het overlegscherm zet bij het
--  eerste bezoek de vaste kanalen klaar -- vijf algemene plus een per
--  vestiging. Sinds er achttien vestigingen in staan zijn dat er drieëntwintig
--  in één keer. Allemaal lokaal aangemaakt, allemaal de wachtrij in, en
--  allemaal voor altijd geweigerd.
--
--  Nagemeten in de testdatabase, met dezelfde regels en dezelfde rijen:
--
--    management     mag
--    leidinggevende mag
--    medewerker     new row violates row-level security policy
--
--  Woordelijk de melding uit productie.
--
--  Wat hier verandert
--  ------------------
--
--  De database gaat naar hetzelfde kijken als de app: het recht. De rollen
--  blijven staan -- management en een leidinggevende hebben chat.manage toch
--  al, dus voor hen verandert er niets, en zonder die takken zou een verkeerd
--  gezette instelling het hele overleg op slot zetten.
--
--  heeft_recht() is precies waarvoor dit soort gevallen bestaat; het wordt in
--  dit schema al gebruikt voor hours.clock en admin.desk.
--
--  Waarom niet andersom -- de app strenger maken
--  ---------------------------------------------
--
--  Dan zou een los toegekend recht in de app zichtbaar zijn en niet werken, en
--  dat is precies het soort stilte waar dit probleem uit voortkwam. Eén plek
--  hoort te beslissen, en dat is de database.
--
--  Opnieuw draaien mag.
-- ===========================================================================

drop policy if exists channels_insert on public.channels;
create policy channels_insert on public.channels for insert to authenticated
  with check (
    -- De uitweg voor de upsert-val; zie 0031 en 0040.
    public.rij_bestaat('public.channels'::regclass, id)
    or (
      public.is_staff()
      and (
        public.is_management()
        or public.is_supervisor()
        or public.heeft_recht('chat.manage')
        -- Een gesprek mag je aanmaken als je er zelf in zit. Dat is geen
        -- beheer maar iemand aanspreken, en daar is geen recht voor nodig.
        or (kind = 'gesprek' and public.my_id() = any(member_ids))
      )
    )
  );

/*
 * En bijwerken op dezelfde voet.
 *
 * Zou dat achterblijven, dan kun je een kanaal aanmaken en daarna de naam niet
 * meer wijzigen -- en dat is precies het soort halve toestemming waar niemand
 * iets aan heeft.
 */
drop policy if exists channels_update on public.channels;
create policy channels_update on public.channels for update to authenticated
  using (
    public.is_management()
    or public.is_supervisor()
    or public.heeft_recht('chat.manage')
    or (kind = 'gesprek' and public.my_id() = any(member_ids))
  )
  with check (
    public.is_management()
    or public.is_supervisor()
    or public.heeft_recht('chat.manage')
    or (kind = 'gesprek' and public.my_id() = any(member_ids))
  );
