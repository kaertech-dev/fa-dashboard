import os
import pymysql.cursors

# ── DB configs ─────────────────────────────────────────────────────────────────
DB_FA = dict(
    host     = os.getenv("DB_HOST",     "192.168.1.38"),
    port     = int(os.getenv("DB_PORT", "3306")),
    user     = os.getenv("DB_USER",     "labeling"),
    password = os.getenv("DB_PASSWORD", "labeling"),
    db       = "fa",
    charset  = "utf8mb4",
    cursorclass = pymysql.cursors.DictCursor,
)

DB_PROJECTS = dict(
    host     = os.getenv("DB_HOST",     "192.168.1.38"),
    port     = int(os.getenv("DB_PORT", "3306")),
    user     = os.getenv("DB_USER",     "labeling"),
    password = os.getenv("DB_PASSWORD", "labeling"),
    db       = "projectsdb",
    charset  = "utf8mb4",
    cursorclass = pymysql.cursors.DictCursor,
)
