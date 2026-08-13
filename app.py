# app.py
import os
from functools import wraps
from flask import Flask, request, jsonify, render_template, session, redirect
from functions import (
    get_fa_conn, authenticate, hash_badge,
    get_fa_by_serial, get_distinct_values, update_fa, update_rework,
    create_or_update_endorsement,
)
from active_customer import ActiveProjects, StationLog
from datetime import datetime

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "fa_secret_key_change_me")

active_projects = ActiveProjects()
station_log     = StationLog(active_projects)

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
            session['employee_num']  = row['employee_num']
            session['employee_name'] = row.get('employee_name', emp)
            session['group']         = group
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
        return jsonify({"ok": True, "row": clean})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

@app.route("/api/failure_analysis/options", methods=["GET"])
def fa_options():
    try:
        return jsonify({
            "ok": True,
            "proposed_action": get_distinct_values("proposed_action"),
            "defect_cat": get_distinct_values("defect_cat"),
        })
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

@app.route("/api/failure_analysis/update", methods=["POST"])
@require_group("FA")
def update_fa_route():
    data = request.get_json(silent=True)
    serial_num = data.get("serial_num", "").strip()
    fa_class   = str(data.get("fa_class", "")).strip()
    faended_datetime = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    if not serial_num:
        return jsonify({"ok": False, "error": "Serial number is required."})
    if fa_class not in ("1", "2", "3", "4"):
        return jsonify({"ok": False, "error": "FA Class must be 1, 2, 3, or 4."})

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

# ── FA Data ────────────────────────────────────────────────────────────────────
@app.route("/api/data", methods=["GET"])
def data():
    try:
        conn = get_fa_conn()
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM fa.main_copy ORDER BY faendorse_datetime DESC")
            rows = cur.fetchall()
        conn.close()
        clean = []
        for r in rows:
            clean.append({
                k: (str(v) if v is not None and not isinstance(v, (int, float, str, bool)) else v)
                for k, v in r.items()
            })
        return jsonify({"ok": True, "rows": clean})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})
    
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
                "SELECT serial_num, product, model, po_num, station, test_failure, pro_endorser, faendorse_datetime FROM fa.main_copy WHERE farepair_status IN (1) ORDER BY faendorse_datetime DESC"
            )
            rows = cur.fetchall()
        conn.close()
        return jsonify({"ok":True, "rows":_clean_rows(rows)})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

@app.route("/api/wip_farepair_status", methods=["GET"])
def get_wip_fa():
    conn = get_fa_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM fa.main_copy WHERE farepair_status IN (2) ORDER BY faendorse_datetime DESC"
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
                "SELECT * FROM fa.main_copy WHERE farepair_status IN (4) ORDER BY faendorse_datetime DESC"
            )
            rows = cur.fetchall()
        conn.close()
        return jsonify({"ok":True, "rows":_clean_rows(rows)})
    except Exception as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"})

if __name__ == "__main__":
    # threading.Timer(1.2, open_browser).start()
    app.run(host="0.0.0.0", port=5007, debug=True, use_reloader=False)