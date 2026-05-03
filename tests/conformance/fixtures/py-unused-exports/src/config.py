from typing import TypedDict


class UsedConfig(TypedDict):
    name: str


class UnusedConfigA(TypedDict):
    a: int


class UnusedConfigB(TypedDict):
    b: int
