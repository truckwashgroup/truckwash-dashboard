-- ===========================================================================
--  Bijwerken is nog steeds geen aanmaken -- nu op alle tabellen
--
--  "De database weigert dit voor X: new row violates row-level security
--  policy" is in dit project inmiddels vijf keer gemeld, elke keer op een
--  andere tabel: log_events, tickets, notifications, en nu channels. Steeds
--  dezelfde oorzaak, steeds één tabel tegelijk gerepareerd. Dat is vier keer
--  het symptoom behandelen.
--
--  Wat er aan de hand is
--  ---------------------
--
--  De app stuurt wijzigingen als een upsert: "zet deze rij neer, en bestaat
--  hij al, werk hem dan bij". PostgREST beoordeelt zo'n verzoek altijd óók
--  tegen de insert-regel -- ook als het feitelijk een bijwerking is.
--
--  Het gevolg: je mag een rij wijzigen, je mag hem niet aanmaken, en dus
--  wordt je wijziging geweigerd. De foutmelding zegt "new row", terwijl er
--  geen nieuwe rij is.
--
--  In de praktijk gebeurt dat zo. Iemand haalt een overlegkanaal op, leest het
--  laatste bericht, en de app schrijft terug wanneer hij het gelezen heeft. Op
--  dat moment is hij geen beheerder van dat kanaal -- hij hoeft het ook niet
--  aan te maken, het bestaat al -- maar de insert-regel kijkt daar niet naar.
--
--  De oplossing die er al was
--  --------------------------
--
--  0031 heeft daarvoor rij_bestaat() gemaakt: bestaat de rij al, dan mag het
--  verzoek door, en beslist de update-regel wat er werkelijk gewijzigd mag
--  worden. Dat geeft dus niets weg -- wie niets mag wijzigen, wijzigt nog
--  steeds niets. Het haalt alleen de verkeerde vraag weg.
--
--  Die reparatie is toen op zes tabellen gezet. Gemeten vandaag: dertien
--  tabellen hebben hem nog steeds niet.
--
--    dev_plans   documents   faults   mailbox   profiles   signups
--    stock_movements   time_entries   wash_jobs
--    pos_safe_moves   pos_sales   pos_subscriptions   pos_subscription_uses
--
--  Hier krijgen ze hem alle dertien. De oorspronkelijke regel blijft er
--  woordelijk in staan -- er komt alleen een uitweg vóór, voor het geval de
--  rij er al is.
--
--  log_events staat er niet bij: die laat invoegen al onvoorwaardelijk toe.
--
--  Over de pos_-tabellen
--  ---------------------
--
--  Die horen bij de kassa. Dit raakt geen enkele regel over wie wat mag: de
--  toegevoegde tak staat alleen toe wat de update-regel van diezelfde tabel al
--  toestond. Ze staan er wel bij, want een klasse half repareren is precies
--  hoe dit vier keer eerder is teruggekomen.
--
--  Vanaf nu bewaakt scripts/sqltest.mjs dit: komt er een tabel bij zonder de
--  uitweg, dan valt de bouw om in plaats van dat iemand er over een half jaar
--  tegenaan loopt.
--
--  Opnieuw draaien mag.
-- ===========================================================================

drop policy if exists dev_plans_insert on public.dev_plans;
create policy dev_plans_insert on public.dev_plans for insert to authenticated
  with check (
    public.rij_bestaat('public.dev_plans'::regclass, id::text)
    or (public.mag_plannen())
  );

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert to authenticated
  with check (
    public.rij_bestaat('public.documents'::regclass, id::text)
    or (public.is_management())
  );

drop policy if exists faults_insert on public.faults;
create policy faults_insert on public.faults for insert to authenticated
  with check (
    public.rij_bestaat('public.faults'::regclass, id::text)
    or (public.is_staff() and public.in_my_locations(location_id))
  );

drop policy if exists mailbox_insert on public.mailbox;
create policy mailbox_insert on public.mailbox for insert to authenticated
  with check (
    public.rij_bestaat('public.mailbox'::regclass, id::text)
    or (public.is_management() or public.is_developer())
  );

drop policy if exists pos_safe_moves_insert on public.pos_safe_moves;
create policy pos_safe_moves_insert on public.pos_safe_moves for insert to authenticated
  with check (
    public.rij_bestaat('public.pos_safe_moves'::regclass, id::text)
    or (public.is_staff() and public.in_my_locations(location_id))
  );

drop policy if exists pos_sales_insert on public.pos_sales;
create policy pos_sales_insert on public.pos_sales for insert to authenticated
  with check (
    public.rij_bestaat('public.pos_sales'::regclass, id::text)
    or (public.is_staff() and public.in_my_locations(location_id))
  );

drop policy if exists pos_subscription_uses_insert on public.pos_subscription_uses;
create policy pos_subscription_uses_insert on public.pos_subscription_uses for insert to authenticated
  with check (
    public.rij_bestaat('public.pos_subscription_uses'::regclass, id::text)
    or (public.is_staff())
  );

drop policy if exists pos_subscriptions_insert on public.pos_subscriptions;
create policy pos_subscriptions_insert on public.pos_subscriptions for insert to authenticated
  with check (
    public.rij_bestaat('public.pos_subscriptions'::regclass, id::text)
    or (public.is_staff() and public.in_my_locations(location_id))
  );

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
  with check (
    public.rij_bestaat('public.profiles'::regclass, id::text)
    or (public.is_management())
  );

drop policy if exists signups_insert on public.signups;
create policy signups_insert on public.signups for insert to authenticated
  with check (
    public.rij_bestaat('public.signups'::regclass, id::text)
    or (public.is_management())
  );

drop policy if exists stock_insert on public.stock_movements;
create policy stock_insert on public.stock_movements for insert to authenticated
  with check (
    public.rij_bestaat('public.stock_movements'::regclass, id::text)
    or (public.is_staff())
  );

drop policy if exists time_insert on public.time_entries;
create policy time_insert on public.time_entries for insert to authenticated
  with check (
    public.rij_bestaat('public.time_entries'::regclass, id::text)
    or (public.is_management() or public.heeft_recht('hours.clock'))
  );

drop policy if exists wash_jobs_insert on public.wash_jobs;
create policy wash_jobs_insert on public.wash_jobs for insert to authenticated
  with check (
    public.rij_bestaat('public.wash_jobs'::regclass, id::text)
    or (public.is_staff() or company_id = public.my_company())
  );
