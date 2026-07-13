-- Add Labor Rate Standards columns to settings table
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS annual_paid_hours numeric NOT NULL DEFAULT 2080,
  ADD COLUMN IF NOT EXISTS billable_utilization_percent numeric NOT NULL DEFAULT 65.00,
  ADD COLUMN IF NOT EXISTS annual_truck_field_cost numeric NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS target_overhead_percent numeric NOT NULL DEFAULT 35.00,
  ADD COLUMN IF NOT EXISTS target_operating_profit_percent numeric NOT NULL DEFAULT 10.00,
  ADD COLUMN IF NOT EXISTS labor_rate_rounding_increment numeric NOT NULL DEFAULT 5;
