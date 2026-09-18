# app.py
import os
import time
import gzip
from concurrent.futures import ThreadPoolExecutor
from functools import wraps
from io import BytesIO
from flask import Flask, request, jsonify, render_template, session, redirect
from functions import (
    get_fa_conn, authenticate, hash_badge,
    get_fa_by_serial, get_fa_url, save_fa_url, get_distinct_values, update_fa, update_rework,
    create_or_update_endorsement,
)
from active_customer import ActiveProjects, StationLog
from datetime import datetime, timedelta

app = Flask(__name__)
app.secret_key = os.environ["SECRET_KEY"]

active_projects = ActiveProjects()
station_log     = StationLog(active_projects)
_dashboard_data_cache = {"expires_at": 0, "payload": None}
_run_units_jobs = {}
_run_units_executor = ThreadPoolExecutor(max_workers=1)

@app.after_request
def compress_json_response(response):
    """Compress large JSON responses when the client advertises gzip support."""
    accepts_gzip = "gzip" in request.headers.get("Accept-Encoding", "").lower()
    content_type = response.headers.get("Content-Type", "")
    if accepts_gzip and content_type.startswith("application/json") and response.content_length and response.content_length > 1024:
        compressed = gzip.compress(response.get_data())
        response.set_data(compressed)
        response.headers["Content-Encoding"] = "gzip"
        response.headers["Content-Length"] = str(len(compressed))
        response.headers.add("Vary", "Accept-Encoding")
    return response

def normalize_hide_date(value):
    """Return a hide date as YYYY-MM-DD for the fa_analysis DATE column."""
    if value is None:
        return None
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d")

    text = str(value).strip()
    for date_format in (
        "%Y-%m-%d",
        "%a, %d %b %Y GMT",
        "%d %b %Y GMT",
    ):
        try:
            return datetime.strptime(text, date_format).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None

# ── Group-based access guard (defense in depth — UI also hides these) ─────────
def require_group(*groups):
    """Restrict a mutating route to specific login groups. ADMIN always passes."""
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user_group = session.get('group')
            if user_group != 'ADMIN' and user_group not in groups:
                return jsonify({"ok": False, "error": "You do not have access to this action."}), 403
            return fn(*args, **kwargs)
        return wrapper
    return decorator

# ── Pages ──────────────────────────────────────────────────────────────────────

@app.route("/")
def root_redirect():
    return redirect("/fa_traceability", code=302)

@app.route('/fa_traceability')
def index():
    return render_template("fa_dashboard.html")

@app.route("/endorsement")
def endorsement():
    return render_template("endorsement.html")

# ── Auth ───────────────────────────────────────────────────────────────────────

@app.route("/api/login", methods=["POST"])
def login():
    data  = request.get_json(silent=True)
    emp   = data.get("employee_num", "").strip()
    badge = data.get("badge", "").strip()
    if not emp or not badge:
        return jsonify({"ok": False, "error": "Please enter Employee No. and badge."})
    try:
        row = authenticate(emp, badge)
        if row:
            group = row.get("user_group", "") or ""
            effective_dt = row.get("dataeffective_datetime")
            session['employee_num']  = row['employee_num']
            session['employee_name'] = row.get('employee_name', emp)
            session['group']         = group
            session['date_effective'] = (
                effective_dt.strftime("%Y-%m-%d %H:%M:%S") if effective_dt else None
            )
            return jsonify({"ok": True, "user": {
                "employee_num": row["employee_num"],
                "employee_name": row.get("employee_name", emp),
                "group": group,
            }})
        else:
            return jsonify({"ok": False, "error": "Invalid employee number or badge."})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})
    
# =================================================================================================endorsement
@app.route("/api/endorsement/lookup/<serial_num>", methods=["GET"])
def endorsement_lookup(serial_num):
    """
    Unlike the other lookups, a serial NOT being found is a normal, expected
    case here (it usually means this is the first time the unit is being
    endorsed to FA) — so we return ok:true with found:false rather than an error.
    """
    try:
        row = get_fa_by_serial(serial_num.strip())
        if row is None:
            return jsonify({"ok": True, "found": False})
        clean = {
            k: (str(v) if v is not None and not isinstance(v, (int, float, str, bool)) else v)
            for k, v in row.items()
        }
        return jsonify({"ok": True, "found": True, "row": clean})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

@app.route("/api/endorsement/station_log/<serial_num>", methods=["GET"])
def endorsement_station_log(serial_num):
    """
    Search the active test/production station logs for this serial's most
    recent entry, used to auto-fill Product/Model/Station + remarks
    (remarks -> test_failure) when a brand-new serial is scanned.
    """
    try:
        hit = station_log.find_last_log(serial_num.strip())
        if hit is None:
            return jsonify({"ok": True, "found": False})
        return jsonify({"ok": True, "found": True, "log": hit})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

@app.route("/api/endorsement/products", methods=["GET"])
def endorsement_products():
    """Active customers/products, pulled live from projectsdb (active_customer.py)."""
    try:
        return jsonify({"ok": True, "products": active_projects.get_active_products()})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

@app.route("/api/endorsement/models", methods=["GET"])
def endorsement_models():
    """Models available under a given active product/schema."""
    product = request.args.get("product", "").strip()
    if not product:
        return jsonify({"ok": False, "error": "Missing product."})
    try:
        return jsonify({"ok": True, "models": active_projects.get_models_by_product(product)})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

@app.route("/api/endorsement/stations", methods=["GET"])
def endorsement_stations():
    """Stations available under a given product + model."""
    product = request.args.get("product", "").strip()
    model   = request.args.get("model", "").strip()
    if not product or not model:
        return jsonify({"ok": False, "error": "Missing product or model."})
    try:
        return jsonify({"ok": True, "stations": active_projects.get_stations_by_model(product, model)})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

@app.route("/api/endorsement/update_remarks", methods=["POST"])
@require_group("FA")
def endorsement_update_remarks():
    """
    Best-effort writeback: only called when the scanned unit's production
    station-log row had no remarks, so what the user types into Failure
    Mode here also becomes that row's remarks — not just test_failure in fa.main.
    """
    data = request.get_json(silent=True) or {}
    product    = data.get("product", "").strip()
    model      = data.get("model", "").strip()
    station    = data.get("station", "").strip()
    serial_num = data.get("serial_num", "").strip()
    remarks    = data.get("remarks", "").strip()

    if not (product and model and station and serial_num):
        return jsonify({"ok": False, "error": "Missing product/model/station/serial_num."})

    try:
        updated = station_log.update_remarks(product, model, station, serial_num, remarks)
        return jsonify({"ok": True, "updated": updated})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})
        
@app.route("/api/endorsement/update", methods=["POST"])
@require_group("FA")
def update_endorsement_route():
    data = request.get_json(silent=True) or {}
    serial_num    = data.get("serial_num", "").strip()
    product       = data.get("product", "").strip()
    model         = data.get("model", "").strip()
    station       = data.get("station", "").strip()
    po_num        = data.get("po_num", "").strip()
    test_failure  = data.get("test_failure", "").strip()
    prod_endorser = data.get("prod_endorser", "").strip()
    faendorse_datetime = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    if not serial_num:
        return jsonify({"ok": False, "error": "Serial number is required."})
    if not product or not model or not station:
        return jsonify({"ok": False, "error": "Product, Model and Station are required."})
    if not prod_endorser:
        return jsonify({"ok": False, "error": "Please enter the employee number of the endorser."})
    if not test_failure:
        return jsonify({"ok": False, "error": "Please describe the failure mode."})

    fields = {
        "product":            product,
        "model":              model,
        "station":            station,
        "po_num":             po_num,
        "test_failure":       test_failure,
        "prod_endorser":      prod_endorser,
        "faendorse_datetime": faendorse_datetime,
        "farepair_status":    1,  # Open — awaiting failure analysis
    }
    try:
        create_or_update_endorsement(serial_num, fields)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

# =================================================================================================failure_analysis
@app.route("/api/failure_analysis/lookup/<serial_num>", methods=["GET"])
def fa_lookup(serial_num):
    try:
        row = get_fa_by_serial(serial_num.strip())
        if row is None:
            return jsonify({"ok": False, "error": "Serial number not found."})
        clean = {
            k: (str(v) if v is not None and not isinstance(v, (int, float, str, bool)) else v)
            for k, v in row.items()
        }
        clean["url"] = get_fa_url(clean.get("fa_case"))
        return jsonify({"ok": True, "row": clean})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

@app.route("/api/failure_analysis/options", methods=["GET"])
def fa_options():
    try:
        conn = get_fa_conn()
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT defect_cat FROM fa.fa_analysis WHERE defect_cat IS NOT NULL AND defect_cat != ''")
            defect_rows = cur.fetchall()
        conn.close()
        defect_cat = [r.get("defect_cat") for r in defect_rows if r.get("defect_cat")]
        return jsonify({
            "ok": True,
            "proposed_action": get_distinct_values("proposed_action"),
            "defect_cat": defect_cat,
        })
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

@app.route("/api/failure_analysis/update", methods=["POST"])
@require_group("FA")
def update_fa_route():
    data = request.get_json(silent=True)
    serial_num = data.get("serial_num", "").strip()
    fa_class   = str(data.get("fa_class", "")).strip()
    document_url = data.get("document_url", "").strip()
    faended_datetime = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    if not serial_num:
        return jsonify({"ok": False, "error": "Serial number is required."})
    if fa_class not in ("1", "2", "3", "4"):
        return jsonify({"ok": False, "error": "FA Class must be 1, 2, 3, or 4."})
    if document_url and not document_url.lower().startswith(("http://", "https://")):
        return jsonify({"ok": False, "error": "Document URL must start with http:// or https://."})

    fields = {
        "failure_cause":   data.get("failure_cause", "").strip(),
        "affected_comp":   data.get("affected_comp", "").strip(),
        "fa_pic":          data.get("fa_pic", "").strip(),
        "proposed_action": data.get("proposed_action", "").strip(),
        "defect_cat":      data.get("defect_cat", "").strip(),
        "fa_class":        fa_class,
        "faended_datetime": faended_datetime,
        "farepair_status": 2,
    }
    try:
        row = get_fa_by_serial(serial_num)
        if row is None:
            return jsonify({"ok": False, "error": "Serial number not found."})
        update_fa(serial_num, fields)
        updated_row = get_fa_by_serial(serial_num)
        save_fa_url(updated_row["fa_case"], document_url)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

# =================================================================================================rework
@app.route("/api/rework/lookup/<serial_num>", methods=["GET"])
def rework_lookup(serial_num):
    try:
        row = get_fa_by_serial(serial_num.strip())
        if row is None:
            return jsonify({"ok": False, "error": "Serial number not found."})
        clean = {
            k: (str(v) if v is not None and not isinstance(v, (int, float, str, bool)) else v)
            for k, v in row.items()
        }
        return jsonify({"ok": True, "row": clean})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

@app.route("/api/rework/options", methods=["GET"])
def rework_options():
    try:
        return jsonify({"ok": True, "action_taken": get_distinct_values("action_taken")})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

@app.route("/api/rework/update", methods=["POST"])
@require_group("PROCESS")
def update_rework_route():
    data = request.get_json(silent=True)
    serial_num   = data.get("serial_num", "").strip()
    reworker     = data.get("reworker", "").strip()
    action_taken = data.get("action_taken", "").strip()
    repaired_datetime = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    if not serial_num:
        return jsonify({"ok": False, "error": "Serial number is required."})
    if not reworker:
        return jsonify({"ok": False, "error": "Please enter the employee number of the reworker."})
    if not action_taken:
        return jsonify({"ok": False, "error": "Please select an action taken."})

    fields = {
        "repairer":          reworker,
        "action_taken":      action_taken,
        "repaired_datetime": repaired_datetime,
        "farepair_status":   3,  # mark closed/repaired — adjust to match your status codes
    }
    try:
        row = get_fa_by_serial(serial_num)
        if row is None:
            return jsonify({"ok": False, "error": "Serial number not found."})
        update_rework(serial_num, fields)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

# =================================================================================================return
@app.route("/api/return/lookup/<serial_num>", methods=["GET"])
def return_lookup(serial_num):
    try:
        row = get_fa_by_serial(serial_num.strip())
        if row is None:
            return jsonify({"ok": False, "error": "Serial number not found."})
        clean = {
            k: (str(v) if v is not None and not isinstance(v, (int, float, str, bool)) else v)
            for k, v in row.items()
        }
        return jsonify({"ok": True, "row": clean})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

@app.route("/api/return/update", methods=["POST"])
@require_group("PROCESS")
def return_rework():
    data       = request.get_json(silent=True)
    serial_num = data.get("serial_num", "").strip()
    returner   = data.get("returner", "").strip()
    returned_datetime = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    if not serial_num:
        return jsonify({"ok": False, "error": "Serial number is required."})
    if not returner:
        return jsonify({"ok": False, "error": "Please enter the employee number of the person-in-charge."})

    fields = {
        "returned_datetime": returned_datetime,
        "farepair_status":   4,  # mark returned — adjust to match your status codes
    }
    try:
        row = get_fa_by_serial(serial_num)
        if row is None:
            return jsonify({"ok": False, "error": "Serial number not found."})
        update_rework(serial_num, fields)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

@app.route("/api/change_password", methods=["POST"])
def change_password():
    data    = request.get_json(silent=True)
    cur_b   = data.get("current_badge", "").strip()
    new_b   = data.get("new_badge", "").strip()
    emp_num = session.get("employee_num")
    if not emp_num:
        return jsonify({"ok": False, "error": "Not logged in."})
    if not cur_b or not new_b:
        return jsonify({"ok": False, "error": "Both current and new badge are required."})
    try:
        row = authenticate(emp_num, cur_b)
        if not row:
            return jsonify({"ok": False, "error": "Current badge is incorrect."})

        new_hash = hash_badge(new_b)
        conn = get_fa_conn()
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE fa.userv2 SET badge=%s WHERE employee_num=%s",
                (new_hash, emp_num)
            )
            conn.commit()
        conn.close()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})


@app.route("/api/employees", methods=["GET"])
def get_employees():
    """Return all employee names for selection in admin settings."""
    try:
        conn = get_fa_conn()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT employee_num, employee_name, `group` FROM fa.userv2 WHERE employee_num IS NOT NULL ORDER BY employee_name, employee_num"
            )
            rows = cur.fetchall()
        conn.close()
        employees = [
            {
                "num": r.get("employee_num"),
                "name": r.get("employee_name") or r.get("employee_num"),
                "group": r.get("group") or "",
            }
            for r in rows
        ]
        return jsonify({"ok": True, "employees": employees})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})


@app.route("/api/create_user", methods=["POST"])
@require_group("ADMIN")
def create_user():
    """Create a new FA/PROCESS/ADMIN user with a temporary password."""
    data = request.get_json(silent=True) or {}
    employee_num = (data.get("employee_num") or "").strip()
    employee_name = (data.get("employee_name") or "").strip()
    group = (data.get("group") or "").strip().upper()
    temp_password = (data.get("temp_password") or "").strip()

    if not employee_num or not employee_name or not temp_password:
        return jsonify({"ok": False, "error": "Employee number, name, and temporary password are required."})
    if group not in ("ADMIN", "FA", "PROCESS"):
        return jsonify({"ok": False, "error": "Group must be ADMIN, FA, or PROCESS."})

    try:
        conn = get_fa_conn()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT employee_num FROM fa.userv2 WHERE employee_num = %s LIMIT 1",
                (employee_num,),
            )
            if cur.fetchone():
                conn.close()
                return jsonify({"ok": False, "error": f"Employee number {employee_num} already exists."})

            hashed_password = hash_badge(temp_password)
            cur.execute(
                "INSERT INTO fa.userv2 (employee_num, employee_name, badge, `group`) VALUES (%s, %s, %s, %s)",
                (employee_num, employee_name, hashed_password, group),
            )
            conn.commit()
        conn.close()
        return jsonify({"ok": True, "employee_num": employee_num, "group": group})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

# ── FA Data ────────────────────────────────────────────────────────────────────
@app.route("/api/data", methods=["GET"])
def data():
    date_from = request.args.get("date_from", "").strip()
    date_to = request.args.get("date_to", "").strip()
    date_effective = session.get("date_effective")  # None if not set for this user

    cache_key = (date_from, date_to, date_effective)
    now = time.time()
    if _dashboard_data_cache.get("key") == cache_key and _dashboard_data_cache["payload"] is not None and now < _dashboard_data_cache["expires_at"]:
        return jsonify(_dashboard_data_cache["payload"])

    date_clause = ""
    date_params = []
    if not date_from or not date_to:
        return jsonify({"ok": False, "error": "Both date_from and date_to are required."}), 400
    if date_from or date_to:
        try:
            start = datetime.strptime(date_from, "%Y-%m-%d")
            end = datetime.strptime(date_to, "%Y-%m-%d") + timedelta(days=1)
        except ValueError:
            return jsonify({"ok": False, "error": "Dates must use YYYY-MM-DD."}), 400
        if date_from > date_to:
            return jsonify({"ok": False, "error": "date_from cannot be after date_to."}), 400

        # Clamp the requested start to the user's effective date, if one is set.
        # date_effective is stored as "%Y-%m-%d %H:%M:%S" — parse it fully,
        # then compare as datetimes, not as mismatched strings.
        if date_effective:
            effective_start = datetime.strptime(date_effective, "%Y-%m-%d %H:%M:%S")
            if start < effective_start:
                start = effective_start

        date_clause = "WHERE fa_records.faendorse_datetime >= %s AND fa_records.faendorse_datetime < %s"
        date_params = [start, end]

    try:
        conn = get_fa_conn()
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT fa_records.*, fa_links.url
                FROM fa.main AS fa_records
                LEFT JOIN (
                    SELECT fa_case, MAX(link) AS url
                    FROM fa.url
                    GROUP BY fa_case
                ) AS fa_links ON fa_links.fa_case = fa_records.fa_case
                {date_clause}
                ORDER BY fa_records.faendorse_datetime DESC
                """, date_params
            )
            rows = cur.fetchall()
        conn.close()
        clean = []
        for r in rows:
            clean.append({
                k: (str(v) if v is not None and not isinstance(v, (int, float, str, bool)) else v)
                for k, v in r.items()
            })
        payload = {"ok": True, "rows": clean}
        _dashboard_data_cache["key"] = cache_key
        _dashboard_data_cache["payload"] = payload
        _dashboard_data_cache["expires_at"] = now + 5
        return jsonify(payload)
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

@app.route("/api/data_dates", methods=["GET"])
def data_dates():
    """Return available FA endorsement dates without sending full records."""
    date_effective = session.get("date_effective")
    try:
        conn = get_fa_conn()
        with conn.cursor() as cur:
            if date_effective:
                cur.execute(
                    """
                    SELECT DISTINCT DATE(faendorse_datetime) AS fa_date
                    FROM fa.main
                    WHERE faendorse_datetime IS NOT NULL
                      AND faendorse_datetime >= %s
                    ORDER BY fa_date DESC
                    """,
                    (date_effective,)
                )
            else:
                cur.execute(
                    """
                    SELECT DISTINCT DATE(faendorse_datetime) AS fa_date
                    FROM fa.main
                    WHERE faendorse_datetime IS NOT NULL
                    ORDER BY fa_date DESC
                    """
                )
            dates = [row["fa_date"].strftime("%Y-%m-%d") for row in cur.fetchall()]
        conn.close()
        return jsonify({"ok": True, "dates": dates})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

@app.route("/api/run_units", methods=["GET"])
def run_units():
    """Count distinct production serials for a dashboard date/filter set."""
    date_from = request.args.get("date_from", "").strip()
    date_to = request.args.get("date_to", "").strip()
    product = request.args.get("product", "").strip() or None
    model = request.args.get("model", "").strip() or None
    station = request.args.get("station", "").strip() or None

    if not date_from or not date_to:
        return jsonify({"ok": True, "run_units": 0})
    try:
        start = datetime.strptime(date_from, "%Y-%m-%d")
        end = datetime.strptime(date_to, "%Y-%m-%d") + timedelta(days=1)
    except ValueError:
        return jsonify({"ok": False, "error": "Dates must use YYYY-MM-DD."}), 400
    if date_from > date_to:
        return jsonify({"ok": False, "error": "date_from cannot be after date_to."}), 400
    cache_key = (date_from, date_to, product, model, station)
    job = _run_units_jobs.get(cache_key)
    if job is None:
        job = {
            "value": None,
            "refreshing": False,
            "updated_at": 0,
        }
        _run_units_jobs[cache_key] = job

    if not job["refreshing"] and time.time() - job["updated_at"] >= 15:
        job["refreshing"] = True

        def refresh_run_units():
            try:
                job["value"] = active_projects.count_run_units(start, end, product, model, station)
                job["updated_at"] = time.time()
            except Exception as exc:
                print(f"[RunUnits] background refresh failed: {exc}")
            finally:
                job["refreshing"] = False

        _run_units_executor.submit(refresh_run_units)

    return jsonify({
        "ok": True,
        "run_units": job["value"],
        "refreshing": job["refreshing"],
    })
    
def _clean_rows(rows):
    return [
        {k: (str(v) if v is not None and not isinstance(v, (int, float, str, bool)) else v)
         for k, v in r.items()}
        for r in rows
    ]

@app.route("/api/open_farepaire_status", methods=["GET"])
def get_open_fa():
    conn = get_fa_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT serial_num, product, model, po_num, station, test_failure, pro_endorser, faendorse_datetime FROM fa.main WHERE farepair_status IN (1) ORDER BY faendorse_datetime DESC"
            )
            rows = cur.fetchall()
        conn.close()
        return jsonify({"ok": True, "rows": _clean_rows(rows)})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})


@app.route("/api/hide_dates", methods=["GET"])
def get_hide_dates():
    """Fetch all hidden dates from fa.fa_analysis table."""
    try:
        conn = get_fa_conn()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT hide_dates, authorized_person FROM fa.fa_analysis WHERE hide_dates IS NOT NULL"
            )
            rows = cur.fetchall()
        conn.close()
        hide_dates = []
        for row in rows:
            date_value = normalize_hide_date(row.get("hide_dates"))
            if date_value:
                hide_dates.append({
                    "dates": date_value,
                    "authorized_person": row.get("authorized_person", ""),
                })
        return jsonify({"ok": True, "hide_dates": hide_dates})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})


@app.route("/api/authorized_persons", methods=["GET"])
def get_authorized_persons():
    """Fetch all employee names to choose from for hide-date authorization."""
    try:
        conn = get_fa_conn()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT employee_num, employee_name FROM fa.userv2 WHERE employee_num IS NOT NULL ORDER BY employee_name, employee_num"
            )
            rows = cur.fetchall()
        conn.close()
        persons = [
            {"num": r["employee_num"], "name": r.get("employee_name", r["employee_num"])}
            for r in rows
        ]
        return jsonify({"ok": True, "persons": persons})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

@app.route("/api/settings_access", methods=["GET"])
def settings_access():
    """Return whether the signed-in user may manage dashboard hide dates."""
    employee_num = session.get("employee_num")
    if not employee_num:
        return jsonify({"ok": True, "allowed": False})
    if (session.get("group") or "").upper() == "ADMIN":
        return jsonify({"ok": True, "allowed": True})

    try:
        conn = get_fa_conn()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT 1
                FROM fa.fa_analysis
                WHERE authorized_person = %s
                LIMIT 1
                """,
                (employee_num,),
            )
            allowed = cur.fetchone() is not None
        conn.close()
        return jsonify({"ok": True, "allowed": allowed})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

@app.route("/api/authorized_person_save", methods=["POST"])
@require_group("ADMIN")
def save_authorized_person():
    """Record an employee as authorized to manage dashboard settings."""
    data = request.get_json(silent=True) or {}
    authorized_person = str(data.get("authorized_person") or "").strip()
    if not authorized_person:
        return jsonify({"ok": False, "error": "Please select an authorized person."})

    try:
        conn = get_fa_conn()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT employee_num FROM fa.userv2 WHERE employee_num = %s LIMIT 1",
                (authorized_person,),
            )
            if cur.fetchone() is None:
                return jsonify({"ok": False, "error": "Employee was not found."})
            cur.execute(
                "SELECT 1 FROM fa.fa_analysis WHERE authorized_person = %s LIMIT 1",
                (authorized_person,),
            )
            if cur.fetchone() is None:
                cur.execute(
                    "INSERT INTO fa.fa_analysis (authorized_person) VALUES (%s)",
                    (authorized_person,),
                )
            conn.commit()
        conn.close()
        return jsonify({"ok": True, "authorized_person": authorized_person})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})


@app.route("/api/hide_dates_save", methods=["POST"])
def save_hide_dates():
    """Append missing hidden-date rows for one authorized person."""
    data = request.get_json(silent=True) or {}
    hide_dates_str = str(data.get("hide_dates") or "").strip()
    authorized_person = str(data.get("authorized_person") or "").strip() or session.get("employee_num")
    raw_hide_dates = [date.strip() for date in hide_dates_str.split(",") if date.strip()]
    hide_dates = []

    for date in raw_hide_dates:
        normalized_date = normalize_hide_date(date)
        if not normalized_date:
            return jsonify({"ok": False, "error": f"Invalid hide date: {date}"})
        hide_dates.append(normalized_date)

    if not session.get("employee_num"):
        return jsonify({"ok": False, "error": "Not logged in."}), 401
    is_admin = (session.get("group") or "").upper() == "ADMIN"
    if not is_admin and authorized_person != session.get("employee_num"):
        return jsonify({"ok": False, "error": "You are not authorized to update these settings."}), 403

    try:
        conn = get_fa_conn()
        with conn.cursor() as cur:
            if not is_admin:
                cur.execute(
                    "SELECT 1 FROM fa.fa_analysis WHERE authorized_person = %s LIMIT 1",
                    (session.get("employee_num"),),
                )
                if cur.fetchone() is None:
                    conn.close()
                    return jsonify({"ok": False, "error": "You are not authorized to update these settings."}), 403
            for hide_date in hide_dates:
                cur.execute(
                    """
                    SELECT 1
                    FROM fa.fa_analysis
                    WHERE hide_dates = %s AND authorized_person = %s
                    LIMIT 1
                    """,
                    (hide_date, authorized_person),
                )
                if cur.fetchone() is None:
                    cur.execute(
                        """
                        INSERT INTO fa.fa_analysis (hide_dates, authorized_person)
                        VALUES (%s, %s)
                        """,
                        (hide_date, authorized_person)
                    )
            conn.commit()
        conn.close()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

@app.route("/api/wip_farepair_status", methods=["GET"])
def get_wip_fa():
    conn = get_fa_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM fa.main WHERE farepair_status IN (2) ORDER BY faendorse_datetime DESC"
            )
            rows = cur.fetchall()
        conn.close()
        return jsonify({"ok":True, "rows":_clean_rows(rows)})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

@app.route("/api/closed_farepair_status", methods=["GET"])
def get_close_fa():
    conn = get_fa_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM fa.main WHERE farepair_status IN (4) ORDER BY faendorse_datetime DESC"
            )
            rows = cur.fetchall()
        conn.close()
        return jsonify({"ok":True, "rows":_clean_rows(rows)})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

if __name__ == "__main__":
    # threading.Timer(1.2, open_browser).start()
    app.run(host="0.0.0.0", port=5007, debug=True, use_reloader=False)