from pydantic import BaseModel


class User(BaseModel):
    id: int
    name: str

    def display(self) -> str:
        return f"#{self.id} {self.name}"
