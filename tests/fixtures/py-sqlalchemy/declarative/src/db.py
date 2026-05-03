from .models import Base, User


def init():
    return (Base, User)


if __name__ == "__main__":
    init()
