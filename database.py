import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import URL

load_dotenv()

def required_env(name):
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Required environment variable {name} is not set")
    return value

# FA production/run-unit source: projectsdb
proj_host=required_env("PROJECTS_DB_HOST")
proj_port=os.getenv("PROJECTS_DB_PORT", "3306")
proj_user=required_env("PROJECTS_DB_USER")
proj_pass=required_env("PROJECTS_DB_PASSWORD")
proj_name=required_env("PROJECTS_DB_NAME")

projects_url = URL.create(
    drivername="mysql+pymysql",
    username=proj_user,
    password=proj_pass,
    host=proj_host,
    port=int(proj_port),
    database=proj_name,
    query={"charset": "utf8mb4"}
)

projects_engine = create_engine(
    projects_url,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,
)
