from .handlers import routes


def make_app():
    return routes


if __name__ == "__main__":
    make_app()
