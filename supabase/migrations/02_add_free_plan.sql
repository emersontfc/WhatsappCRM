-- Add Free plan to plans table
INSERT INTO public.plans (name, max_connections, max_contacts, max_messages_per_day, ai_enabled, automation_level, price)
VALUES ('Free', 1, 50, 20, false, 'basic', 0)
ON CONFLICT (name) DO UPDATE SET
  max_connections = EXCLUDED.max_connections,
  max_contacts = EXCLUDED.max_contacts,
  max_messages_per_day = EXCLUDED.max_messages_per_day,
  ai_enabled = EXCLUDED.ai_enabled,
  automation_level = EXCLUDED.automation_level,
  price = EXCLUDED.price;

-- Ensure all existing users have a plan assigned
UPDATE public.users SET plan = 'Free' WHERE plan IS NULL;

-- Ensure all existing subscriptions have a plan_id (pointing to Free if missing)
UPDATE public.subscriptions s
SET 
  plan = 'Free',
  plan_id = p.id
FROM public.plans p
WHERE p.name = 'Free' AND (s.plan IS NULL OR s.plan_id IS NULL);
