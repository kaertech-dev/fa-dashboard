# FA Dashboard

Failure Analysis (FA) traceability web app for Kaertech production. It follows a failed unit from the production floor through failure analysis, repair and return, and shows the results on one dashboard.

- **Endorse** a failed unit from production to FA, with the failure mode taken from the test station log.
- **Analyse** it: cause of failure, affected component, proposed action, defect category and FA class. An FA case number is generated automatically.
- **Rework** and **return** the unit from the process side.
- **Monitor** everything on the dashboard: filters, charts, a Pareto of failure modes, a records table and an Excel export.

Only signed-in, authorised employees can use it.

## How it works

```
Production  --endorse-->  FA engineer  --analyse-->  Process  --rework-->  Process  --return-->  done
 (status 1: open)         (status 2: FA updated)      (status 3: repaired)                       (status 4: returned)
```

| Step | Who | Screen | What is saved in `fa.main` |
| --- | --- | --- | --- |
| Endorsement | FA group | Endorsement | Serial, product, model, station, PO, test failure, endorser, `farepair_status = 1` |
| Failure analysis | FA group | Failure Analysis | Failure cause, affected component, proposed action, defect category, FA class, FA case no., `farepair_status = 2` |
| Rework | PROCESS group | Rework | Repairer, action taken, repaired date and time, `farepair_status = 3` |
| Return | PROCESS group | Return | Returned date and time, `farepair_status = 4` |

**FA case number** format: `FA{year}{day of year}{3-digit counter}`, for example `FA2026282001`. Cases are generated during normal FA updates. To consolidate existing records with the same trimmed, case-insensitive failure cause, product, and model across all days, use the separate `scripts/filter_fa_cases.py` maintenance script. It keeps the first generated case number in each group.

Document URLs are saved against the FA case, not an individual serial. Multiple links can be added without replacing earlier links; scanning or opening any serial in that case shows the case's complete document-link list.

**Endorsement lookup:** scanning a serial searches the product's station tables, takes the last station log, and fills in product, model, station and PO. The station's `remarks` become the failure mode. If a unit has no remarks, the endorser types the failure mode, and it is written back to the station log row.

## Access control

Employees sign in with **employee number + badge**. The badge is stored as a bcrypt hash in `fa.userv2`.

| Group | Can do |
| --- | --- |
| `FA` | Endorsement, Failure Analysis, hide dates |
| `PROCESS` | Rework, Return, hide dates |
| `ADMIN` | Everything above, plus creating users and managing authorised persons |

Every signed-in user can view the dashboard and change their own badge. The server checks the group on each write endpoint. Hiding a button in the page is not what protects it.

## Dashboard

- Filters by product, model, station, status and date range (with **Today**, **Reset** and **Apply Filters**).
- Charts: records by product, by station, by defect category, and a Pareto trend of the most common failure modes.
- A separate **Current Month Status** snapshot shows the current status of units endorsed this calendar month (Open FA, In Progress, Reworked and Closed), regardless of the selected dashboard date range.
- Records table with paging and a failure detail view.
- Excel export of the data.
- **Hide dates:** authorised persons can hide specific dates, with a reason, so they are left out of the dashboard data.

## Tech stack

- Python 3.11, Flask 3, gunicorn
- PyMySQL for the `fa` schema, SQLAlchemy for `projectsdb`
- bcrypt for badge hashing
- Plain HTML, CSS and JavaScript (charts drawn on canvas), and SheetJS for Excel export
- MySQL / MariaDB

## Project structure

```
app.py                      Flask app: pages, login, and all /api routes
functions.py                fa schema helpers: login check, FA case number, saving endorse/FA/rework/return
active_customer.py          Reads active projects, models and stations from projectsdb (cached 5 minutes)
database.py                 SQLAlchemy engine for projectsdb
db_config.py                PyMySQL settings for the fa schema
env_config.py               Fails fast when a required variable is missing
templates/fa_dashboard.html The single-page UI and its modals
static/js/                  fa_dashboard.js (charts, table), endorsement.js, fa_page.js, rework.js, return.js
static/css/                 Styles
scripts/add_run_units_indexes.py   One-off script that adds an index to station tables (see below)
docs/Failure Analysis.txt   Original feature notes
Dockerfile, docker-compose.yml
```

## Data sources

| Schema | Used for |
| --- | --- |
| `fa` | `main` (one row per failed unit), `userv2` (employees, groups, badge hash), `url` (FA document links), `fa_analysis` (authorised persons and hidden dates) |
| `projectsdb` | `projects` table, where `status = ACTIVE` lists the product schemas to read |
| each product schema | One table per `<model>_<station>`. Station logs and test results are read from these, and tables ending in `_old`, `_copy` and similar are ignored |

## Configuration

All settings come from environment variables. The app stops at startup if a required one is missing. For local use you can put them in a `.env` file, which is git-ignored and must never be committed.

| Variable | Required | Description |
| --- | --- | --- |
| `SECRET_KEY` | yes | Signs login sessions. Use a long random string, different for each deployment |
| `DB_HOST` | yes | MySQL host for the `fa` schema |
| `DB_PORT` | no | Default `3306` |
| `DB_USER` | yes | MySQL user for the `fa` schema |
| `DB_PASSWORD` | yes | Password for that user |
| `PROJECTS_DB_HOST` | yes | MySQL host for `projectsdb` and the product schemas |
| `PROJECTS_DB_PORT` | no | Default `3306` |
| `PROJECTS_DB_USER` | yes | User with read access to `projectsdb` and the product schemas |
| `PROJECTS_DB_PASSWORD` | yes | Password for that user |
| `PROJECTS_DB_NAME` | yes | Normally `projectsdb` |

The database user needs `SELECT`, `INSERT` and `UPDATE` on the `fa` schema, and `SELECT` on `projectsdb` and the product schemas.

Generate a `SECRET_KEY` with:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

## Run with Docker (recommended)

```bash
git clone https://github.com/kaertech-dev/fa-dashboard.git
cd fa-dashboard
# create .env with the variables above (chmod 600 on Linux)
docker compose up -d --build
```

The app listens on port **5007**. Open `http://<host>:5007/` and it redirects to `/fa_traceability`.

The container runs gunicorn with 2 workers as a non-root user, and uses the `Asia/Manila` time zone so saved timestamps are local time.

Useful commands:

```bash
docker compose logs -f              # follow the logs
docker compose up -d --build        # update after pulling new code
docker compose down                 # stop
```

## Run locally for development

```bash
python -m venv venv
venv\Scripts\activate               # Linux/macOS: source venv/bin/activate
pip install -r requirements.txt
# create .env with the variables above
python -m flask --app app run --port 5007
```

## Database maintenance script

`scripts/add_run_units_indexes.py` adds the index `idx_run_units_date_serial` to station tables to speed up the run-unit queries.

- Run it **outside shift hours**, because it alters production tables.
- It needs a MySQL account with `ALTER` rights, which the normal app user does not have.
- It is safe to run again: tables that already have the index are skipped.

```bash
python scripts/add_run_units_indexes.py
```

`scripts/filter_fa_cases.py` previews changes to `fa.main.fa_case` for records that share a product, model, and failure cause across all dates. It preserves the lowest/first generated case number in each group. Run without options to preview; pass `--apply` to update only the `fa_case` values.

```bash
python scripts/filter_fa_cases.py
python scripts/filter_fa_cases.py --apply
```

## Deployment rules

- Deploy only from `main`.
- `main` is protected: changes go through a pull request with one approval.
- Keep `.env` out of git. If credentials were ever committed or shared, rotate them.

## Known issues

- The `/endorsement` route renders a template that does not exist and returns an error. Use the Endorsement window from the user menu on the dashboard instead.
- `faended_datetime` is overwritten when a unit is submitted for FA again.
- Dashboard data and the product, model and station lists are cached for a few minutes, so a new record or station can take a moment to show.

## Contributing

1. Branch from `main`, or use `for_development` as the team does today.
2. Open a pull request to `main` and request a review.
3. After merge and deploy, check the login page and one scan on each modal.
