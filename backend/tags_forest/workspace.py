class Workspace:
    def __init__(self, repo, protocol):
        self.repo, self.protocol = repo, protocol

    def write(self, value, transaction):
        self.protocol.document('workspace', value)
        self.protocol.forest(value['forest'])
        return self.repo.write(value, transaction)

    def read(self, transaction=None):
        return self.repo.read(transaction)
