import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text

from active_customer import ActiveProjects, StationLog
from database import projects_engine

INDEX_NAME = "idx_run_units_date_serial"


def quote_identifier(value):
    return "`" + value.replace("`", "``") + "`"


def main():
    projects = ActiveProjects()
    checked = 0
    created = 0
    skipped = 0
    failed = 0

    with projects_engine.connect() as conn:
        for product in projects.get_active_products():
            product_id = product["id"]
            for model in projects.get_models_by_product(product_id):
                model_id = model["id"]
                for station in projects.get_stations_by_model(product_id, model_id):
                    table = f"{model_id}_{station['id']}"
                    checked += 1
                    try:
                        columns = [
                            row[0]
                            for row in conn.execute(
                                text(
                                    f"SHOW COLUMNS FROM {quote_identifier(product_id)}."
                                    f"{quote_identifier(table)}"
                                )
                            )
                        ]
                        serial_col = next(
                            (column for column in columns if column.lower() in StationLog._SERIAL_CANDIDATES),
                            None,
                        )
                        date_col = next(
                            (column for column in columns if column.lower() in StationLog._DATETIME_CANDIDATES),
                            None,
                        )
                        if not serial_col or not date_col:
                            skipped += 1
                            continue

                        indexes = conn.execute(
                            text(
                                f"SHOW INDEX FROM {quote_identifier(product_id)}."
                                f"{quote_identifier(table)}"
                            )
                        ).mappings().all()
                        indexed_columns = {}
                        for index in indexes:
                            indexed_columns.setdefault(index["Key_name"], {})[
                                index["Seq_in_index"]
                            ] = index["Column_name"]
                        has_range_index = any(
                            index.get(1) == date_col and index.get(2) == serial_col
                            for index in indexed_columns.values()
                        )
                        if has_range_index:
                            skipped += 1
                            continue

                        conn.execute(
                            text(
                                f"ALTER TABLE {quote_identifier(product_id)}."
                                f"{quote_identifier(table)} ADD INDEX {quote_identifier(INDEX_NAME)} "
                                f"({quote_identifier(date_col)}, {quote_identifier(serial_col)})"
                            )
                        )
                        conn.commit()
                        created += 1
                        print(f"created {product_id}.{table} ({date_col}, {serial_col})")
                    except Exception as exc:
                        failed += 1
                        print(f"failed {product_id}.{table}: {exc}")

    print(f"checked={checked} created={created} skipped={skipped} failed={failed}")


if __name__ == "__main__":
    main()
