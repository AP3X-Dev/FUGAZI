from flask import Blueprint

health_bp = Blueprint("health", __name__, url_prefix="/health")


@health_bp.route("/")
def healthcheck():
    return {"status": "ok"}
