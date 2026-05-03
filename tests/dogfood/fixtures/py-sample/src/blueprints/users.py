from flask import Blueprint

from ..models import User

users_bp = Blueprint("users", __name__, url_prefix="/users")


@users_bp.route("/")
def list_users():
    return [User(id=1, name="root").display()]


@users_bp.route("/<int:user_id>")
def get_user(user_id: int):
    return User(id=user_id, name="x").display()
