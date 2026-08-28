-- ===========================================================================
--  Startgegevens: klanten en voorraadartikelen.
--
--  Draai dit ná 0001_init.sql. Gebruikers staan hier bewust niet in: die
--  maak je aan via Authentication -> Users in Supabase, waarna de trigger
--  automatisch een profiel aanmaakt.
--
--  Opnieuw draaien is veilig: bestaande rijen worden bijgewerkt, niet
--  gedupliceerd.
-- ===========================================================================

insert into public.companies (id, name, contact, email, phone, city, contract_discount_pct) values
  ('co_jansen',    'Transport Jansen B.V.',  'Mark Jansen',    'planning@transportjansen.nl',     '030-1234567', 'Utrecht',   10),
  ('co_devries',   'De Vries Logistiek',     'Sanne de Vries', 'wagenpark@devrieslogistiek.nl',   '010-7654321', 'Rotterdam',  5),
  ('co_koeltrans', 'KoelTrans Nederland',    'Ahmed Yilmaz',   'info@koeltrans.nl',               '040-2223344', 'Eindhoven', 12),
  ('co_bulk',      'BulkLine Tankvervoer',   'Petra Bos',      'planning@bulkline.nl',            '050-9988776', 'Groningen',  8)
on conflict (id) do update set
  name                  = excluded.name,
  contact               = excluded.contact,
  email                 = excluded.email,
  phone                 = excluded.phone,
  city                  = excluded.city,
  contract_discount_pct = excluded.contract_discount_pct;

insert into public.inventory_items (id, name, unit, stock, min_stock, price_per_unit, supplier) values
  ('inv_shampoo',     'Truckshampoo concentraat', 'liter', 240, 100, 3.85, 'CleanChem BV'),
  ('inv_ontvetter',   'Alkalische ontvetter',     'liter',  68,  80, 5.40, 'CleanChem BV'),
  ('inv_velgen',      'Velgenreiniger zuur',      'liter',  45,  30, 6.20, 'CleanChem BV'),
  ('inv_wax',         'Droogwax / glansmiddel',   'liter', 112,  60, 4.75, 'Nordic Wash'),
  ('inv_borstel',     'Wasborstel telescoop',     'stuk',    7,   4, 42.00, 'WashParts NL'),
  ('inv_doek',        'Microvezeldoek',           'stuk',  180, 100, 1.35, 'WashParts NL'),
  ('inv_zout',        'Onthardingszout',          'kg',    520, 250, 0.42, 'AquaSoft'),
  ('inv_handschoen',  'Nitril handschoenen',      'doos',    9,  12, 8.90, 'SafetyFirst')
on conflict (id) do update set
  name           = excluded.name,
  unit           = excluded.unit,
  min_stock      = excluded.min_stock,
  price_per_unit = excluded.price_per_unit,
  supplier       = excluded.supplier;

-- ---------------------------------------------------------------------------
--  Rollen toekennen
--
--  Nadat je in Authentication -> Users een gebruiker hebt aangemaakt, geef je
--  die hier de juiste rollen. Vervang het e-mailadres en draai de regel.
--
--    'employee'   -> knop Werknemers
--    'customer'   -> knop Klanten
--    'management' -> knop Management (de derde knop)
-- ---------------------------------------------------------------------------

-- Voorbeeld: jezelf alle drie de dashboards geven.
--
-- update public.profiles
--    set roles = array['employee','customer','management']::text[],
--        name  = 'Casper'
--  where email = 'casper@truckwash1group.nl';

-- Voorbeeld: een wasser.
--
-- update public.profiles
--    set roles = array['employee','customer']::text[],
--        name  = 'Tom Verhoeven',
--        hourly_rate = 22
--  where email = 'tom@truckwash1group.nl';

-- Voorbeeld: een klantaccount koppelen aan een bedrijf.
--
-- update public.profiles
--    set roles      = array['customer']::text[],
--        name       = 'Mark Jansen',
--        company_id = 'co_jansen'
--  where email = 'planning@transportjansen.nl';
