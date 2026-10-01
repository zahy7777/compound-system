"""关闭继承句柄，让 PowerShell 控制脚本返回，不等待后台服务退出。"""
import json
from pathlib import Path
import subprocess
import sys

request = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
flags = subprocess.CREATE_NEW_PROCESS_GROUP
if not request['visible']:
    flags |= subprocess.CREATE_NO_WINDOW
with open(request['stdout'], 'ab') as output, open(request['stderr'], 'ab') as error:
    subprocess.Popen([request['executable'], *request['arguments']], cwd=request['directory'],
                     stdin=subprocess.DEVNULL, stdout=output, stderr=error, close_fds=True,
                     creationflags=flags)
