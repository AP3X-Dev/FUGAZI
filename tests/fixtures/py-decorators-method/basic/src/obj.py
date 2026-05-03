class Box:
    def __init__(self):
        self.size = 1

    @property
    def area(self):
        return self.size * self.size

    @classmethod
    def from_size(cls, size):
        b = cls()
        b.size = size
        return b

    @staticmethod
    def is_square(b):
        return True
