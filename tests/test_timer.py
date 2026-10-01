import asyncio
import json

import pytest
from aiohttp import ClientSession
from aiohttp.test_utils import TestServer

from backend.timer import Timer
from backend.__main__ import make_app
from service.repo.timer import TimerRepo
from service.repo.events import EventRepo


def test_timer_clock_transitions_and_repeated_commands(system):
    repo=TimerRepo(system[1]); now=[1000];timer=Timer(repo,lambda:now[0])
    assert timer.read(['unknown'])==[None]
    assert repo.read(['unknown'])==[None]
    assert timer.write('opaque','reset')==dict(key='opaque',state='paused',elapsed_ms=0)
    timer.write('opaque','running');now[0]=1800
    assert timer.write('opaque','running')['elapsed_ms']==800
    now[0]=2200
    assert timer.write('opaque','paused')['elapsed_ms']==1200
    now[0]=9000
    assert timer.write('opaque','paused')['elapsed_ms']==1200
    timer.write('opaque','running');now[0]=9500
    assert timer.read(['opaque'])[0]['elapsed_ms']==1700
    assert repo.read(['opaque'])[0]['elapsed_ms']==1200
    assert timer.write('opaque','reset')==dict(key='opaque',state='paused',elapsed_ms=0)
    assert timer.write('fresh','paused')['elapsed_ms']==0


def test_independent_keys_restart_and_no_event_dependency(system):
    _,db,backup=system;now=[100];timer=Timer(TimerRepo(db),lambda:now[0])
    timer.write('not-an-event','running');now[0]=200;timer.write('another','running')
    restarted=Timer(TimerRepo(EventRepo(db.path)),lambda:now[0])
    now[0]=400
    assert [value['elapsed_ms'] for value in restarted.read(['not-an-event','another'])]==[300,200]
    timer.write('not-an-event','paused');now[0]=800
    assert [value['elapsed_ms'] for value in restarted.read(['not-an-event','another'])]==[300,600]
    assert db.versions_after(0)==[]
    backup.flush();assert backup.path.read_text(encoding='utf-8')==''
    assert list(backup.directory.glob('*.jsonl'))==[backup.path]


@pytest.mark.parametrize('key,state',[('', 'running'),('   ','running'),(3,'paused'),('x','end'),('x',None)])
def test_timer_rejects_invalid_protocol(system,key,state):
    timer=Timer(TimerRepo(system[1]))
    with pytest.raises(ValueError):timer.write(key,state)


def test_timer_http_protocol_and_read_alignment(system):
    async def scenario():
        async with TestServer(make_app(system[0],system[2])) as server,ClientSession() as client:
            async def post(path,value,status=200):
                async with client.post(server.make_url(path),data=json.dumps(value),headers={'Content-Type':'application/json'}) as response:
                    assert response.status==status;return await response.json()
            assert await post('/readtimer',['unknown'])==[None]
            await post('/writetimer',dict(key='any key',state='running'))
            values=await post('/readtimer',['missing','any key','any key'])
            assert values[0] is None and values[1]==values[2] and values[1]['state']=='running'
            assert (await post('/writetimer',dict(key='any key',state='reset')))['elapsed_ms']==0
            await post('/writetimer',dict(key='x',state='running',event_id=1),400)
            await post('/readtimer','x',400)
    asyncio.run(scenario())
