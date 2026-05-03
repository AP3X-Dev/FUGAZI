from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .a import A


class B:
    def back(self, a: "A"):
        return a
