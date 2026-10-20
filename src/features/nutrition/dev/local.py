#!/usr/bin/env python3
"""M03本地开发装配。只管理本项目的进程/数据，不修改团队全局配置。"""
from pathlib import Path
import json, os, signal, socket, subprocess, sys, tarfile, time, urllib.request
from vision_runtime import start as start_vision
from local_tls import ensure_tls

ROOT = Path(__file__).resolve().parents[4]
LOCAL = ROOT / '.local'
DEV = ROOT / 'server/src/modules/nutrition/dev'
STATE = LOCAL / 'm03-processes.json'
MYSQL_VERSION = '8.4.11'
MYSQL = LOCAL / f'mysql/mysql-{MYSQL_VERSION}-macos15-arm64'
SOCKET = '/tmp/qingyang-m03-501.sock'

def run(args, cwd=ROOT):
    subprocess.run([str(x) for x in args], cwd=cwd, check=True)

def alive(pid):
    try: os.kill(pid, 0); return True
    except ProcessLookupError: return False

def stop():
    if not STATE.exists(): return
    state=json.loads(STATE.read_text())
    for key in ['frontend','api']:
        pid=state.get(key)
        if not pid or not alive(pid): continue
        command=subprocess.run(['ps','-p',str(pid),'-o','command='],capture_output=True,text=True).stdout
        if ('server.mjs' in command or 'main.ts' in command) and ('node' in command or 'tsx' in command):
            os.kill(pid,signal.SIGTERM)
    for _ in range(30):
        if all(not alive(state[k]) for k in ['frontend','api'] if state.get(k)):break
        time.sleep(.1)

def available(port):
    with socket.socket() as s:return s.connect_ex(('127.0.0.1',port))==0

def wait_ready(port,path):
    for _ in range(60):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}{path}',timeout=1) as r:
                if r.status==200:return
        except Exception:pass
        time.sleep(.2)
    raise RuntimeError(f'本地服务{port}未就绪，请查看 .local/m03-*.log')

def launch(args,cwd,log):
    stream=open(LOCAL/log,'ab')
    p=subprocess.Popen([str(x) for x in args],cwd=cwd,stdout=stream,stderr=stream,start_new_session=True)
    stream.close();return p.pid

def main():
    LOCAL.mkdir(exist_ok=True)
    if len(sys.argv)>1 and sys.argv[1]=='stop':stop();print('H5与API已停止，MySQL开发数据保留。');return
    major=int(subprocess.check_output(['node','-p','process.versions.node.split(".")[0]'],text=True).strip())
    if major<22:raise RuntimeError('需要Node.js 22或更高版本')
    if not (ROOT/'node_modules/next').exists():run(['npm','ci','--no-audit','--no-fund'])
    if not (DEV/'node_modules/tsx').exists():run(['npm','ci','--no-audit','--no-fund'],DEV)
    link=ROOT/'server/node_modules'
    if not link.exists():link.symlink_to('src/modules/nutrition/dev/node_modules',target_is_directory=True)
    if not MYSQL.exists():
        if sys.platform!='darwin' or os.uname().machine!='arm64':raise RuntimeError('此本地脚本适配Apple Silicon Mac；其他环境请由M01提供MySQL 8.4连接')
        archive=LOCAL/'mysql/mysql.tar.gz';archive.parent.mkdir(exist_ok=True)
        if not archive.exists():
            print('从MySQL官方CDN下载MySQL 8.4（约160MB）…')
            urllib.request.urlretrieve(f'https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-{MYSQL_VERSION}-macos15-arm64.tar.gz',archive)
        with tarfile.open(archive) as t:t.extractall(archive.parent,filter='data')
    data=LOCAL/'mysql/data'
    if not data.exists():run([MYSQL/'bin/mysqld','--no-defaults','--initialize-insecure',f'--basedir={MYSQL}',f'--datadir={data}'])
    pidfile=LOCAL/'mysql/mysql.pid'
    if not pidfile.exists() or not alive(int(pidfile.read_text().strip())):
        run([MYSQL/'bin/mysqld','--no-defaults',f'--basedir={MYSQL}',f'--datadir={data}',f'--socket={SOCKET}','--skip-networking','--mysqlx=0',f'--pid-file={pidfile}',f'--log-error={LOCAL}/mysql/mysql.log','--daemonize'])
    stop()
    if available(3001) or available(3012) or available(3443):raise RuntimeError('3001、3012或3443端口已被其他进程占用；脚本不会停止未登记的服务')
    tls = ensure_tls()
    run([DEV/'node_modules/.bin/tsx','bootstrap.ts'],DEV)
    start_vision()
    run(['npm','run','build'])
    state={}
    try:
        state['api']=launch([DEV/'node_modules/.bin/tsx','main.ts'],DEV,'m03-api.log');STATE.write_text(json.dumps(state))
        wait_ready(3012,'/api/v1/__dev/capabilities')
        state['frontend']=launch(['node','src/features/nutrition/dev/server.mjs'],ROOT,'m03-frontend.log');STATE.write_text(json.dumps(state))
        wait_ready(3001,'/nutrition')
    except Exception:stop();raise
    print('轻养健康饮食模块已启动：http://127.0.0.1:3001/nutrition')
    try:
        ip=subprocess.check_output(['ipconfig','getifaddr','en0'],text=True).strip()
        print(f'同一Wi-Fi手机预览：http://{ip}:3001/nutrition')
    except Exception:pass
    print(f"手机定位设置：http://{tls['ip']}:3001/dev/mobile-setup")
    print(f"手机可信HTTPS入口：https://{tls['ip']}:3443/nutrition（首次需手动信任本项目测试证书）")
    print('本地测试账号；照片保存在本机，Ollama视觉模型需已下载；高德从本机私有配置接入，正式登录、看板和积分待接入。')

if __name__=='__main__':main()
