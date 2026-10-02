"""切片只拥有有序名称数组，不认识小事或森林。"""
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator, ValidationError


class Slice:
    def __init__(self, repo):
        self.repo = repo
        schema = yaml.safe_load(Path(__file__).with_name('protocol.yaml').read_text(encoding='utf-8'))
        self.validator = Draft202012Validator(schema)

    def write(self, names, transaction):
        try:
            self.validator.validate(names)
        except ValidationError as error:
            raise ValueError('切片名称数组错误：' + error.message) from error
        self.repo.write(names, transaction)
        return names

    def read(self):
        return self.repo.read()
