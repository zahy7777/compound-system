class LoopTemplate:
    def __init__(self, repo, protocol):
        self.repo, self.protocol = repo, protocol

    def write(self, values, transaction):
        self.protocol.documents('loop_template', values)
        return self.repo.write(values, transaction)

    def read(self, ids=None, transaction=None):
        self.protocol.ids(ids)
        return self.repo.read(ids, transaction)
