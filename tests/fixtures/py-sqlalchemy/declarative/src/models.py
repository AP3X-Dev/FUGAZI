class Base:
    metadata = None


class User(Base):
    __tablename__ = "users"
    id = 1
    name = "x"
