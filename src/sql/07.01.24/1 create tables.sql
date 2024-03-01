BEGIN TRANSACTION;
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
	PRIMARY KEY("id" AUTOINCREMENT)
);


DROP TABLE IF EXISTS "chart";
CREATE TABLE IF NOT EXISTS "chart" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "date" DATETIME NOT NULL,
  "name" STRING NOT NULL,
  "code" INTEGER,
  "type" STRING NOT NULL CHECK ("type" IN ('Asset', 'Liability', 'Equity'))
);

DROP TABLE IF EXISTS "account";
CREATE TABLE IF NOT EXISTS "account" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "chartId" INTEGER NOT NULL,
  "date" DATETIME NOT NULL,
  "name" STRING NOT NULL,
  "code" INTEGER,

  FOREIGN KEY("chartId") REFERENCES "chart"("id"),
);

DROP TABLE IF EXISTS "journal";
CREATE TABLE IF NOT EXISTS "journal" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "date" DATETIME NOT NULL,
  "description" STRING NOT NULL,
  "isPosted" BOOLEAN NOT NULL DEFAULT 0

);

DROP TABLE IF EXISTS "transaction";
CREATE TABLE IF NOT EXISTS "transaction" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "date" DATETIME NOT NULL,
  "description" STRING,
  "debitAccountId" INTEGER NULL,
  "creditAccountId" INTEGER NULL,
  "debit" DECIMAL DEFAULT 0,
  "credit" DECIMAL DEFAULT 0,

  FOREIGN KEY("debitAccountId") REFERENCES "account"("id"),
  FOREIGN KEY("creditAccountId") REFERENCES "account"("id"),

  CHECK (("debit" IS NOT NULL AND "credit" IS NULL) OR ("debit" IS NULL AND "credit" IS NOT NULL)),
  CHECK (("debitAccountId" IS NOT NULL AND "creditAccountId" IS NULL) OR ("debitAccountId" IS NULL AND "creditAccountId" IS NOT NULL))
);

DROP TABLE IF EXISTS "ledger";
CREATE TABLE IF NOT EXISTS "ledger" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "date" DATETIME NOT NULL,
  "particulars" STRING NOT NULL,
  "accountId" INTEGER,
  "transactionId" INTEGER,
  "journalId" INTEGER NULL,
  "debit" DECIMAL DEFAULT 0,
  "credit" DECIMAL DEFAULT 0,
  "balance" DECIMAL DEFAULT 0,

  FOREIGN KEY("accountId") REFERENCES "account"("id"),
  FOREIGN KEY("journalId") REFERENCES "journal"("id"),
  FOREIGN KEY("transactionId") REFERENCES "transaction"("id"),

  CHECK (("debit" IS NOT NULL AND "credit" IS NULL) OR ("debit" IS NULL AND "credit" IS NOT NULL)),
  CHECK (("debitAccountId" IS NOT NULL AND "creditAccountId" IS NULL) OR ("debitAccountId" IS NULL AND "creditAccountId" IS NOT NULL))
);

COMMIT;
