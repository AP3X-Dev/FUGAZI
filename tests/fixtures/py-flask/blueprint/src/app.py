from .api import api_bp


def create_app():
    return api_bp


if __name__ == "__main__":
    create_app()
