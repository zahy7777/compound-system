"""只有完整版本写入和标签集合读取。"""


class Kernel:
    def __init__(self, repo, protocol):
        self.repo = repo
        self.protocol = protocol

    def write(self, values):
        if not isinstance(values, list):
            raise ValueError('write 输入必须是数组')
        for value in values:
            self.protocol.check(value)
        return self.repo.write(values)

    def read(self, queries):
        if not isinstance(queries, list):
            raise ValueError('read 输入必须是标签集合数组')
        for tags in queries:
            self.protocol.tags(tags)
        return self.repo.read(queries)
