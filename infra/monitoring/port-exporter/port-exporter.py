#!/usr/bin/env python3
"""Tiny Prometheus exporter: which process listens on which port (per node).

`node-exporter`/`dcgm` give numeric metrics but not "포트↔프로그램". This walks
`ss -tulnpH` (listening TCP + bound UDP with process) and exposes:

  keiwi_listening_port_info{port,proto,process,pid} 1

Stdlib only. Run on the host as root (ss -p needs privilege to see processes).
Prometheus scrapes it (a `node` label is added per scrape target).
  python3 port-exporter.py            # serves :9986/metrics
"""
import os
import re
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT_EXPORTER_PORT", "9986"))
_PROC = re.compile(r'\(\("([^"]+)",pid=(\d+)')


def _label(v):
    return str(v).replace("\\", "\\\\").replace('"', '\\"')


def _rows():
    """Return deduped [(proto, port, process, pid)] of listening sockets."""
    try:
        out = subprocess.run(
            ["ss", "-tulnpH"], capture_output=True, text=True, timeout=10
        ).stdout
    except Exception:
        return []
    seen, rows = set(), []
    for line in out.strip().splitlines():
        parts = line.split()
        if len(parts) < 5:
            continue
        proto = parts[0]  # tcp | udp
        # Local address:port — field 4 (Netid State Recv-Q Send-Q Local Peer Process).
        local = parts[4]
        if ":" not in local:
            continue
        port = local.rsplit(":", 1)[1]
        if not port.isdigit():
            continue
        m = _PROC.search(line)
        process = m.group(1) if m else "unknown"
        pid = m.group(2) if m else ""
        # dedup 0.0.0.0 vs [::] (같은 포트/프로세스) — proto+port+pid 기준.
        key = (proto, port, pid or process)
        if key in seen:
            continue
        seen.add(key)
        rows.append((proto, port, process, pid))
    return rows


def collect():
    lines = [
        "# HELP keiwi_listening_port_info A process listening on a port (value always 1).",
        "# TYPE keiwi_listening_port_info gauge",
    ]
    for proto, port, process, pid in _rows():
        labels = (
            f'port="{_label(port)}",proto="{_label(proto)}",'
            f'process="{_label(process)}",pid="{_label(pid)}"'
        )
        lines.append(f"keiwi_listening_port_info{{{labels}}} 1")
    return "\n".join(lines) + "\n"


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path not in ("/metrics", "/"):
            self.send_response(404)
            self.end_headers()
            return
        body = collect().encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; version=0.0.4")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass  # quiet


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
