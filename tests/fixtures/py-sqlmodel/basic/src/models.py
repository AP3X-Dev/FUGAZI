class SQLModel:
    pass


class Hero(SQLModel):
    __tablename__ = "hero"

    def __init__(self, name, secret_name):
        self.name = name
        self.secret_name = secret_name
