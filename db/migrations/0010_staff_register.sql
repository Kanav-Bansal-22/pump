-- 0010_staff_register: owner asked for one simple register page used the same way by everyone.
-- Staff may now enter the 8 AM rates, see customers' udhari balances, and end a CLEAN day.
-- Ending a day with problems (missing readings / flags) still needs the owner's written reason
-- (closing.override stays owner-only).
INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('STAFF', 'price.set'),
  ('STAFF', 'customer.view_balance'),
  ('STAFF', 'closing.lock')
ON CONFLICT DO NOTHING;
