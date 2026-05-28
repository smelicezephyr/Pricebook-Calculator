-- Migration: add push_permission to users
-- Run via: node -e with pool.query (drizzle-kit is interactive/blocking)
-- Applied: 2026-05-28

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS push_permission TEXT NOT NULL DEFAULT 'both'
    CHECK (push_permission IN ('both', 'reprice_only', 'add_new_only'));
