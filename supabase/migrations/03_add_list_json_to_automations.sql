-- Add missing columns to automations table if they don't exist
ALTER TABLE automations ADD COLUMN IF NOT EXISTS response_type text DEFAULT 'text';
ALTER TABLE automations ADD COLUMN IF NOT EXISTS buttons_json text;
ALTER TABLE automations ADD COLUMN IF NOT EXISTS list_json text;
ALTER TABLE automations ADD COLUMN IF NOT EXISTS media_url text;
ALTER TABLE automations ADD COLUMN IF NOT EXISTS media_type text;
