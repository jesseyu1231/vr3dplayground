#!/usr/bin/env python3
"""Launch the FastAPI app over HTTPS so Quest Browser can enter WebXR."""

from __future__ import annotations

import argparse
import ipaddress
import shutil
import socket
import subprocess
import sys
import tempfile
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
CERT_PATH = BASE_DIR / 'cert.pem'
KEY_PATH = BASE_DIR / 'key.pem'


def detect_lan_ip() -> str:
    for target in ('8.8.8.8', '1.1.1.1'):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                sock.connect((target, 80))
                ip = sock.getsockname()[0]
                if ip and not ip.startswith('127.'):
                    return ip
        except OSError:
            continue

    try:
        ip = socket.gethostbyname(socket.gethostname())
        if ip and not ip.startswith('127.'):
            return ip
    except OSError:
        pass

    return '127.0.0.1'


def build_openssl_config(lan_ip: str) -> str:
    return f"""[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = {lan_ip}

[v3_req]
subjectAltName = @alt_names
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
IP.1 = {lan_ip}
IP.2 = 127.0.0.1
DNS.1 = localhost
"""


def ensure_certificate(lan_ip: str, force: bool) -> None:
    if not force and CERT_PATH.exists() and KEY_PATH.exists():
        return

    if shutil.which('openssl') is None:
        raise SystemExit('OpenSSL is required to generate a local HTTPS certificate.')

    config_text = build_openssl_config(lan_ip)
    with tempfile.NamedTemporaryFile('w', suffix='.cnf', delete=False) as cfg:
        cfg.write(config_text)
        config_path = Path(cfg.name)

    try:
        subprocess.run(
            [
                'openssl',
                'req',
                '-x509',
                '-nodes',
                '-days',
                '365',
                '-newkey',
                'rsa:2048',
                '-keyout',
                str(KEY_PATH),
                '-out',
                str(CERT_PATH),
                '-config',
                str(config_path),
                '-extensions',
                'v3_req',
            ],
            check=True,
            cwd=BASE_DIR,
        )
    finally:
        config_path.unlink(missing_ok=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Run the 3D AI Environment over HTTPS for Quest Browser.'
    )
    parser.add_argument('--port', type=int, default=8001, help='Port to serve on.')
    parser.add_argument('--ip', help='Override the LAN IP used in the certificate SAN.')
    parser.add_argument(
        '--regen-cert',
        action='store_true',
        help='Regenerate cert.pem/key.pem. Use this after your LAN IP changes.',
    )
    parser.add_argument(
        '--no-reload',
        action='store_true',
        help='Disable uvicorn auto-reload.',
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    lan_ip = args.ip or detect_lan_ip()

    try:
        ipaddress.ip_address(lan_ip)
    except ValueError as exc:
        raise SystemExit(f'Invalid IP address: {lan_ip}') from exc

    ensure_certificate(lan_ip, force=args.regen_cert)

    command = [
        sys.executable,
        '-m',
        'uvicorn',
        'server:app',
        '--host',
        '0.0.0.0',
        '--port',
        str(args.port),
        '--ssl-keyfile',
        str(KEY_PATH),
        '--ssl-certfile',
        str(CERT_PATH),
    ]
    if not args.no_reload:
        command.append('--reload')

    print(f'Quest URL: https://{lan_ip}:{args.port}')
    print('If Quest warns about the certificate, open Advanced and continue.')

    return subprocess.call(command, cwd=BASE_DIR)


if __name__ == '__main__':
    raise SystemExit(main())