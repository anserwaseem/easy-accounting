ALTER TABLE users ADD COLUMN createdAt DATETIME;
ALTER TABLE users ADD COLUMN updatedAt DATETIME;

ALTER TABLE chart ADD COLUMN createdAt DATETIME;
ALTER TABLE chart ADD COLUMN updatedAt DATETIME;

ALTER TABLE account ADD COLUMN createdAt DATETIME;
ALTER TABLE account ADD COLUMN updatedAt DATETIME;

ALTER TABLE journal ADD COLUMN createdAt DATETIME;
ALTER TABLE journal ADD COLUMN updatedAt DATETIME;

ALTER TABLE ledger ADD COLUMN createdAt DATETIME;
ALTER TABLE ledger ADD COLUMN updatedAt DATETIME;


-- Drop all triggers
DROP TRIGGER after_insert_ledger_add_timestamp;
DROP TRIGGER after_update_ledger_add_timestamp;

DROP TRIGGER after_insert_account_add_timestamp;
DROP TRIGGER after_update_account_add_timestamp;

DROP TRIGGER after_insert_chart_add_timestamp;
DROP TRIGGER after_update_chart_add_timestamp;

DROP TRIGGER after_insert_users_add_timestamp;
DROP TRIGGER after_update_users_add_timestamp;

-- Create all triggers
-- ledger
CREATE TRIGGER IF NOT EXISTS after_insert_ledger_add_timestamp
AFTER INSERT ON ledger
BEGIN
  UPDATE ledger SET
    createdAt = CURRENT_TIMESTAMP,
    updatedAt = CURRENT_TIMESTAMP
  WHERE id=NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS after_update_ledger_add_timestamp
AFTER UPDATE ON ledger
BEGIN
  UPDATE ledger SET
    updatedAt = CURRENT_TIMESTAMP WHERE id=NEW.id;
END;

-- account
CREATE TRIGGER IF NOT EXISTS after_insert_account_add_timestamp
AFTER INSERT ON account
BEGIN
  UPDATE account SET
    createdAt = CURRENT_TIMESTAMP,
    updatedAt = CURRENT_TIMESTAMP
  WHERE id=NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS after_update_account_add_timestamp
AFTER UPDATE ON account
BEGIN
  UPDATE account SET
    updatedAt = CURRENT_TIMESTAMP WHERE id=NEW.id;
END;

-- chart
CREATE TRIGGER IF NOT EXISTS after_insert_chart_add_timestamp
AFTER INSERT ON chart
BEGIN
  UPDATE chart SET
    createdAt = CURRENT_TIMESTAMP,
    updatedAt = CURRENT_TIMESTAMP
  WHERE id=NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS after_update_chart_add_timestamp
AFTER UPDATE ON chart
BEGIN
  UPDATE chart SET
    updatedAt = CURRENT_TIMESTAMP WHERE id=NEW.id;
END;

-- users
CREATE TRIGGER IF NOT EXISTS after_insert_users_add_timestamp
AFTER INSERT ON users
BEGIN
  UPDATE users SET
    createdAt = CURRENT_TIMESTAMP,
    updatedAt = CURRENT_TIMESTAMP
  WHERE id=NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS after_update_users_add_timestamp
AFTER UPDATE ON users
BEGIN
  UPDATE users SET
    updatedAt = CURRENT_TIMESTAMP WHERE id=NEW.id;
END;
