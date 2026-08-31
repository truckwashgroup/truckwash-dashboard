-- ===========================================================================
--  Losse rechten tellen ook mee in het overleg
--
--  Draai dit ná 0007. Opnieuw draaien mag.
--
--  Aanleiding: de app en de database waren het niet helemaal eens over wie
--  een vestigingskanaal mag lezen.
--
--  De app kijkt naar de effectieve rechten van iemand: wat zijn rollen geven,
--  plus wat er met de hand is toegekend, min wat er is ingetrokken. Iemand die
--  het recht "alle vestigingen" los toegekend krijgt, ziet in de app dus alle
--  kanalen.
--
--  De database keek alleen naar het vinkje all_locations en naar de rol
--  management. Gevolg: zo iemand ziet het kanaal wél staan, typt een bericht,
--  en krijgt bij het versturen te horen dat hij er niet bij mag. Dat is de
--  vervelendste soort fout -- je ziet iets, en pas achteraf blijkt dat het
--  niet mocht.
--
--  Hieronder leest de database dezelfde lijstjes als de app, in dezelfde
--  volgorde: het vinkje wint, daarna je eigen vestiging, daarna waar je
--  leiding geeft, en pas dan het recht "alle vestigingen" -- dat laatste
--  alleen als het niet is ingetrokken. Intrekken wint van toekennen, precies
--  zoals in de app.
-- ===========================================================================

create or replace function public.can_see_channel(channel text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.channels c
      join public.profiles p on p.auth_id = auth.uid()
     where c.id = channel
       and p.active
       and (
         -- Lid van het kanaal: dat is genoeg, ook als het besloten is.
         p.id = any(c.member_ids)

         or (
           c.private = false
           and (
             -- Een gewoon kanaal is voor iedereen die mee mag doen.
             c.kind <> 'vestiging'

             -- Het hoofdkantoor komt overal.
             or p.all_locations

             -- Je eigen vestiging, en die waar je leiding geeft.
             or c.location_id = p.location_id
             or c.location_id = any(coalesce(p.manages, array[]::text[]))

             -- Het recht "alle vestigingen": van de rol management of los
             -- toegekend, maar niet als het is ingetrokken.
             or (
               not ('locations.all' = any(coalesce(p.revokes, array[]::text[])))
               and (
                 'management' = any(coalesce(p.roles, array[]::text[]))
                 or 'locations.all' = any(coalesce(p.grants, array[]::text[]))
               )
             )
           )
         )
       )
  );
$$;

grant execute on function public.can_see_channel(text) to authenticated;
