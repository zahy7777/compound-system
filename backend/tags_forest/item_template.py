class ItemTemplate:
    def __init__(self, repo, protocol):
        self.repo, self.protocol = repo, protocol

    def write(self, values, transaction):
        self.protocol.documents('item_template', values)
        for value in values: self.protocol.forest(value['forest'], items_only=True)
        return self.repo.write(values, transaction)

    def read(self, ids=None, transaction=None):
        self.protocol.ids(ids)
        return self.repo.read(ids, transaction)
