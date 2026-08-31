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
