class Service:
    def __init__(self):
        self.state = 0

    def run(self):
        return self._helper()

    def _helper(self):
        return 1

    def unused_method(self):
        return 2

    def __repr__(self):
        return "Service"
