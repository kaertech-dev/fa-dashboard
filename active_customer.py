# active_customer.py
from database import projects_engine
import time
from datetime import datetime
from sqlalchemy import text

_CACHE = {
    'active_products': (None, 0),
    'models': {},
    'stations': {},
    'auth': {},
    'users': (None, 0),
    'tester_records': (None, 0),
    'process_records': (None, 0),
    'pe_users': (None, 0),
}
_CACHE_TTL = 300  # seconds

class Customer:
    """Reads active projects from projectsdb via SQLAlchemy engine."""

    def get_active_customer(self):
        try:
            with projects_engine.connect() as conn:
                result = conn.execute(text("""
                    SELECT schemadb FROM projects
                    WHERE status IN ('ACTIVE', 'active', 'Active')
                """))
                return [{'id': r[0], 'name': r[0]} for r in result]
        except Exception as e:
            print(f"[Customer] {e}")
            return []

# ── Model ─────────────────────────────────────────────────────────────────────

class Model:
    """Reads table names from per-product schemas."""

    def get_models_for_customer(self, schemadb):
        try:
            # Connect directly to the specific schema
            # Can't easily change database context on the fly with engines safely across threads,
            # so we'll execute a USE statement if supported, or schema-qualify SHOW TABLES.
            # SHOW TABLES FROM `<schemadb>` is the safest way.
            with projects_engine.connect() as conn:
                result = conn.execute(text(f"SHOW TABLES FROM `{schemadb}`"))
                rows = result.fetchall()
            if not rows:
                return []
            names = [r[0] for r in rows]
            models = sorted(set(n.split('_')[0] for n in names))
            return [{'id': m, 'name': m} for m in models]
        except Exception as e:
            print(f"[Model] models for '{schemadb}': {e}")
            return []

    def get_stations_for_model(self, schemadb, model_name):
        try:
            with projects_engine.connect() as conn:
                result = conn.execute(text(f"SHOW TABLES FROM `{schemadb}`"))
                rows = result.fetchall()
            if not rows:
                return []
            names = [r[0] for r in rows]
            prefix = model_name + '_'
            
            _OLD_SUFFIXES = ('_old', '_old2', '_copy', '_2', 'old','oldv2', '_tochange', 'progtest(old)')
            
            stations = sorted(set(
                n[len(prefix):] for n in names
                if n.startswith(prefix)
                and not n[len(prefix):].lower().endswith(_OLD_SUFFIXES)  # ← filter here
            ))
            return [{'id': s, 'name': s} for s in stations]
        except Exception as e:
            print(f"[Model] stations for '{schemadb}'.'{model_name}': {e}")
            return []

# ── ActiveProjects ────────────────────────────────────────────────────────────

class ActiveProjects:
    """Cached wrapper around Customer and Model."""

    def __init__(self):
        self._customer = Customer()
        self._model    = Model()

    def get_active_products(self):
        now = time.time()
        data, ts = _CACHE['active_products']
        if data is not None and now - ts < _CACHE_TTL:
            return data
        data = self._customer.get_active_customer()
        _CACHE['active_products'] = (data, now)
        return data

    def get_models_by_product(self, product_id):
        now = time.time()
        hit = _CACHE['models'].get(product_id)
        if hit and now - hit[1] < _CACHE_TTL:
            return hit[0]
        data = self._model.get_models_for_customer(product_id)
        _CACHE['models'][product_id] = (data, now)
        return data

    def get_stations_by_model(self, product_id, model_name):
        now = time.time()
        key = f"{product_id}.{model_name}"
        hit = _CACHE['stations'].get(key)
        if hit and now - hit[1] < _CACHE_TTL:
            return hit[0]
        data = self._model.get_stations_for_model(product_id, model_name)
        _CACHE['stations'][key] = (data, now)
        return data

# ── StationLog ────────────────────────────────────────────────────────────────

class StationLog:
    """
    Searches every active product's station tables for a serial number's most
    recent test/log entry — used by the Endorsement modal to auto-fill
    Product/Model/Station and pull remarks (-> test_failure).

    Column names vary per station table and aren't known in advance, so each
    table's columns are inspected at query time and matched against a list of
    likely candidates below. If your tables use different column names than
    these, add them to the relevant candidate list.
    """

    _SERIAL_CANDIDATES   = ['serial_num', 'serial_number', 'sn', 'serial', 'serialno']
    _REMARKS_CANDIDATES  = ['remarks', 'remark', 'notes', 'note', 'comment', 'comments',
                             'failure_remarks', 'result_remarks', 'description', 'fail_reason', 'fail_reason', 'failure_reason']
    _DATETIME_CANDIDATES = ['datetime', 'test_datetime', 'log_datetime', 'created_at',
                             'timestamp', 'date_time', 'test_date', 'date']

    def __init__(self, active_projects=None):
        self._active = active_projects or ActiveProjects()

    def _columns(self, schemadb, table):
        try:
            with projects_engine.connect() as conn:
                result = conn.execute(text(f"SHOW COLUMNS FROM `{schemadb}`.`{table}`"))
                return [r[0] for r in result]
        except Exception as e:
            print(f"[StationLog] columns for '{schemadb}'.'{table}': {e}")
            return []

    def _pick(self, columns, candidates):
        lower = {c.lower(): c for c in columns}
        for cand in candidates:
            if cand in lower:
                return lower[cand]
        return None

    def _query_table(self, schemadb, model, station, table, serial_num):
        columns = self._columns(schemadb, table)
        if not columns:
            return None

        serial_col = self._pick(columns, self._SERIAL_CANDIDATES)
        if not serial_col:
            # This table doesn't look like it has a serial number column — skip it.
            return None

        remarks_col = self._pick(columns, self._REMARKS_CANDIDATES)
        dt_col      = self._pick(columns, self._DATETIME_CANDIDATES)

        order_col = dt_col or self._pick(columns, ['id'])
        order_sql = f"ORDER BY `{order_col}` DESC" if order_col else ""

        try:
            with projects_engine.connect() as conn:
                sql = (
                    f"SELECT * FROM `{schemadb}`.`{table}` "
                    f"WHERE `{serial_col}` = :serial {order_sql} LIMIT 1"
                )
                result = conn.execute(text(sql), {"serial": serial_num})
                row = result.mappings().fetchone()
        except Exception as e:
            print(f"[StationLog] query '{schemadb}'.'{table}': {e}")
            return None

        if not row:
            return None

        return {
            "product":      schemadb,
            "model":        model,
            "station":      station,
            "remarks":      (row.get(remarks_col) if remarks_col else None) or "",
            "log_datetime": str(row.get(dt_col)) if dt_col and row.get(dt_col) else None,
        }

    def find_last_log(self, serial_num):
        """
        Brute-force search across every active product's model/station tables
        (lists come from ActiveProjects' cache, but each table is still an
        individual query) for the most recent entry matching `serial_num`.
        Returns a dict {product, model, station, remarks, log_datetime} for
        the single most recent match, or None if nothing was found.

        PERFORMANCE NOTE: this scans every active product × model × station
        table. Fine for a handful of active projects; if this list grows
        large and scanning becomes slow, consider maintaining a consolidated
        index table keyed by serial_num instead of searching per-table live.
        """
        matches = []
        for product in self._active.get_active_products():
            product_id = product['id']
            for model in self._active.get_models_by_product(product_id):
                model_id = model['id']
                for station in self._active.get_stations_by_model(product_id, model_id):
                    station_id = station['id']
                    table = f"{model_id}_{station_id}"
                    hit = self._query_table(product_id, model_id, station_id, table, serial_num)
                    if hit:
                        matches.append(hit)

        if not matches:
            return None

        matches.sort(key=lambda m: m.get("log_datetime") or "", reverse=True)
        return matches[0]