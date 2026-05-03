from .obj import Box


def main():
    b = Box()
    return (b.area, Box.from_size(3))
