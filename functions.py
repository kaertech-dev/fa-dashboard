# functions.py
import pymysql.cursors
from db_config import DB_FA, DB_PROJECTS
import bcrypt
from datetime import datetime

def get_fa_conn():
    return pymysql.connect(**DB_FA)

def get_projects_conn():
    return pymysql.connect(**DB_PROJECTS)

def hash_badge(plain_badge: str) -> str:
    """
    Hash a plaintext badge for storage in userv2.badge, using the same
    bcrypt scheme as migrate_passwords.py.
    """
    return bcrypt.hashpw(plain_badge.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def check_badge(plain_badge: str, stored_hash: str) -> bool:
    """
    Verify a typed-in badge against the bcrypt hash stored in userv2.badge
    (as produced by migrate_passwords.py).
    """
    if not stored_hash:
        return False
    try:
        return bcrypt.checkpw(plain_badge.encode("utf-8"), stored_hash.encode("utf-8"))
    except ValueError:
        # stored_hash isn't a valid bcrypt hash (e.g. still plaintext / not migrated yet)
        return False

def authenticate(employee_num: str, badge_raw: str):
    """
    Verify credentials against fa.userv2.
    employee_num = username, badge (bcrypt hash) = password.
    Returns the user row dict on success (including user_group), or None on failure.

    NOTE: assumes the group column is named `user_group`. Rename below if your
    schema uses a different column name (e.g. `group_name`, `role`).
    """
    conn = get_fa_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT employee_num, employee_name, badge, `group` AS user_group
                FROM userv2
                WHERE employee_num = %s
                LIMIT 1
                """,
                (employee_num,),
            )
            row = cur.fetchone()
    finally:
        conn.close()

    if row is None:
        return None
    if not check_badge(badge_raw, row["badge"]):
        return None
    return row

def get_fa_by_serial(serial_num: str):
    """Look up a full FA record by serial number."""
    conn = get_fa_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM fa.main_copy WHERE serial_num = %s LIMIT 1",
                (serial_num,),
            )
            row = cur.fetchone()
    finally:
        conn.close()
    return row

def get_distinct_values(column: str, limit: int = 200):
    """Return distinct non-empty values for a whitelisted column (dropdown options)."""
    allowed = {
        "proposed_action", "defect_cat", "action_taken",
        "product", "model", "station",
    }
    if column not in allowed:
        raise ValueError(f"Column '{column}' is not allowed.")

    conn = get_fa_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT DISTINCT {column} AS v FROM fa.main_copy "
                f"WHERE {column} IS NOT NULL AND {column} <> '' "
                f"ORDER BY {column} LIMIT %s",
                (limit,),
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return [r["v"] for r in rows]

def generate_fa_case(conn):
    today = datetime.now()
    year = today.strftime("%Y")
    julian_date = today.strftime("%j")

    prefix = f"FA{year}{julian_date}"

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT fa_case FROM fa.main_copy
            WHERE fa_case LIKE %s
            ORDER BY fa_case DESC
            LIMIT 1
            
            """, (prefix + "%",))

        row = cur.fetchone()

        if row:
            next_num = int(row["fa_case"][-3:])+ 1
        else:
            next_num = 1

    return f"{prefix}{next_num:03d}"

def update_fa(serial_num: str, fields: dict):
    """Update the editable FA fields for a given serial number."""
    allowed = {
        "failure_cause", "affected_comp", "fa_pic",
        "proposed_action", "defect_cat", "fa_class",
        "fa_case","faended_datetime"
    }

    conn = get_fa_conn()
    
    try:
        if "fa_case" not in fields or not fields["fa_case"]:
            fields["fa_case"] = generate_fa_case(conn)
        
        set_cols = [k for k in fields if k in allowed]
        if not set_cols:
            return False
        
        with conn.cursor() as cur:
            set_clause = ", ".join(f"{c} = %s" for c in set_cols)
            values = [fields[c] for c in set_cols] + [serial_num]
            cur.execute(
                f"UPDATE fa.main_copy SET {set_clause} WHERE serial_num = %s",
                values,
            )
            conn.commit()
    finally:
        conn.close()
    return True

def update_rework(serial_num: str, fields: dict):
    """Update the editable rework/repair fields for a given serial number."""
    allowed = {
        "repairer", "action_taken", "repaired_datetime","returned_datetime", "farepair_status",
    }
    set_cols = [k for k in fields if k in allowed]
    if not set_cols:
        return False

    conn = get_fa_conn()
    try:
        with conn.cursor() as cur:
            set_clause = ", ".join(f"{c} = %s" for c in set_cols)
            values = [fields[c] for c in set_cols] + [serial_num]
            cur.execute(
                f"UPDATE fa.main_copy SET {set_clause} WHERE serial_num = %s",
                values,
            )
            conn.commit()
    finally:
        conn.close()
    return True

def return_rework(serial_num: str, fields: dict):
    allowed = {
        "returned_datetime", "farepair_status"
    }

    set_cols = [k for k in fields if k in allowed]
    if not set_cols:
        return False
    conn = get_fa_conn()
    try:
        with conn.cursor() as cur:
            set_clause = ", ".join(f"{c} = %s" for c in set_cols)
            values = [fields[c] for c in set_cols] + [serial_num]
            cur.execute(f"UPDATE fa.main_copy SET {set_clause} WHERE serial_num = %s",
            values,
            )
            conn.commit()
    finally:
        conn.close()
    return True

def create_or_update_endorsement(serial_num: str, fields: dict):
    """
    Endorsement step: register a rejected unit into fa.main_copy.

    - If the serial number already exists (re-endorsed / re-rejected), refresh
      its endorsement-stage fields.
    - Otherwise, insert a brand-new row (this is normally the FIRST time a
      serial enters the FA system).

    `fields` should only contain endorsement-stage columns:
      product, model, station, po_num, test_failure, prod_endorser,
      faendorse_datetime, farepair_status
    """
    allowed = {
        "product", "model", "station", "po_num", "test_failure",
        "prod_endorser", "faendorse_datetime", "farepair_status",
    }
    fields = {k: v for k, v in fields.items() if k in allowed}
    if not fields:
        return False

    conn = get_fa_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT serial_num FROM fa.main_copy WHERE serial_num = %s LIMIT 1",
                (serial_num,),
            )
            exists = cur.fetchone()

            if exists:
                set_clause = ", ".join(f"{c} = %s" for c in fields)
                values = list(fields.values()) + [serial_num]
                cur.execute(
                    f"UPDATE fa.main_copy SET {set_clause} WHERE serial_num = %s",
                    values,
                )
            else:
                cols = ["serial_num"] + list(fields.keys())
                placeholders = ", ".join(["%s"] * len(cols))
                values = [serial_num] + list(fields.values())
                cur.execute(
                    f"INSERT INTO fa.main_copy ({', '.join(cols)}) VALUES ({placeholders})",
                    values,
                )
            conn.commit()
    finally:
        conn.close()
    return True