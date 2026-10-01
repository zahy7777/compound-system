"""闭环模板完整小事数组历史。"""
from service.repo import VersionStore


class LoopTemplateRepo(VersionStore):
    def __init__(self, db):
        super().__init__(db, 'loop_template_versions', ('events',))
