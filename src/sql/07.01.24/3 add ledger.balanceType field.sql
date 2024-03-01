ALTER TABLE Ledger
ADD COLUMN balanceType STRING CHECK (balanceType IN ('Cr', 'Dr'));
