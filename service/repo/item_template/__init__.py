"""事项模板完整森林历史。"""
from service.repo import VersionStore


class ItemTemplateRepo(VersionStore):
    def __init__(self, db):
        super().__init__(db, 'item_template_versions', ('name','forest'))
