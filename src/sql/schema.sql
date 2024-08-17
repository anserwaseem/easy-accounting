BEGIN TRANSACTION;

-- TABLES --

DROP TABLE IF EXISTS "users";
CREATE TABLE IF NOT EXISTS "users" (
	"id" INTEGER PRIMARY KEY AUTOINCREMENT, -- https://github.com/WiseLibs/better-sqlite3/blob/master/docs/tips.md#creating-good-tables
	"username" TEXT UNIQUE,
	"password_hash"	BLOB,
	"status" INTEGER DEFAULT 0,
  "createdAt"	DATETIME,
  "updatedAt"	DATETIME
);


DROP TABLE IF EXISTS "chart";
CREATE TABLE IF NOT EXISTS "chart" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "date" DATETIME,
  "name" STRING NOT NULL,
  "userId" INTEGER,
  "code" INTEGER,
  "type" STRING NOT NULL CHECK ("type" IN ('Asset', 'Liability', 'Equity')),
  "createdAt"	DATETIME,
  "updatedAt"	DATETIME,

  FOREIGN KEY("userId") REFERENCES "users"("id") ON DELETE NO ACTION
);

DROP TABLE IF EXISTS "account";
CREATE TABLE IF NOT EXISTS "account" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "chartId" INTEGER NOT NULL,
  "date" DATETIME,
  "name" STRING NOT NULL,
  "code" INTEGER,
  "createdAt"	DATETIME,
  "updatedAt"	DATETIME,

  FOREIGN KEY("chartId") REFERENCES "chart"("id")
);

DROP TABLE IF EXISTS "journal";
CREATE TABLE IF NOT EXISTS "journal" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "date" DATETIME NOT NULL,
  "narration" STRING NOT NULL,
  "isPosted" BOOLEAN NOT NULL DEFAULT 0,
  "createdAt"	DATETIME,
  "updatedAt"	DATETIME
);

DROP TABLE IF EXISTS "journal_entry";
CREATE TABLE IF NOT EXISTS "journal_entry" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "journalId" INTEGER NOT NULL,
  "debitAmount" DECIMAL DEFAULT 0,
  "creditAmount" DECIMAL DEFAULT 0,
  "accountId" INTEGER NOT NULL,
  "createdAt"	DATETIME,
  "updatedAt"	DATETIME,

  FOREIGN KEY("journalId") REFERENCES "journal"("id"),
  FOREIGN KEY("accountId") REFERENCES "account"("id")
);

DROP TABLE IF EXISTS "ledger";
CREATE TABLE IF NOT EXISTS "ledger" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "date" DATETIME NOT NULL,
  "particulars" STRING NOT NULL,
  "accountId" INTEGER,
  "debit" DECIMAL DEFAULT 0,
  "credit" DECIMAL DEFAULT 0,
  "balance" DECIMAL NOT NULL DEFAULT 0,
  "balanceType" STRING NOT NULL,
  "linkedAccountId" INTEGER,
  "createdAt"	DATETIME,
  "updatedAt"	DATETIME,

  FOREIGN KEY("accountId") REFERENCES "account"("id"),

  CHECK ("balanceType" IN ('Cr', 'Dr'))
);

CREATE TABLE IF NOT EXISTS "journal_ledger" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "journalId" INTEGER NOT NULL,
  "ledgerId" INTEGER NOT NULL,
  FOREIGN KEY("journalId") REFERENCES "journal"("id") ON DELETE CASCADE,
  FOREIGN KEY("ledgerId") REFERENCES "ledger"("id") ON DELETE CASCADE
);


-- TRIGGERS --
-- ledger
CREATE TRIGGER IF NOT EXISTS after_insert_ledger_add_timestamp
AFTER INSERT ON ledger
BEGIN
  UPDATE ledger SET
    createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
    updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS after_update_ledger_add_timestamp
AFTER UPDATE ON ledger
BEGIN
  UPDATE ledger SET
    updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
  WHERE id = NEW.id;
END;

-- account
CREATE TRIGGER IF NOT EXISTS after_insert_account_add_timestamp
AFTER INSERT ON account
BEGIN
  UPDATE account SET
    createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
    updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS after_update_account_add_timestamp
AFTER UPDATE ON account
BEGIN
  UPDATE account SET
    updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
  WHERE id = NEW.id;
END;

-- chart
CREATE TRIGGER IF NOT EXISTS after_insert_chart_add_timestamp
AFTER INSERT ON chart
BEGIN
  UPDATE chart SET
    createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
    updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS after_update_chart_add_timestamp
AFTER UPDATE ON chart
BEGIN
  UPDATE chart SET
    updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
  WHERE id = NEW.id;
END;

-- users
CREATE TRIGGER IF NOT EXISTS after_insert_users_add_timestamp
AFTER INSERT ON users
BEGIN
  UPDATE users SET
    createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
    updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS after_update_users_add_timestamp
AFTER UPDATE ON users
BEGIN
  UPDATE users SET
    updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
  WHERE id = NEW.id;
END;

-- journal
CREATE TRIGGER IF NOT EXISTS after_insert_journal_add_timestamp
AFTER INSERT ON journal
BEGIN
  UPDATE journal SET
    createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
    updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS after_update_journal_add_timestamp
AFTER UPDATE ON journal
BEGIN
  UPDATE journal SET
    updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
  WHERE id = NEW.id;
END;

-- journal_entry
CREATE TRIGGER IF NOT EXISTS after_insert_journal_entry_add_timestamp
AFTER INSERT ON journal_entry
BEGIN
  UPDATE journal_entry SET
    createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
    updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS after_update_journal_entry_add_timestamp
AFTER UPDATE ON journal_entry
BEGIN
  UPDATE journal_entry SET
    updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
  WHERE id = NEW.id;
END;

COMMIT;
