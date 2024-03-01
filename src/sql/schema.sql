BEGIN TRANSACTION;

-- TABLES --

-- Drop todos table
DROP TABLE IF EXISTS "todos";
CREATE TABLE IF NOT EXISTS "todos" (
	"id"	INTEGER,
	"title"	TEXT,
	"date"	TEXT,
	"status"	INTEGER,
	PRIMARY KEY("id" AUTOINCREMENT)
);

DROP TABLE IF EXISTS "users";
CREATE TABLE IF NOT EXISTS "users" (
	"id"	INTEGER,
	"username"	TEXT UNIQUE,
	"password_hash"	TEXT,
	"status"	INTEGER DEFAULT 0,
  "createdAt"	DATETIME,
  "updatedAt"	DATETIME,

	PRIMARY KEY("id" AUTOINCREMENT)
);


DROP TABLE IF EXISTS "chart";
CREATE TABLE IF NOT EXISTS "chart" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "date" DATETIME NOT NULL,
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
  "date" DATETIME NOT NULL,
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
  "description" STRING NOT NULL,
  "isPosted" BOOLEAN NOT NULL DEFAULT 0

);

DROP TABLE IF EXISTS "ledger";
CREATE TABLE IF NOT EXISTS "ledger" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "date" DATETIME NOT NULL,
  "particulars" STRING NOT NULL,
  "accountId" INTEGER,
  "journalId" INTEGER NULL,
  "debit" DECIMAL DEFAULT 0,
  "credit" DECIMAL DEFAULT 0,
  "balance" DECIMAL NOT NULL DEFAULT 0,
  "balanceType" STRING NOT NULL,
  "createdAt"	DATETIME,
  "updatedAt"	DATETIME,

  FOREIGN KEY("accountId") REFERENCES "account"("id"),
  FOREIGN KEY("journalId") REFERENCES "journal"("id"),

  CHECK ("balanceType" IN ('Cr', 'Dr'))
);




-- TRIGGERS --
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



COMMIT;
