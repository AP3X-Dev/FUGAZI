from .schemas import UserSchema


def make_user():
    return UserSchema(id=1, name="x")


if __name__ == "__main__":
    make_user()
