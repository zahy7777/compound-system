"""八个接口的装配与数据分发，不理解移动或模板启动。"""
from backend.tags_forest.workspace import Workspace
from backend.tags_forest.item_template import ItemTemplate
from backend.tags_forest.protocol import ForestProtocol
from backend.loop_template import LoopTemplate
from backend.loop_template.protocol import LoopProtocol
from service.repo.workspace import WorkspaceRepo
from service.repo.item_template import ItemTemplateRepo
from service.repo.loop_template import LoopTemplateRepo
from service.repo.timer import TimerRepo
from backend.timer import Timer


class API:
    def __init__(self, events):
        self.events = events
        self.db = events.repo
        protocol = ForestProtocol(events.protocol)
        self.workspace = Workspace(WorkspaceRepo(self.db), protocol)
        self.items = ItemTemplate(ItemTemplateRepo(self.db), protocol)
        self.loops = LoopTemplate(LoopTemplateRepo(self.db), LoopProtocol())
        self.timer = Timer(TimerRepo(self.db))

    def writeforest(self, value):
        if not isinstance(value,dict) or not value or set(value) - {'workspace','item_templates'}:
            raise ValueError('writeforest 只接受 workspace 和 item_templates')
        result = {}
        with self.db.transaction() as transaction:
            if 'item_templates' in value: result['item_templates'] = self.items.write(value['item_templates'],transaction)
            if 'workspace' in value: result['workspace'] = self.workspace.write(value['workspace'],transaction)
            current = self.workspace.read(transaction)
            if current and current['item_template_id'] is not None and not self.items.read([current['item_template_id']], transaction):
                raise ValueError('当前事项模板不存在或已删除')
        return result

    def readforest(self, value):
        if not isinstance(value,dict) or set(value) - {'workspace','item_templates'}: raise ValueError('readforest 查询格式错误')
        result = {}
        if 'workspace' in value:
            if value['workspace'] is not True: raise ValueError('workspace 查询必须为 true')
            result['workspace'] = self.workspace.read()
        if 'item_templates' in value: result['item_templates'] = self.items.read(value['item_templates'])
        return result

    def writelooptemplate(self, values):
        with self.db.transaction() as transaction: return self.loops.write(values,transaction)

    def readlooptemplate(self, ids):
        return self.loops.read(ids)

    def writetimer(self, value):
        if not isinstance(value,dict) or set(value) != {'key','state'}: raise ValueError('writetimer 必须包含 key 和 state')
        return self.timer.write(value['key'],value['state'])

    def readtimer(self, keys):
        return self.timer.read(keys)
