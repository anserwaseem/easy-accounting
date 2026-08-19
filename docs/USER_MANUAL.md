# Easy Accounting User Manual

## Table of Contents

1. [Introduction](#1-introduction)
2. [Getting Started](#2-getting-started)
   - [Installation](#installation)
   - [Creating an Account](#creating-an-account)
   - [Logging In](#logging-in)
3. [Dashboard](#3-dashboard)
   - [Importing a Balance Sheet](#importing-a-balance-sheet)
4. [Accounts](#4-accounts)
   - [Viewing Accounts](#viewing-accounts)
   - [Adding a New Account](#adding-a-new-account)
   - [Editing an Account](#editing-an-account)
5. [Ledger](#5-ledger)
   - [Viewing a Ledger](#viewing-a-ledger)
   - [Understanding Ledger Balance](#understanding-ledger-balance)
6. [Journals](#6-journals)
   - [Viewing Journals](#viewing-journals)
   - [Creating a New Journal Entry](#creating-a-new-journal-entry)
   - [Viewing a Specific Journal Entry](#viewing-a-specific-journal-entry)
7. [Inventory](#7-inventory)
   - [Finding Items](#finding-items)
   - [Attributes](#attributes)
   - [Price Lists](#price-lists)
   - [Display Title](#display-title)
8. [Support](#8-support)

## 1. Introduction

Easy Accounting is a comprehensive, user-friendly accounting software designed for small to medium-sized businesses. It offers a seamless desktop experience across various platforms, including Windows and macOS.

## 2. Getting Started

### Installation

1. Download the appropriate installer for your operating system from the official website or authorized distributor.
2. Run the installer and follow the on-screen instructions.
3. Once installed, launch the application.

### Creating an Account

If you're a new user:

1. Click on the "Register" link on the login screen.
2. Enter your desired username and password.
3. Click the "Register" button.

### Logging In

1. On the login screen, enter your username and password.
2. Click the "Login" button.

## 3. Dashboard

The dashboard provides an overview of your financial status. It may include charts and summaries of your accounts, recent transactions, and other key financial indicators (Coming Soon).

### Importing a Balance Sheet

Easy Accounting allows you to import your existing balance sheet to quickly set up your accounts. Here's how to do it:

1. Prepare your balance sheet in an Excel (.xlsx) format. Make sure it follows the required structure (you can download an example balance sheet for reference).
2. On the dashboard, look for an "Upload Balance Sheet" button.
3. Click this button and select your prepared file.
4. The system will create the necessary accounts and enter the opening balances based on your imported data.
5. Once the import is complete, a confirmation message will appear. You can then navigate to the Accounts section to view your newly created accounts.

## 4. Accounts

### Viewing Accounts

1. Click on "Accounts" in the sidebar.
2. You'll see a list of all your accounts, including their names, types, and balances.

### Adding a New Account

1. On the Accounts page, click the "+" button.
2. Fill in the account details:
   - Name
   - Head (account type)
   - Code (optional)
3. Click "Save" to create the new account.

### Editing an Account

1. On the Accounts page, find the account you want to edit.
2. Click the edit (pencil) icon next to the account.
3. Modify the account details as needed.
4. Click "Save" to update the account.

## 5. Ledger

### Viewing a Ledger

1. From the Accounts page, click on an account name.
2. You'll be taken to the ledger for that account, showing all transactions.

### Understanding Ledger Balance

The ledger table provides a detailed view of all transactions for a particular account. Here's what you need to know about the balance:

- The 'Balance' column in the ledger table shows the account balance after each transaction.
- This balance is cumulative, reflecting the account's balance at that specific point in time.
- The most recent transaction (the first row in the table) shows the current balance of the account.
- Each row in the ledger represents a transaction, and the balance in that row shows the account balance immediately after that transaction occurred.

This structure allows you to see how the account balance has changed over time and trace the impact of individual transactions on the overall account balance.

## 6. Journals

### Viewing Journals

1. Click on "Journals" in the sidebar.
2. You'll see a list of all journal entries, including their dates and amounts.

### Creating a New Journal Entry

1. On the Journals page, click the "+" button.
2. Enter the journal date and narration (Optional).
3. Add journal entry lines, specifying the account, debit amount OR credit amount for each.
4. Click "Add New Row" button to add a new journal entry line
5. Click "Save and Publish" to create the journal entry.

### Viewing a Specific Journal Entry

1. On the Journals page, click on a journal entry.
2. You'll see the full details of that journal entry, including all associated accounts and amounts.

## 7. Inventory

The Inventory page lists the items you buy and sell. Alongside the name, price
and quantity, each item can carry **attributes** that describe it, a price on one
or more **price lists**, and a **display title** for use outside the app.

### Finding Items

**Row details.** Attributes are not shown as columns by default, because most
items fill only a few of them and a column for each would push the item name off
the screen. Click the arrow at the start of a row to open a panel listing what
that item actually has.

**Search** covers the name, description, type and every attribute value, so
typing a binding or a paper size finds the items carrying it.

**Filters** answer the questions search cannot, because they are about absence
as much as presence. Click **Filters**, then choose a value for any attribute.
Choices combine, so you can ask for 16-line items _and_ no binding set at once.
Alongside the real values every attribute offers **(not set)**, which is what
makes "which items are missing this" a question you can ask.

The button shows how many filters are active, and **Clear all** removes them.

**Columns** switches optional columns on when you do want them side by side,
including price lists and individual attributes.

**Sorting** works on any column with a header you can click. Empty values always
sort last, whichever direction you sort in, so an unpriced or unfilled item
never leads the list.

### Attributes

An attribute is a property an item can have: paper size, colour, material,
weight. You define each attribute once, then fill in a value per item. Keeping
them as attributes rather than writing them into the item name means you can
compare and group items by them later.

**Defining the attributes you use**

1. On the Inventory page, click **Attributes** to open the **Item attributes**
   dialog.
2. Fill in the form at the bottom:
   - **Name**, what you call it, for example `Paper size`
   - **Type**, the kind of value it holds
   - **Unit (optional)**, for example `gsm`
   - **Public**, tick this if the attribute may be included when the catalog is
     published
3. Click **Add**.

Attributes you no longer use can be set to **Deactivate** rather than deleted.
The **Used by** column shows how many items still carry a value for one, so you
can tell whether deactivating it will leave gaps.

**Filling in values for an item**

1. Find the item in the inventory table.
2. Click the **Edit attributes** icon on its row.
3. Enter a value against each attribute that applies. Leave the rest blank.
4. Click **Save attributes**.

Blank is meaningful: it records that the property does not apply to this item,
which is different from a value of zero.

**Copying attributes from another item**

When a new item is a variation of an existing one, copy the values across
instead of retyping them:

1. Open **Edit attributes** on the new item.
2. Click **Copy from...**.
3. Search for the item to copy from and select it.
4. Review the **Change** column, which shows what each value **Becomes**. Values
   already set on your item are shown so you can see what will be overwritten.
5. Click **Save attributes**.

Check the review step rather than skipping it. An item that is a good source for
most fields may still overwrite the one value that distinguishes the two.

### Price Lists

A price list is a named set of prices, so one item can be priced differently for
different purposes without duplicating the item.

**Creating a price list**

1. On the Inventory page, click **Price lists**.
2. Type a name into **New price list**, for example `Retail`.
3. Optionally use **Start from** to copy the prices of an existing list as a
   starting point, then adjust from there.
4. Click **Save**.

**Setting prices**

There are two places to set one, for two different jobs:

- **One item:** open it for editing and fill in the box under **Price lists**.
  Saved with the rest of the form when you click Submit, so closing the dialog
  without submitting discards it.
- **Many items:** each price list appears as its own column in the inventory
  table. Switch the column on under **Columns**, click **Bulk edit**, and type
  down the column.

If an item has no price on a list, it has no price on that list. It does not
quietly fall back to another list's price, so an item you expect to sell from a
list needs a price entered against it.

### Display Title

The item name identifies the item and is used to match it everywhere, so it
cannot be changed once created. The **display title** is a separate, free-text
label for the same item, used where a customer-facing name is wanted instead of
an internal code.

1. Open the item for editing.
2. Enter the wording in **Display title**.
3. Click **Save**.

Leave it blank and the item name is used instead. Changing the title never
changes the item name, so it is safe to reword at any time.

## 8. Support

If you need further assistance:

- Check the README file for more detailed troubleshooting steps.
- Contact support at hafiz.anser.waseem@gmail.com
- File an issue on the GitHub repository: https://github.com/anserwaseem/easy-accounting/issues
