from .routes import items_router
from .models import Item


def app():
    return (items_router, Item)


if __name__ == "__main__":
    app()
