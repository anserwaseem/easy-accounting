-- update triggers with correct timzone

CREATE VIEW IF NOT EXISTS tz AS SELECT '+05:00' AS tz;

DROP TRIGGER IF EXISTS after_insert_ledger_add_timestamp;
DROP TRIGGER IF EXISTS after_update_ledger_add_timestamp;
DROP TRIGGER IF EXISTS after_insert_account_add_timestamp;
DROP TRIGGER IF EXISTS after_update_account_add_timestamp;
DROP TRIGGER IF EXISTS after_insert_chart_add_timestamp;
DROP TRIGGER IF EXISTS after_update_chart_add_timestamp;
DROP TRIGGER IF EXISTS after_insert_user_add_timestamp;
DROP TRIGGER IF EXISTS after_update_user_add_timestamp;

-- TRIGGERS --
-- ledger
CREATE TRIGGER IF NOT EXISTS after_insert_ledger_add_timestamp
AFTER INSERT ON ledger
BEGIN
  UPDATE ledger SET
    createdAt = datetime(CURRENT_TIMESTAMP, (SELECT tz FROM tz)),
    updatedAt = datetime(CURRENT_TIMESTAMP, (SELECT tz FROM tz))
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS after_update_ledger_add_timestamp
AFTER UPDATE ON ledger
BEGIN
  UPDATE ledger SET
    updatedAt = datetime(CURRENT_TIMESTAMP, (SELECT tz FROM tz))
  WHERE id = NEW.id;
END;

-- account
CREATE TRIGGER IF NOT EXISTS after_insert_account_add_timestamp
AFTER INSERT ON account
BEGIN
  UPDATE account SET
    createdAt = datetime(CURRENT_TIMESTAMP, (SELECT tz FROM tz)),
    updatedAt = datetime(CURRENT_TIMESTAMP, (SELECT tz FROM tz))
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS after_update_account_add_timestamp
AFTER UPDATE ON account
BEGIN
  UPDATE account SET
    updatedAt = datetime(CURRENT_TIMESTAMP, (SELECT tz FROM tz))
  WHERE id = NEW.id;
END;

-- chart
CREATE TRIGGER IF NOT EXISTS after_insert_chart_add_timestamp
AFTER INSERT ON chart
BEGIN
  UPDATE chart SET
    createdAt = datetime(CURRENT_TIMESTAMP, (SELECT tz FROM tz)),
    updatedAt = datetime(CURRENT_TIMESTAMP, (SELECT tz FROM tz))
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS after_update_chart_add_timestamp
AFTER UPDATE ON chart
BEGIN
  UPDATE chart SET
    updatedAt = datetime(CURRENT_TIMESTAMP, (SELECT tz FROM tz))
  WHERE id = NEW.id;
END;

-- users
CREATE TRIGGER IF NOT EXISTS after_insert_users_add_timestamp
AFTER INSERT ON users
BEGIN
  UPDATE users SET
    createdAt = datetime(CURRENT_TIMESTAMP, (SELECT tz FROM tz)),
    updatedAt = datetime(CURRENT_TIMESTAMP, (SELECT tz FROM tz))
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS after_update_users_add_timestamp
AFTER UPDATE ON users
BEGIN
  UPDATE users SET
    updatedAt = datetime(CURRENT_TIMESTAMP, (SELECT tz FROM tz))
  WHERE id = NEW.id;
END;
