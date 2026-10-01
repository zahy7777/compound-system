"""闭环模板只保存同名小事草稿数组。"""
from pathlib import Path
import yaml
from jsonschema import Draft202012Validator, ValidationError


class LoopProtocol:
    def __init__(self):
        self.validator = Draft202012Validator(yaml.safe_load(Path(__file__).with_name('protocol.yaml').read_text(encoding='utf-8')))

    def documents(self, kind, values):
        if not isinstance(values,list): raise ValueError('模板输入必须为数组')
        ids = []
        for value in values:
            try: self.validator.validate(value)
            except ValidationError as error: raise ValueError('闭环模板结构错误：' + error.message) from error
            names = {event['meta'][0]['text'] for event in value['events']}
            if len(names) != 1: raise ValueError('闭环模板必须使用同一个闭环标签')
            if value['id'] is not None: ids.append(value['id'])
        if len(ids) != len(set(ids)): raise ValueError('一次写入不能重复模板 ID')

    def ids(self, values):
        if values is not None and (not isinstance(values,list) or any(type(value) is not int or value < 1 for value in values)):
            raise ValueError('模板查询必须为 ID 数组或 null')
