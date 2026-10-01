"""森林结构来自本概念 YAML；标签格式来自 event 协议。"""
from pathlib import Path
import yaml
from jsonschema import Draft202012Validator, ValidationError


class ForestProtocol:
    def __init__(self, events):
        self.events = events
        self.schema = yaml.safe_load(Path(__file__).with_name('protocol.yaml').read_text(encoding='utf-8'))

    def document(self, kind, value):
        try:
            Draft202012Validator(dict(self.schema[kind], **{'$defs': self.schema['$defs']})).validate(value)
        except ValidationError as error:
            raise ValueError('森林记录结构错误：' + error.message) from error

    def documents(self, kind, values):
        if not isinstance(values,list): raise ValueError('模板输入必须为数组')
        for value in values: self.document(kind,value)
        ids = [value['id'] for value in values if value['id'] is not None]
        if len(ids) != len(set(ids)): raise ValueError('一次写入不能重复模板 ID')

    def forest(self, nodes, items_only=False):
        for node in nodes:
            self.events.tags([node['tag']])
            if items_only and node['tag']['kind'] != '复利事项': raise ValueError('事项森林只能包含复利事项标签')
            self.forest(node['children'],items_only)

    def ids(self, values):
        if values is not None and (not isinstance(values,list) or any(type(value) is not int or value < 1 for value in values)):
            raise ValueError('模板查询必须为 ID 数组或 null')
