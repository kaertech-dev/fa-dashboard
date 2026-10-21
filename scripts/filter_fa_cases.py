import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from functions import get_fa_conn


FA_CASE_PREFIX = re.compile(r"^(FA\d{7})\d{3}$", re.IGNORECASE)


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Consolidate duplicate FA case numbers for records with matching "
            "product, model, and failure cause, regardless of FA case date."
        )
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write the proposed fa_case changes. Without this flag, only preview them.",
    )
    args = parser.parse_args()

    conn = get_fa_conn()
    lock_acquired = False
    committed = False
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT GET_LOCK(%s, 10) AS acquired", ("fa_case_generation",))
            lock = cur.fetchone()
            if not lock or lock["acquired"] != 1:
                raise RuntimeError("Could not acquire the FA case generation lock.")
            lock_acquired = True

            cur.execute(
                """
                SELECT serial_num, product, model, failure_cause, fa_case
                FROM fa.main
                WHERE failure_cause IS NOT NULL
                  AND TRIM(failure_cause) <> ''
                  AND fa_case IS NOT NULL
                  AND fa_case <> ''
                ORDER BY fa_case ASC, serial_num ASC
                """
            )
            rows = cur.fetchall()

            groups = defaultdict(list)
            skipped_invalid_case = 0
            for row in rows:
                case_match = FA_CASE_PREFIX.fullmatch(str(row["fa_case"]).strip())
                if not case_match:
                    skipped_invalid_case += 1
                    continue
                cause = str(row["failure_cause"] or "").strip().casefold()
                if not cause:
                    continue
                key = (row["product"], row["model"], cause)
                groups[key].append(row)

            changes = []
            for group_rows in groups.values():
                candidates = [
                    row for row in group_rows
                    if row["fa_case"] is not None and str(row["fa_case"]).strip()
                ]
                if not candidates:
                    continue

                first_case = min(
                    candidates,
                    key=lambda row: (str(row["fa_case"]).upper(), str(row["serial_num"])),
                )["fa_case"]
                for row in group_rows:
                    if row["fa_case"] != first_case:
                        changes.append((first_case, row["serial_num"], row["fa_case"]))

            print(f"FA case values to update: {len(changes)}")
            if skipped_invalid_case:
                print(f"Skipped rows with an unexpected FA case format: {skipped_invalid_case}")
            for first_case, serial_num, previous_case in changes:
                print(f"{serial_num}: {previous_case or '(empty)'} -> {first_case}")

            if not args.apply:
                print("Preview only; pass --apply to write these fa_case changes.")
                return

            for first_case, serial_num, _ in changes:
                cur.execute(
                    "UPDATE fa.main SET fa_case = %s WHERE serial_num = %s",
                    (first_case, serial_num),
                )
            conn.commit()
            committed = True
            print(f"Updated {len(changes)} fa_case values.")
    finally:
        try:
            if lock_acquired:
                if not committed:
                    conn.rollback()
                with conn.cursor() as cur:
                    cur.execute("SELECT RELEASE_LOCK(%s)", ("fa_case_generation",))
        finally:
            conn.close()

if __name__ == "__main__":
    main()
