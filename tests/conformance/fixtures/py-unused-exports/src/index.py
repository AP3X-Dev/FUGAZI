from .helpers import used_helper
from .config import UsedConfig


def main():
    cfg: UsedConfig = {"name": "x"}
    return used_helper(cfg)
