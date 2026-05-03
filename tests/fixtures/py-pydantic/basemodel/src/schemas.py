class UserSchema:
    id: int
    name: str

    @classmethod
    def from_dict(cls, payload):
        return cls()
