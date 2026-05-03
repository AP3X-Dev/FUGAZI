from flask import Flask

from .blueprints.users import users_bp
from .blueprints.health import health_bp
from .models import User


def create_app() -> Flask:
    app = Flask(__name__)
    app.register_blueprint(users_bp)
    app.register_blueprint(health_bp)
    return app


def seed_user() -> User:
    return User(id=1, name="root")


if __name__ == "__main__":
    create_app().run()
