"""生成项目专用局域网证书；不会安装证书或修改任何设备的信任设置。"""
from pathlib import Path
import ipaddress, json, os, subprocess

ROOT = Path(__file__).resolve().parents[4]
TLS = ROOT / '.local/tls'

def openssl(*args):
    return subprocess.run(['openssl', *map(str, args)], check=True, capture_output=True, text=True).stdout.strip()

def ensure_tls():
    try: address = subprocess.check_output(['ipconfig', 'getifaddr', 'en0'], text=True).strip()
    except subprocess.CalledProcessError: address = '127.0.0.1'
    ip = ipaddress.ip_address(address)
    if ip.version != 4 or not ip.is_private: raise RuntimeError('本地HTTPS仅允许私有IPv4地址')
    TLS.mkdir(parents=True, exist_ok=True, mode=0o700); TLS.chmod(0o700)
    previous_umask = os.umask(0o077)
    try:
        ca_key, ca_pem = TLS/'root-ca.key', TLS/'root-ca.pem'
        ca_config = TLS/'ca.cnf'
        ca_config.write_text('''[req]
distinguished_name=dn
x509_extensions=ca
prompt=no
[dn]
CN=Qingyang Local Test CA
[ca]
basicConstraints=critical,CA:true,pathlen:0
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
nameConstraints=critical,permitted;DNS:localhost,permitted;IP:127.0.0.0/255.0.0.0,permitted;IP:10.0.0.0/255.0.0.0,permitted;IP:172.16.0.0/255.240.0.0,permitted;IP:192.168.0.0/255.255.0.0
''')
        if not ca_key.exists(): openssl('genrsa', '-out', ca_key, '3072')
        if not ca_pem.exists(): openssl('req', '-x509', '-new', '-key', ca_key, '-sha256', '-days', '365', '-out', ca_pem, '-config', ca_config)
        openssl('x509', '-in', ca_pem, '-checkend', '86400', '-noout')
        config_path = TLS/'config.json'
        prior = json.loads(config_path.read_text()) if config_path.exists() else {}
        key, cert = TLS/'server.key', TLS/'server.pem'
        valid = cert.exists() and subprocess.run(['openssl','x509','-in',str(cert),'-checkend','86400','-noout'],capture_output=True).returncode == 0
        if not valid or not key.exists() or prior.get('ip') != address:
            leaf_config = TLS/'server.cnf'
            leaf_config.write_text(f'''[req]
distinguished_name=dn
prompt=no
[dn]
CN=localhost
[server]
basicConstraints=critical,CA:false
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,IP:127.0.0.1,IP:{address}
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
''')
            if not key.exists(): openssl('genrsa','-out',key,'2048')
            csr = TLS/'server.csr'
            openssl('req','-new','-key',key,'-out',csr,'-config',leaf_config)
            openssl('x509','-req','-in',csr,'-CA',ca_pem,'-CAkey',ca_key,'-CAserial',TLS/'root-ca.srl','-CAcreateserial','-out',cert,'-days','30','-sha256','-extfile',leaf_config,'-extensions','server')
        openssl('verify','-CAfile',ca_pem,'-purpose','sslserver',cert)
        openssl('x509','-in',ca_pem,'-outform','DER','-out',TLS/'qingyang-local-ca.cer')
        fingerprint = openssl('x509','-in',ca_pem,'-noout','-sha256','-fingerprint').split('=',1)[1]
        config = {'ip':address,'httpsPort':3443,'caSha256':fingerprint}
        config_path.write_text(json.dumps(config,indent=2))
        for file in TLS.iterdir():
            if file.is_file(): file.chmod(0o600)
        return config
    finally: os.umask(previous_umask)

if __name__ == '__main__':
    config = ensure_tls()
    print(f"局域网HTTPS证书已准备：https://{config['ip']}:3443/nutrition（尚未修改设备信任）")
