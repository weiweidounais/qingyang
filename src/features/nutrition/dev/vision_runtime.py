#!/usr/bin/env python3
"""本项目私有Ollama；不修改全局安装、Shell配置或云服务账号。"""
from pathlib import Path
import hashlib, json, os, signal, subprocess, sys, tarfile, time, urllib.request

ROOT = Path(__file__).resolve().parents[4]
BASE = ROOT / '.local/ollama'
STATE = ROOT / '.local/m03-ollama-process.json'
VERSION = '0.40.6'
MODEL = 'qwen3-vl:4b-instruct'
URL = 'http://127.0.0.1:11434'

def api(path):
    with urllib.request.urlopen(URL + path, timeout=3) as response:
        return json.load(response)

def start():
    binary = BASE / 'runtime/ollama'
    if not binary.exists():
        print('本机视觉模型未安装；可运行 python3 src/features/nutrition/dev/vision_runtime.py install')
        return False
    try:
        api('/api/version')
        return True
    except Exception:
        pass
    env = os.environ.copy()
    env.update(OLLAMA_HOST='127.0.0.1:11434', OLLAMA_MODELS=str(BASE / 'models'), OLLAMA_NO_CLOUD='1',
               OLLAMA_NUM_PARALLEL='1', OLLAMA_MAX_LOADED_MODELS='1', OLLAMA_CONTEXT_LENGTH='4096')
    with open(ROOT / '.local/m03-ollama.log', 'ab') as log:
        process = subprocess.Popen([str(binary), 'serve'], cwd=ROOT, env=env, stdout=log, stderr=log, start_new_session=True)
    STATE.write_text(json.dumps({'pid': process.pid}))
    for _ in range(50):
        try:
            api('/api/version')
            return True
        except Exception:
            time.sleep(.2)
    raise RuntimeError('本机模型服务未就绪，请查看 .local/m03-ollama.log')

def install():
    if sys.platform != 'darwin' or os.uname().machine != 'arm64':
        raise RuntimeError('此安装脚本面向Apple Silicon Mac；其他平台请按Ollama官方文档安装')
    BASE.mkdir(parents=True, exist_ok=True)
    archive = BASE / 'ollama-darwin.tgz'
    checksums = BASE / 'sha256sum.txt'
    release = f'https://github.com/ollama/ollama/releases/download/v{VERSION}'
    if not (BASE / 'runtime/ollama').exists():
        subprocess.run(['curl', '-fL', '--retry', '2', '-C', '-', '-o', str(archive), release + '/ollama-darwin.tgz'], check=True)
        subprocess.run(['curl', '-fL', '-o', str(checksums), release + '/sha256sum.txt'], check=True)
        expected = next(line.split()[0] for line in checksums.read_text().splitlines() if line.split()[-1].lstrip('*').endswith('ollama-darwin.tgz'))
        if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
            raise RuntimeError('Ollama发行包摘要不符，未执行安装')
        runtime = (BASE / 'runtime').resolve()
        runtime.mkdir(exist_ok=True)
        with tarfile.open(archive) as package:
            for member in package.getmembers():
                target = (runtime / member.name).resolve()
                if not str(target).startswith(str(runtime) + '/'):
                    raise RuntimeError('发行包路径不安全')
                linked = target.parent / member.linkname if member.issym() else runtime / member.linkname
                if (member.issym() or member.islnk()) and not str(linked.resolve()).startswith(str(runtime) + '/'):
                    raise RuntimeError('发行包链接不安全')
            package.extractall(runtime)
    start()
    if not any(m['name'] == MODEL for m in api('/api/tags')['models']):
        request = urllib.request.Request(URL + '/api/pull', data=json.dumps({'model': MODEL}).encode(), headers={'Content-Type': 'application/json'})
        print('下载本地视觉模型，首次需要数GB磁盘和网络，后续启动复用缓存…', flush=True)
        last = None
        with urllib.request.urlopen(request, timeout=120) as response:
            for line in response:
                update = json.loads(line)
                if update.get('error'):
                    raise RuntimeError(update['error'])
                total = update.get('total', 0)
                progress = (update.get('digest'), int(update.get('completed', 0) * 10 / total) if total else update['status'])
                if progress != last:
                    print(update['status'], f"{int(update.get('completed', 0) * 100 / total)}%" if total else '', flush=True)
                    last = progress
    print('本地视觉模型已就绪：' + MODEL)

def stop():
    if not STATE.exists():
        return
    pid = json.loads(STATE.read_text())['pid']
    command = subprocess.run(['ps', '-p', str(pid), '-o', 'command='], capture_output=True, text=True).stdout
    if str(BASE / 'runtime/ollama') in command and 'serve' in command:
        os.kill(pid, signal.SIGTERM)
    STATE.unlink(missing_ok=True)

if __name__ == '__main__':
    action = sys.argv[1] if len(sys.argv) > 1 else 'start'
    if action == 'install':
        install()
    elif action == 'stop':
        stop()
    elif action == 'start':
        start()
    else:
        raise SystemExit('用法：vision_runtime.py [install|start|stop]')
