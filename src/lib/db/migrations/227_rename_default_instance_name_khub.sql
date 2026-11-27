-- KHUB rebrand: rename the stock default instance name for existing installs.
-- `updateSettings()` stores values as JSON, so the stock default is the literal
-- `"OmniRoute"` (with quotes). Only that exact value is rewritten: a custom
-- instanceName chosen by an operator never matches and is left untouched.
-- Idempotent — a second run updates no rows.
UPDATE key_value
SET value = '"KHUB"'
WHERE namespace = 'settings'
  AND key = 'instanceName'
  AND value = '"OmniRoute"';