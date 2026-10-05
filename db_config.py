import os
import pymysql.cursors
from env_config import required_env

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    # python-dotenv is optional; if not installed, we silently continue to use
    # environment variables provided by the runtime.
    pass

DB_HOST = required_env("DB_HOST")
DB_PORT = int(os.getenv("DB_PORT", "3306"))
DB_USER = required_env("DB_USER")
DB_PASSWORD = required_env("DB_PASSWORD")

DB_FA = dict(
    host     = DB_HOST,
    port     = DB_PORT,
    user     = DB_USER,
    password = DB_PASSWORD,
    db       = "fa",
    charset  = "utf8mb4",
    cursorclass = pymysql.cursors.DictCursor,
)
