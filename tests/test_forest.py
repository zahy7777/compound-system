import asyncio
import json

import pytest
from aiohttp import ClientSession
from aiohttp.test_utils import TestServer

from backend.api import API
from backend.__main__ import make_app


def node(text,children=()):
    return dict(tag=dict(kind='复利事项',text=text),children=list(children))


def template(name='学习',id=None,deleted=False):
    return dict(id=id,deleted=deleted,name=name,forest=[node('学习',[node('阅读')])])


def draft(name='每日阅读',text=''):
    return dict(system=dict(version_id=None,source_id=None,deleted=False),user=dict(event=text),meta=[dict(kind='闭环',text=name)])


def test_forest_atomic_versions_and_reference(system):
    kernel,repo,_=system
    api=API(kernel)
    identity=api.writeforest(dict(item_templates=[template()]))['item_templates'][0]
    id=identity['id']
    first=api.writeforest(dict(workspace=dict(item_template_id=id,forest=[node('学习')]),item_templates=[template('新名',id)]))
    assert api.readforest(dict(workspace=True,item_templates=None))['item_templates'][0]['name']=='新名'
    with pytest.raises(ValueError,match='不存在'):
        api.writeforest(dict(workspace=dict(item_template_id=999,forest=[]),item_templates=[template('回滚',id)]))
    current=api.readforest(dict(workspace=True,item_templates=[id]))
    assert current['workspace']['version_id']==first['workspace']['version_id']
    assert current['item_templates'][0]['name']=='新名'
    with pytest.raises(ValueError): api.writeforest(dict(item_templates=[template('删除',id,True)]))
    api.writeforest(dict(workspace=dict(item_template_id=None,forest=[]),item_templates=[template('删除',id,True)]))
    assert api.readforest(dict(item_templates=None))['item_templates']==[]
    with repo.connection() as conn:
        assert conn.execute('SELECT COUNT(*) FROM item_template_versions').fetchone()[0]==3
        assert conn.execute('SELECT COUNT(*) FROM workspace_versions').fetchone()[0]==2


def test_forests_reject_unknown_tags_and_non_item_template(system):
    api=API(system[0])
    invalid=template();invalid['forest'][0]['tag']['kind']='业务区域'
    with pytest.raises(ValueError):api.writeforest(dict(item_templates=[invalid]))
    with pytest.raises(ValueError):api.writeforest(dict(workspace=dict(item_template_id=None,forest=[{'tag':{'kind':'未知','text':'x'},'children':[]} ])))
    with pytest.raises(ValueError):api.writeforest(dict(workspace=dict(item_template_id=None,forest=[],extra=1)))
    assert api.readforest(dict(workspace=True))['workspace'] is None


def test_loop_template_append_delete_and_validation(system):
    api=API(system[0])
    id=api.writelooptemplate([dict(id=None,deleted=False,events=[draft(),draft(text='阅读')])])[0]['id']
    api.writelooptemplate([dict(id=id,deleted=False,events=[draft('改名','新内容')])])
    assert api.readlooptemplate([id])[0]['events']==[draft('改名','新内容')]
    for events in ([],[draft('a'),draft('b')],[dict(draft(),system=dict(version_id=1,source_id=1,deleted=False))]):
        with pytest.raises(ValueError):api.writelooptemplate([dict(id=id,deleted=False,events=events)])
    api.writelooptemplate([dict(id=id,deleted=True,events=[draft('改名','新内容')])])
    assert api.readlooptemplate(None)==[]


def test_core_http_routes_and_local_memories_never_enter_backup(system):
    kernel,repo,backup=system
    async def scenario():
        async with TestServer(make_app(kernel,backup)) as server,ClientSession() as client:
            async def post(path,value):
                async with client.post(server.make_url(path),data=json.dumps(value),headers={'Content-Type':'application/json'}) as response:
                    assert response.status==200
                    return await response.json()
            await post('/writeforest',dict(workspace=dict(item_template_id=None,forest=[]),item_templates=[template()]))
            await post('/writelooptemplate',[dict(id=None,deleted=False,events=[draft()])])
            assert (await post('/readforest',dict(workspace=True,item_templates=None)))['workspace']['forest']==[]
            assert len(await post('/readlooptemplate',None))==1
            assert await post('/readevent',[[]])==[[]]
            assert await post('/writeevent',[])==[]
            for path in ('/write','/read','/move','/api/templates'):
                async with client.post(server.make_url(path),json=[]) as response:assert response.status==404
    asyncio.run(scenario())
    backup.flush()
    assert backup.path.read_text(encoding='utf-8')==''
    assert sorted(path.name for path in backup.directory.glob('*.jsonl'))==['logs.jsonl']
    with repo.connection() as conn:
        tables={row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {'event_versions','event_tags','workspace_versions','item_template_versions','loop_template_versions'} <= tables
    assert tables == {'event_versions','event_tags','workspace_versions','item_template_versions','loop_template_versions','backup_progress','timers'}


def test_forest_fold_persistence_and_historical_nodes(system):
    api = API(system[0])
    old = node('学习', [node('阅读')])
    api.writeforest(dict(workspace=dict(item_template_id=None, forest=[old])))
    assert api.readforest(dict(workspace=True))['workspace']['forest'] == [old]
    folded = dict(old, is_fold=True)
    folded['children'][0]['is_fold'] = False
    saved = dict(template(), forest=[folded])
    identity = api.writeforest(dict(item_templates=[saved]))['item_templates'][0]
    saved['id'] = identity['id']
    api.writeforest(dict(workspace=dict(item_template_id=saved['id'], forest=[folded]), item_templates=[saved]))
    memory = api.readforest(dict(workspace=True, item_templates=None))
    assert memory['workspace']['forest'] == [folded]
    assert memory['item_templates'][0]['forest'] == [folded]
    for invalid in ['true', 1, None]:
        with pytest.raises(ValueError):
            api.writeforest(dict(workspace=dict(item_template_id=None, forest=[dict(old, is_fold=invalid)])))
    assert api.readforest(dict(workspace=True))['workspace']['forest'] == [folded]
