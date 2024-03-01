PRAGMA foreign_keys=off;

ALTER TABLE chart RENAME TO _chart_old;

CREATE TABLE chart
(
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

INSERT INTO chart (id, date, name, userId, code, type, createdAt, updatedAt)
SELECT id, date, name, 1, code, type, createdAt, updatedAt FROM _chart_old;

DROP TABLE _chart_old;

PRAGMA foreign_keys=on;
