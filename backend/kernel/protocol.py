"""格式只取自备份仓库协议；不认识页面动作。"""
import copy
from datetime import date
import re

from jsonschema import Draft202012Validator, ValidationError
import yaml


class Protocol:
    def __init__(self, path):
        self.schema = yaml.safe_load(path.read_text(encoding='utf-8'))
        Draft202012Validator.check_schema(self.schema)
        self.version = Draft202012Validator(self.schema)
        request = copy.deepcopy(self.schema)
        system = request['properties']['system']
        system['required'] = ['source_id', 'deleted']
        del system['properties']['version_id']
        system['properties']['source_id']['type'] = ['integer', 'null']
        self.request = Draft202012Validator(request)
        self.tag = Draft202012Validator({'$defs': self.schema['$defs'],
                                         '$ref': '#/$defs/tag'})
        self.kinds = self.schema['x-kinds']
        self.patterns = {kind: {meaning: re.compile(rule['pattern'])
                               for meaning, rule in spec['patterns'].items()}
                         for kind, spec in self.kinds.items()}

    def check(self, value, *, stored=False):
        try:
            (self.version if stored else self.request).validate(value)
        except ValidationError as error:
            raise ValueError(f'事实结构错误：{error.message}') from error
        self.tags(value['meta'], complete=True)

    def tags(self, tags, *, complete=False):
        if not isinstance(tags, list):
            raise ValueError('标签集合必须是数组')
        seen, counts, meanings = set(), {}, set()
        for tag in tags:
            try:
                self.tag.validate(tag)
            except ValidationError as error:
                raise ValueError(f'标签结构错误：{error.message}') from error
            kind, text = tag['kind'], tag['text']
            if kind not in self.kinds:
                raise ValueError(f'未登记 kind：{kind}')
            matches = [(meaning, pattern.fullmatch(text))
                       for meaning, pattern in self.patterns[kind].items()]
            matches = [(meaning, match) for meaning, match in matches if match]
            if len(matches) != 1 or not text.strip():
                raise ValueError(f'{kind}格式不符合协议：{text}')
            meaning, match = matches[0]
            rule = self.kinds[kind]['patterns'][meaning]
            if rule.get('format') == 'date':
                date.fromisoformat(match['value'])
            if kind == '闭环' and not match['name'].strip():
                raise ValueError('闭环名称不能为空')
            if (kind, text) in seen:
                raise ValueError('重复标签')
            seen.add((kind, text))
            counts[kind] = counts.get(kind, 0) + 1
            if complete and self.kinds[kind].get('unique_meanings'):
                if (kind, meaning) in meanings:
                    raise ValueError(f'{kind}意义重复：{meaning}')
                meanings.add((kind, meaning))
        if complete:
            for kind, spec in self.kinds.items():
                count = counts.get(kind, 0)
                if count < spec.get('min', 0) or count > spec.get('max', float('inf')):
                    raise ValueError(f'{kind}数量不符合协议')
