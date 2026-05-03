from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .types import MyType


def consume(value: "MyType") -> str:
    return str(value)
