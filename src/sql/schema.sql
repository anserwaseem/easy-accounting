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
  "type" STRING NOT NULL CHECK ("type" IN ('Asset', 'Liability', 'Equity')), -- 'Revenue', 'Expense' -- "001 migration"
  -- "parentId" INTEGER REFERENCES "chart"("id"), -- only used for custom heads e.g. "Agent abc", would be NULL for normal heads e.g. "Current Asset" -- "006 migration"
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
  "code" INTEGER, -- VARCHAR(40) -- "008 migration"
  -- "address" TEXT, -- "007 migration"
  -- "phone1" VARCHAR(20), -- "007 migration"
  -- "phone2" VARCHAR(20), -- "007 migration"
  -- "goodsName" TEXT, -- "007 migration"
  -- "isActive" BOOLEAN NOT NULL DEFAULT 1, -- "012 migration"
  "createdAt"	DATETIME,
  "updatedAt"	DATETIME,

  FOREIGN KEY("chartId") REFERENCES "chart"("id"),
  UNIQUE("chartId", "name", "code") -- meaning: same account name and code can't be used in the same chart - "011 migration"
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

CREATE TABLE IF NOT EXISTS "inventory" ( -- "002 migration"
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10, 2) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "invoices" ( -- "002 migration"
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "invoiceNumber" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "invoiceType" TEXT NOT NULL CHECK ("invoiceType" IN ('Purchase', 'Sale')),
    "date" DATETIME NOT NULL,
    "totalAmount" DECIMAL(10, 2) NOT NULL,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- "extraDiscount" DECIMAL(10, 4) NOT NULL DEFAULT 0, -- "005 migration"
    -- "biltyNumber" INTEGER, -- "009 migration"
    -- "cartons" INTEGER, -- "009 migration"

    UNIQUE("invoiceNumber", "invoiceType"),
    FOREIGN KEY ("accountId") REFERENCES "account"("id")
);

CREATE TABLE IF NOT EXISTS "invoice_items" ( -- "002 migration"
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "inventoryId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    -- "discount" DECIMAL(10, 2) NOT NULL DEFAULT 0, -- "004 migration"
    -- "accountId" INTEGER DEFAULT NULL, -- "010 migration"
    "price" DECIMAL(10, 2) NOT NULL,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY ("inventoryId") REFERENCES "inventory"("id"),
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id")
    --, FOREIGN KEY ("accountId") REFERENCES "account"("id") -- "010 migration"
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

-- inventory -- "002 migration"
CREATE TRIGGER IF NOT EXISTS after_insert_inventory_add_timestamp
AFTER INSERT ON inventory
BEGIN
  UPDATE inventory SET
    createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
    updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS after_update_inventory_add_timestamp
AFTER UPDATE ON inventory
BEGIN
  UPDATE inventory SET
    updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
  WHERE id = NEW.id;
END;

-- invoices -- "002 migration"
CREATE TRIGGER IF NOT EXISTS after_insert_invoices_add_timestamp
AFTER INSERT ON invoices
BEGIN
  UPDATE invoices SET
    createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
    updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS after_update_invoices_add_timestamp
AFTER UPDATE ON invoices
BEGIN
  UPDATE invoices SET
    updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
  WHERE id = NEW.id;
END;

-- invoice_items -- "003 migration"
CREATE TRIGGER IF NOT EXISTS after_insert_invoice_items_add_timestamp
AFTER INSERT ON invoice_items
BEGIN
  UPDATE invoice_items SET
    createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
    updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS after_update_invoice_items_add_timestamp
AFTER UPDATE ON invoice_items
BEGIN
  UPDATE invoice_items SET
    updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
  WHERE id = NEW.id;
END;

COMMIT;
