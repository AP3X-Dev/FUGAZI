def command(fn):
    return fn


def option(_name):
    def deco(fn):
        return fn
    return deco


@command
@option("--verbose")
def run(verbose):
    return verbose


@command
@option("--out")
def export(out):
    return out
