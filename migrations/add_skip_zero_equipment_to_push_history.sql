ALTER TABLE push_history
  ADD COLUMN IF NOT EXISTS skip_zero_equipment BOOLEAN NOT NULL DEFAULT false;
