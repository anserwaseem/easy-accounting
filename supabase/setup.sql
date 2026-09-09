-- ============================================================================
-- Easy Accounting — Supabase sync backend (server half of the sync protocol)
-- ============================================================================
--
-- What this implements: the server side of the append-only change-log
-- protocol described by src/core/sync/transport.ts (the SyncTransport port),
-- src/core/sync/SyncEngine.ts (the client driving it), and
-- src/core/sync/__tests__/mockServer.ts (MockSyncServer — the in-process
-- reference implementation this file is a faithful server-side port of:
-- same strict serialization, same seq assignment, same idempotency dedup,
-- same per-batch atomicity, same causality-preserving log order. Read that
-- file's doc comment first if anything below is surprising).
--
-- BYOK ⇒ single-tenant per project, no business_id
-- --------------------------------------------------------------------------
-- Easy Accounting's sync model is "bring your own key/backend": every
-- business provisions and owns *its own* Supabase project, and every device
-- for that business is handed that one project's URL + anon key. There is
-- therefore exactly one business's data per Supabase project — "the
-- business" IS the project, the same way "the business" is one SQLite file
-- on desktop today. That is why nothing in this schema has a `business_id`
-- (or `tenant_id`) column, and why sync_push's advisory lock below is a
-- single *global* lock rather than one keyed per business: there is only
-- ever one business's worth of contention to serialize against a single
-- project. A shared multi-tenant SaaS backend would need both; this one
-- deliberately does not, and should not grow them later without first
-- reconsidering the whole BYOK premise.
--
-- Idempotent — safe to paste this whole file into the Supabase SQL Editor
-- --------------------------------------------------------------------------
-- any number of times: initial setup, or to pick up a later revision of
-- this file. Every DDL statement below either uses IF NOT EXISTS / CREATE
-- OR REPLACE, or (for policies, which Postgres has no CREATE ... IF NOT
-- EXISTS form for) drops and recreates by name.
--
-- ⚠️  TEST-PROJECT RLS POLICY — NOT THE PRODUCTION POSTURE  ⚠️
-- --------------------------------------------------------------------------
-- The policies in section 4 below grant `select` on sync_log and `execute`
-- on sync_push to BOTH the `anon` and `authenticated` Supabase roles. That
-- is intentionally permissive for this early integration-testing phase (no
-- auth wizard exists yet on the client, so there is no signed-in
-- `authenticated` session to require). Once the auth wizard lands, this
-- file's production revision must tighten these policies to
-- `authenticated`-only and drop `anon` entirely — anyone holding this
-- project's anon key would otherwise be able to read and append to the
-- business's entire sync log. Do not copy this section's grants into a
-- production setup script without making that change first.
--
-- What's deliberately NOT here yet
-- --------------------------------------------------------------------------
-- No business-rule validation of pushed mutations (balanced journals,
-- schema/shape checks, referential checks, conflict refereeing). Per this
-- file's header, sync_push mirrors MockSyncServer exactly — MockSyncServer
-- accepts anything shaped like a well-formed mutation unconditionally, and
-- so does this function today. Section 3 below has a clearly-marked spot
-- for that Phase-3 "referee" work to slot into once it's designed.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. sync_log — the append-only server log.
--
-- One row per *accepted* mutation. `seq` (bigint identity) is the single
-- global total order every device's `pull(afterSeq, limit)` walks forward
-- through — the server-side counterpart of MockSyncServer's `this.seq`.
-- `idempotency_key` is UNIQUE so a retried push of the same OutboxEntry can
-- never create a second log row or consume a second `seq` (see sync_push
-- below, and OutboxEntry's doc comment in transport.ts for why retries are
-- expected to send the same key verbatim).
-- ----------------------------------------------------------------------------
create table if not exists sync_log (
  seq bigint generated always as identity primary key,
  idempotency_key text unique not null,
  table_name text not null,
  row_uuid text not null,
  op text not null check (op in ('put', 'delete')),
  row_json jsonb,
  device_id text not null,
  created_at timestamptz not null default now()
);

comment on table sync_log is
  'Append-only per-project sync log for Easy Accounting multi-device sync (BYOK: one Supabase project per business, so no business_id here — see this file''s header comment). Server counterpart of client sync_outbox (migration 029); mirrors src/core/sync/__tests__/mockServer.ts''s reference semantics.';

-- Pull reads by `seq > cursor` in ascending order — this index makes that a
-- straightforward btree range scan instead of a full-table scan/sort as the
-- log grows. (The identity primary key already gives us a btree on `seq`,
-- but naming it explicitly documents *why* it matters for the pull path.)
create index if not exists sync_log_seq_idx on sync_log (seq);

-- SupabaseSyncTransport.pull additionally filters `device_id=neq.<caller's
-- own deviceId>` (own-row egress fix — see that method's doc comment) on
-- top of `seq=gt.<cursor>`. This is a pure client-side PostgREST query
-- filter against an already-selectable, already-indexed-by-nothing-special
-- plain column: it needs no schema change, no new index (the seq range
-- scan above already does the heavy lifting; excluding one device's rows
-- from the result set doesn't need its own index to be worth doing), and no
-- RLS/grant change — `sync_log_select` below already grants `select` on
-- every row via `using (true)`, and a `WHERE device_id <> ...` clause a
-- client adds to its own request is just a narrower read of rows it could
-- already see in full, not a new access path.


-- ----------------------------------------------------------------------------
-- 2. Row Level Security — enable it before anything is granted access.
-- ----------------------------------------------------------------------------
alter table sync_log enable row level security;


-- ----------------------------------------------------------------------------
-- 3. sync_push(mutations jsonb) — the push RPC.
--
-- Takes a JSON array of OutboxEntry-shaped objects (see transport.ts):
--   [{ idempotencyKey, tableName, rowUuid, op, rowJson (a JSON *string*,
--      double-encoded the same way it travels client-side — see
--      SyncEngine.applyRow's `JSON.parse(row.rowJson)`), deviceId }, ...]
-- and returns { accepted: string[], rejected: [], newSeq: number } —
-- exactly the shape PushResult expects once SupabaseSyncTransport.push()
-- maps `accepted.length` onto PushResult.accepted (see that file).
--
-- SECURITY DEFINER so that callers only need the `execute` grant below (see
-- section 4) and never need direct table-level `insert`/`select` grants on
-- sync_log — the function is the only sanctioned write path. `search_path`
-- is pinned to keep a SECURITY DEFINER function from being tricked by a
-- caller-controlled search_path (standard Postgres SECURITY DEFINER
-- hygiene).
--
-- Whole call is one transaction: a plpgsql function body already runs
-- inside the transaction PostgREST opens for the RPC call, so per-batch
-- atomicity (MockSyncServer's "records every new entry or none of them" —
-- see its doc comment) falls out for free from a normal Postgres error
-- aborting that transaction; nothing here needs an explicit BEGIN/COMMIT.
--
-- Advisory lock: single-tenant-per-project (see this file's header) means
-- there is only one business's worth of contention on this project, so one
-- *global* pg_advisory_xact_lock is this server's counterpart of
-- MockSyncServer's `serialize()` promise-chain — every concurrent
-- sync_push call across every device queues up behind this lock instead of
-- interleaving, auto-released at transaction end (xact-scoped).
-- ----------------------------------------------------------------------------
create or replace function sync_push(mutations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  mutation jsonb;
  entry_key text;
  accepted_keys jsonb := '[]'::jsonb;
  rejected_keys jsonb := '[]'::jsonb;
  max_seq bigint;
begin
  -- Single global advisory lock — see this section's doc comment above.
  perform pg_advisory_xact_lock(hashtext('easy-accounting-sync'));

  for mutation in select * from jsonb_array_elements(coalesce(mutations, '[]'::jsonb))
  loop
    entry_key := mutation->>'idempotencyKey';

    if exists (select 1 from sync_log sl where sl.idempotency_key = entry_key) then
      -- Already recorded — this device's own retry of a push whose
      -- response never made it back, or a duplicate within the same
      -- batch. Idempotent no-op: no new log row, no seq consumed, but
      -- still reported as accepted (a retry succeeding silently is the
      -- point — see OutboxEntry's doc comment in transport.ts). Matches
      -- MockSyncServer.push's `continue` branch exactly.
      accepted_keys := accepted_keys || to_jsonb(entry_key);
      continue;
    end if;

    -- ====================================================================
    -- PHASE-3 REFEREE VALIDATION SLOTS IN HERE.
    --
    -- Not implemented yet — this mirrors MockSyncServer exactly, which
    -- "accepts anything with a well-formed OutboxEntry shape
    -- unconditionally" (see its doc comment). When Phase-3 validation
    -- lands (balanced journals, schema/shape checks, referential/conflict
    -- refereeing, etc.), it belongs in this loop, before the insert below:
    -- populate `rejected_keys := rejected_keys || jsonb_build_object(
    -- 'idempotencyKey', entry_key, 'reason', <why>)` and `continue` instead
    -- of inserting, for anything that fails validation. Nothing else in
    -- this function needs to change — sync_push's contract (PushResult)
    -- already has a `rejected` slot, and SyncEngine's drainOutbox already
    -- moves rejected entries to the client's `sync_rejected` table.
    -- ====================================================================

    insert into sync_log (idempotency_key, table_name, row_uuid, op, row_json, device_id)
    values (
      entry_key,
      mutation->>'tableName',
      mutation->>'rowUuid',
      mutation->>'op',
      case
        when mutation ? 'rowJson' and jsonb_typeof(mutation->'rowJson') = 'string'
          -- rowJson travels as a JSON *string* (double-encoded — see this
          -- function's header comment), so unwrap it with ->>' then parse.
          then nullif(mutation->>'rowJson', '')::jsonb
        else mutation->'rowJson'
      end,
      mutation->>'deviceId'
    );

    accepted_keys := accepted_keys || to_jsonb(entry_key);
  end loop;

  select coalesce(max(sl.seq), 0) into max_seq from sync_log sl;

  return jsonb_build_object(
    'accepted', accepted_keys,
    'rejected', rejected_keys,
    'newSeq', max_seq
  );
end;
$$;

comment on function sync_push(jsonb) is
  'Push endpoint for Easy Accounting sync. Mirrors src/core/sync/__tests__/mockServer.ts exactly: strict serialization (advisory lock), seq assignment, idempotency dedup, per-batch atomicity. No business validation yet — see the marked Phase-3 section inside the function body.';


-- ----------------------------------------------------------------------------
-- 4. Grants and RLS policies.
--
-- Pull is plain PostgREST (`GET .../sync_log?seq=gt.<cursor>&order=seq.asc
-- &limit=<n>` — see SupabaseSyncTransport.pull), so it needs a SELECT
-- policy on the table directly. Push goes exclusively through the
-- SECURITY DEFINER RPC above, so it needs `execute` on the function and
-- deliberately no direct table grant (insert/update/delete on sync_log stay
-- ungranted to every role — the function is the only write path).
--
-- See the big warning near the top of this file: `anon` is included here
-- only because this is a pre-auth-wizard test/integration phase. Tighten to
-- `authenticated`-only in production.
-- ----------------------------------------------------------------------------

-- Postgres has no `CREATE POLICY IF NOT EXISTS` — drop-then-create by name
-- is the idempotent idiom used throughout this file's policy section.
drop policy if exists sync_log_select on sync_log;
create policy sync_log_select
  on sync_log
  for select
  to anon, authenticated
  using (true);

-- No insert/update/delete policy is created for anon/authenticated: RLS
-- defaults to deny, and sync_log is written to exclusively through
-- sync_push (SECURITY DEFINER, so it bypasses RLS as the function owner —
-- direct table writes stay blocked for every client role).

revoke all on function sync_push(jsonb) from public;
grant execute on function sync_push(jsonb) to anon, authenticated;

-- sync_log itself: PostgREST also needs the underlying table SELECT grant
-- (RLS narrows *rows*, but the role still needs the base privilege) —
-- INSERT/UPDATE/DELETE are deliberately never granted here (see above).
revoke all on sync_log from public;
grant select on sync_log to anon, authenticated;
-- No grant is needed on the identity sequence backing `seq`: the only write
-- path is sync_push, which is SECURITY DEFINER and therefore inserts as the
-- function's owner (who owns sync_log and, transitively, its identity
-- sequence already) — never as the calling anon/authenticated role.


-- ----------------------------------------------------------------------------
-- 5. Statement timeout for the API roles.
--
-- REAL INCIDENT this exists for: right after a large import-over-connected-
-- device (which appends a delete tombstone per old row plus a put per
-- imported row — a ~142k-row business briefly triples the log), the
-- importing device's own next pull has to walk `seq > cursor AND
-- device_id <> self` past every one of its own freshly-pushed rows before
-- finding anything (or nothing) to return. On a free-tier (nano) instance
-- that scan can exceed Supabase's default 8s statement_timeout for the
-- anon/authenticated roles, and the pull dies with `57014 canceling
-- statement due to statement timeout` — every 30s, forever, because the
-- cursor only ever advances past that block once a pull actually
-- completes. The device looks wedged ("Last sync attempt failed", HTTP
-- 500/57014) while its peers, on the receiving side of the same log, sync
-- fine.
--
-- 60s is a deliberate ceiling, not a target: steady-state pulls are
-- indexed range scans that finish in milliseconds, and the expensive scan
-- happens exactly once per import (the cursor jumps past the device's own
-- block as soon as one pull completes — see SyncEngine.pullAndApply's
-- "Cursor advancement past filtered own-device rows" doc comment). BYOK
-- means these roles serve only this one business's sync traffic, so a
-- generous cap costs nothing in multi-tenant fairness (there are no other
-- tenants). Run the log compaction from docs/web-field-notes.md after an
-- import to shrink the scan itself.
--
-- Role-level settings apply to NEW connections; the NOTIFY prompts
-- PostgREST to reload so its pooled connections pick the change up
-- without waiting for a natural reconnect.
-- ----------------------------------------------------------------------------
alter role anon set statement_timeout = '60s';
alter role authenticated set statement_timeout = '60s';
notify pgrst, 'reload config';
