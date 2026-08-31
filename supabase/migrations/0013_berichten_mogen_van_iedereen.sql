-- ===========================================================================
--  Een bericht aan één persoon mag van iedereen komen
--
--  Draai dit ná 0012. Opnieuw draaien mag.
--
--  De regel op `notifications` stamt uit de tijd dat berichten één ding
--  deden: een leidinggevende die zijn team iets liet weten. Vandaar:
--
--      with check (public.is_lead() and from_user_id = public.my_id())
--
--  Sindsdien is de belletjeslade het algemene seinsysteem van de app
--  geworden, en daarmee klopte die regel niet meer. Alles hieronder werd
--  geweigerd:
--
--    * een wasser die een collega noemt in het overleg
--    * een melding aan de ontwikkelaar -- die stuurt bericht naar de dev
--    * een storing melden vanaf de vloer
--    * een medewerker die zijn contract ondertekent, of juist niet
--
--  De fout die je zag -- "new row violates row-level security policy for
--  table notifications" -- kwam daar vandaan, en hij blokkeerde de hele
--  wachtrij omdat het bericht bij de handeling hoort.
--
--  Nieuwe regel, in twee helften:
--
--    naar één persoon   -> iedereen die hier werkt, op eigen naam
--    naar een hele rol  -> alleen een leidinggevende of het management
--
--  Dat tweede blijft eng genoeg: een groepsbericht bereikt iedereen tegelijk
--  en hoort niet bij iemand te kunnen die alleen zijn collega wil bereiken.
-- ===========================================================================

drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert to authenticated
  with check (
    public.is_staff()
    and from_user_id = public.my_id()
    and (
      to_user_id is not null
      or public.is_lead()
    )
  );
