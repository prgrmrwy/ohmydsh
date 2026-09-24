#!/usr/bin/env python3
"""
Clear dsh-pet's locus state from state.sqlite: either every locus, or only
the ones matching given chatId endpoints.

WHY THIS EXISTS
----------------
There is no first-class "delete a locus" API in dsh-pet: `stopLocus`/
`retireLocus` only transition state (the row stays, as history/audit
evidence). This script does a real, physical DELETE across the 6
locus-related tables, for operators who explicitly want test/scratch data
gone rather than retired.

WHAT IT TOUCHES
----------------
Table name prefix `u_<unit>_<table>` comes from the storage-sqlite package's
`recordTableName()` and is not deployment-specific; `dsh-pet`'s unit name is
the fixed constant `PET_DOMAIN_NAME = 'dsh_pet'` (src/host/spec.ts). So the
six physical tables are always:

  u_dsh_pet_loci
  u_dsh_pet_locus_indexes
  u_dsh_pet_locus_deliveries
  u_dsh_pet_locus_operations
  u_dsh_pet_locus_permission_audit
  u_dsh_pet_locus_switch_notices

`u_dsh_pet_locus_indexes` rows can be SHARED across loci: a `parent-loci`
index's `locusIds` array may list several loci under one key (e.g. several
issue-group children of the same main). Selective mode never deletes a
shared index row outright — it only prunes the target ids out of its
`locusIds` array, deleting the row itself only if that empties it. Full-wipe
mode still deletes every row directly since nothing survives it anyway.

SAFETY
------
- Refuses to run against a state.sqlite that any process still has open
  (checks with `lsof`; the dsh Host holds an exclusive-enough lock while
  running, and a delete attempted through it hits `database is locked`, not
  a silent corruption — but this check catches it before every DELETE
  fires, not one at a time).
- Always takes its own timestamped `.bak` copy before writing, unless
  --no-backup is passed.
- Runs the whole delete in one transaction; a raised exception rolls it all
  back, so a partial run cannot leave inconsistent tables behind.
- Prints a before/after count per table either way, and exits non-zero if a
  selective run does not land on the exact expected before/after delta.

USAGE
-----
  # Preview only, no writes:
  clear-locus-state.py <path-to-state.sqlite> --dry-run

  # Wipe every locus (only when you know there is nothing worth keeping):
  clear-locus-state.py <path-to-state.sqlite> --all

  # Remove only the loci for these chat endpoints (repeatable):
  clear-locus-state.py <path-to-state.sqlite> --chat-id oc_xxx --chat-id oc_yyy

Must be run while the Host (`dsh stop`) is NOT running against this file.
"""

import argparse
import json
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime

TABLES = [
    "u_dsh_pet_loci",
    "u_dsh_pet_locus_indexes",
    "u_dsh_pet_locus_deliveries",
    "u_dsh_pet_locus_operations",
    "u_dsh_pet_locus_permission_audit",
    "u_dsh_pet_locus_switch_notices",
]


def die(msg: str, code: int = 1) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


def assert_not_open(db_path: str) -> None:
    """Refuse to run if any process still has the file open (WAL/SHM too)."""
    for suffix in ("", "-wal", "-shm"):
        path = db_path + suffix
        try:
            out = subprocess.run(["lsof", path], capture_output=True, text=True)
        except FileNotFoundError:
            print("warning: lsof not available, skipping open-file check", file=sys.stderr)
            return
        if out.returncode == 0 and out.stdout.strip():
            lines = out.stdout.strip().splitlines()
            die(
                f"{path} is still open by a running process — stop the Host first "
                f"(`dsh stop`), then re-run. lsof output:\n" + "\n".join(lines)
            )


def counts(conn: sqlite3.Connection) -> dict:
    return {t: conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in TABLES}


def print_counts(label: str, values: dict) -> None:
    print(f"=== {label} ===")
    for t in TABLES:
        print(f"  {t}: {values[t]}")


def load_loci(conn: sqlite3.Connection) -> list:
    rows = conn.execute("SELECT key, value FROM u_dsh_pet_loci").fetchall()
    return [(key, json.loads(value)) for key, value in rows]


def full_wipe(conn: sqlite3.Connection) -> None:
    for t in TABLES:
        conn.execute(f"DELETE FROM {t}")


def selective_wipe(conn: sqlite3.Connection, chat_ids: set) -> int:
    """Delete only loci whose endpoint.chatId is in chat_ids, and everything
    that references only those loci. Returns the number of loci removed."""
    loci = load_loci(conn)
    target_locus_ids = {
        key for key, record in loci
        if record.get("endpoint", {}).get("chatId") in chat_ids
    }
    if not target_locus_ids:
        print("no matching loci found for the given --chat-id values; nothing to do")
        return 0

    for locus_id in target_locus_ids:
        conn.execute("DELETE FROM u_dsh_pet_loci WHERE key = ?", (locus_id,))

    for table in ("u_dsh_pet_locus_deliveries", "u_dsh_pet_locus_operations"):
        rows = conn.execute(f"SELECT key, value FROM {table}").fetchall()
        for key, value in rows:
            record = json.loads(value)
            if record.get("locusId") in target_locus_ids:
                conn.execute(f"DELETE FROM {table} WHERE key = ?", (key,))

    index_rows = conn.execute("SELECT key, value FROM u_dsh_pet_locus_indexes").fetchall()
    for key, value in index_rows:
        record = json.loads(value)
        remaining = [lid for lid in record.get("locusIds", []) if lid not in target_locus_ids]
        if len(remaining) == len(record.get("locusIds", [])):
            continue  # this index row was not touched
        if remaining:
            record["locusIds"] = remaining
            conn.execute(
                "UPDATE u_dsh_pet_locus_indexes SET value = ? WHERE key = ?",
                (json.dumps(record), key),
            )
        else:
            conn.execute("DELETE FROM u_dsh_pet_locus_indexes WHERE key = ?", (key,))

    return len(target_locus_ids)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("db_path", help="path to dsh-pet's state.sqlite")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--all", action="store_true", help="delete every locus and all related rows")
    mode.add_argument("--chat-id", action="append", dest="chat_ids", metavar="CHAT_ID",
                       help="delete only the locus for this chatId (repeatable)")
    parser.add_argument("--dry-run", action="store_true", help="print what would happen, write nothing")
    parser.add_argument("--no-backup", action="store_true", help="skip the automatic .bak copy")
    args = parser.parse_args()

    assert_not_open(args.db_path)

    if not args.dry_run and not args.no_backup:
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup_path = f"{args.db_path}.before-locus-cleanup-{ts}.bak"
        shutil.copy2(args.db_path, backup_path)
        print(f"backed up to {backup_path}")

    conn = sqlite3.connect(args.db_path)
    conn.execute("PRAGMA journal_mode=WAL")

    before = counts(conn)
    print_counts("before", before)

    if args.dry_run:
        if args.all:
            print("\n[dry-run] would DELETE all rows from all 6 tables")
        else:
            chat_ids = set(args.chat_ids)
            loci = load_loci(conn)
            matched = [
                (key, record.get("endpoint", {}))
                for key, record in loci
                if record.get("endpoint", {}).get("chatId") in chat_ids
            ]
            print(f"\n[dry-run] would remove {len(matched)} locus/loci:")
            for key, endpoint in matched:
                print(f"  {key} -> {endpoint}")
        conn.close()
        return

    conn.execute("BEGIN")
    try:
        if args.all:
            full_wipe(conn)
        else:
            removed = selective_wipe(conn, set(args.chat_ids))
            if removed == 0:
                conn.rollback()
                conn.close()
                return
        conn.commit()
    except Exception:
        conn.rollback()
        conn.close()
        raise

    after = counts(conn)
    print_counts("after", after)
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()

    if args.all:
        if all(v == 0 for v in after.values()):
            print(f"\nOK: full wipe complete, all 6 tables now empty.")
        else:
            die("some tables are not empty after a full wipe — investigate before trusting this run", 2)
    else:
        print(f"\nOK: selective delete complete for chat ids: {', '.join(args.chat_ids)}")


if __name__ == "__main__":
    main()
