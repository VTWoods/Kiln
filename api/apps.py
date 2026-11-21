from django.apps import AppConfig
from django.db.backends.signals import connection_created


def _configure_sqlite(sender, connection, **kwargs) -> None:
    if connection.vendor != "sqlite":
        return
    with connection.cursor() as cursor:
        cursor.execute("PRAGMA foreign_keys = ON;")
        cursor.execute("PRAGMA busy_timeout = 5000;")
        db_name = str(connection.settings_dict.get("NAME", ""))
        if db_name and db_name != ":memory:" and "mode=memory" not in db_name:
            cursor.execute("PRAGMA journal_mode = WAL;")


class ApiConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "api"

    def ready(self) -> None:
        connection_created.connect(_configure_sqlite)
