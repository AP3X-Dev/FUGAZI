from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .b import B


class A:
    def link(self, b: "B"):
        return b
