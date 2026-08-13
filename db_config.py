import os
import pymysql.cursors
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    # python-dotenv is optional; if not installed, we silently continue to use
    # environment variables provided by the runtime.
    pass

import warnings

# Prefer environment variables when provided. For local development, fall
# back to existing (local) defaults but emit a warning so the developer can
# correct the configuration for production deployments.

def _get_env(name, default=None):
    v = os.getenv(name)
    if v is None or v == '':
        warnings.warn(
            f"Environment variable {name} not set; using default value. "
            f"Do not rely on defaults in production.",
            UserWarning
        )
        return default
    return v

# Defaults retained for local/dev convenience (change in production via env)
DEFAULTS = {
    'DB_HOST': '192.168.1.38',
    'DB_PORT': '3306',
    'DB_USER': 'labeling',
    'DB_PASSWORD': 'labeling',
}

DB_HOST = _get_env('DB_HOST', DEFAULTS['DB_HOST'])
DB_PORT = int(_get_env('DB_PORT', DEFAULTS['DB_PORT']))
DB_USER = _get_env('DB_USER', DEFAULTS['DB_USER'])
DB_PASSWORD = _get_env('DB_PASSWORD', DEFAULTS['DB_PASSWORD'])

DB_FA = dict(
    host     = DB_HOST,
    port     = DB_PORT,
    user     = DB_USER,
    password = DB_PASSWORD,
    db       = "fa",
    charset  = "utf8mb4",
    cursorclass = pymysql.cursors.DictCursor,
)

DB_PROJECTS = dict(
    host     = DB_HOST,
    port     = DB_PORT,
    user     = DB_USER,
    password = DB_PASSWORD,
    db       = "projectsdb",
    charset  = "utf8mb4",
    cursorclass = pymysql.cursors.DictCursor,
)
