from typing import TypedDict


class MyType(TypedDict):
    id: int
    name: str


class UnusedType(TypedDict):
    value: int
