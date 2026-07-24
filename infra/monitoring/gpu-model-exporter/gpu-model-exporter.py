#!/usr/bin/env python3
"""Tiny Prometheus exporter: which model is loaded on which GPU.

dcgm-exporter gives numeric GPU metrics but not *what model* occupies each GPU. This maps every
GPU compute process (vLLM / ollama) to its model + port by walking process cmdlines, and exposes:

  gpu_model_vram_bytes{gpu,model,framework,port,pid,user}   VRAM used by that model process
  gpu_model_info{gpu,model,framework,port,pid,user} 1        presence (1)

Stdlib only. Run on the host (reads /proc + nvidia-smi); Prometheus scrapes it.
  python3 gpu-model-exporter.py            # serves :9836/metrics
"""
import os
import pwd
import re
import subprocess
try:
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
except ImportError:  # py3.6(data01): ThreadingHTTPServer는 3.7+ — MixIn으로 동등 구성
    from http.server import BaseHTTPRequestHandler, HTTPServer
    from socketserver import ThreadingMixIn

    class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
        daemon_threads = True

PORT = int(os.environ.get("GPU_MODEL_EXPORTER_PORT", "9836"))


def _user_for_pid(pid):
    """PID 소유 OS 계정명. 계약대로 unknown / uid:<n> 폴백."""
    if not pid:
        return "unknown"
    try:
        with open(f"/proc/{pid}/status") as f:
            for line in f:
                if line.startswith("Uid:"):
                    uid = int(line.split()[1])  # real uid
                    try:
                        return pwd.getpwuid(uid).pw_name
                    except KeyError:
                        return f"uid:{uid}"
    except Exception:
        pass
    return "unknown"


def _run(args):
    try:
        return subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=10).stdout
    except Exception:
        return ""


def _cmdline(pid):
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return f.read().replace(b"\x00", b" ").decode("utf-8", "replace").strip()
    except Exception:
        return ""


def _ppid(pid):
    try:
        with open(f"/proc/{pid}/stat") as f:
            # ppid is field 4; comm (field 2) may contain spaces/parens, so split after ')'
            return int(f.read().rsplit(")", 1)[1].split()[1])
    except Exception:
        return 0


def _uuid_to_index():
    out = _run(["nvidia-smi", "--query-gpu=index,uuid", "--format=csv,noheader,nounits"])
    m = {}
    for line in out.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) == 2:
            m[parts[1]] = parts[0]
    return m


def _label(v):
    return str(v).replace("\\", "\\\\").replace('"', '\\"')


def _model_for_pid(pid):
    """Return (model, framework, port) by inspecting the process (and its vLLM launcher parent)."""
    cmd = _cmdline(pid)
    if "llama-server" in cmd or "ollama" in cmd:
        model = _ollama_loaded_model() or "ollama"
        return (model, "ollama", "11434")
    # vLLM workers re-title themselves; climb to the launcher (`vllm serve` or api_server module).
    cur = pid
    for _ in range(6):
        c = _cmdline(cur)
        if "vllm" in c and ("serve" in c or "api_server" in c or "entrypoints" in c):
            m = (re.search(r"--served-model-name\s+(\S+)", c)
                 or re.search(r"--model\s+(\S+)", c)
                 or re.search(r"\bserve\s+(\S+)", c))
            model = os.path.basename(m.group(1).rstrip("/")) if m else "vllm"
            port = re.search(r"--port\s+(\d+)", c)
            return (model, "vllm", port.group(1) if port else "")
        nxt = _ppid(cur)
        if nxt <= 1 or nxt == cur:
            break
        cur = nxt
    # 일반 GPU 프로세스(uvicorn/python 앱 등) — best-effort 이름 + 포트(unknown 대신).
    port = re.search(r"--port\s+(\d+)", cmd)
    p = port.group(1) if port else ""
    mu = re.search(r"uvicorn\s+(\S+?):", cmd)
    if mu:
        return (mu.group(1), "uvicorn", p)
    mp = re.search(r"(\S+\.py)\b", cmd)
    if mp:
        return (os.path.basename(mp.group(1)), "python", p)
    return ("unknown", "unknown", p)


_OLLAMA_CACHE = {"v": None}


def _ollama_loaded_model():
    # Best-effort: ask ollama which model is currently loaded.
    import json
    import urllib.request

    try:
        with urllib.request.urlopen("http://127.0.0.1:11434/api/ps", timeout=2) as r:
            models = json.load(r).get("models", [])
            if models:
                return "ollama:" + models[0].get("name", "?")
    except Exception:
        pass
    return None


def _gpu_totals():
    """Per-GPU total/used/free VRAM (bytes) from nvidia-smi — for 'used of total' display."""
    out = _run(
        ["nvidia-smi", "--query-gpu=index,memory.total,memory.used,memory.free",
         "--format=csv,noheader,nounits"]
    )
    rows = []
    for line in out.strip().splitlines():
        p = [x.strip() for x in line.split(",")]
        if len(p) != 4:
            continue
        gpu, total, used, free = p
        mib = 1024 * 1024
        rows.append((gpu, int(float(total)) * mib, int(float(used)) * mib, int(float(free)) * mib))
    return rows


def collect():
    u2i = _uuid_to_index()
    out = _run(
        [
            "nvidia-smi",
            "--query-compute-apps=gpu_uuid,pid,used_memory",
            "--format=csv,noheader,nounits",
        ]
    )
    lines = [
        "# HELP gpu_model_vram_bytes VRAM (bytes) used by a model process, by GPU/model.",
        "# TYPE gpu_model_vram_bytes gauge",
    ]
    info = [
        "# HELP gpu_model_info Model present on a GPU (value always 1).",
        "# TYPE gpu_model_info gauge",
    ]
    for line in out.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) != 3:
            continue
        uuid, pid, mem_mib = parts
        gpu = u2i.get(uuid, "?")
        try:
            vram = int(float(mem_mib)) * 1024 * 1024
        except ValueError:
            vram = 0
        model, fw, port = _model_for_pid(pid)
        user = _user_for_pid(pid)  # PID 소유 OS 계정 (SRE 백로그 #8: 사용자별 귀속)
        labels = (
            f'gpu="{_label(gpu)}",model="{_label(model)}",'
            f'framework="{_label(fw)}",port="{_label(port)}",pid="{_label(pid)}",'
            f'user="{_label(user)}"'
        )
        lines.append(f"gpu_model_vram_bytes{{{labels}}} {vram}")
        info.append(f"gpu_model_info{{{labels}}} 1")

    totals = [
        "# HELP gpu_vram_total_bytes Total VRAM on the GPU.",
        "# TYPE gpu_vram_total_bytes gauge",
        "# HELP gpu_vram_used_bytes VRAM in use on the GPU (all processes).",
        "# TYPE gpu_vram_used_bytes gauge",
        "# HELP gpu_vram_free_bytes Free VRAM on the GPU.",
        "# TYPE gpu_vram_free_bytes gauge",
    ]
    for gpu, total, used, free in _gpu_totals():
        totals.append(f'gpu_vram_total_bytes{{gpu="{_label(gpu)}"}} {total}')
        totals.append(f'gpu_vram_used_bytes{{gpu="{_label(gpu)}"}} {used}')
        totals.append(f'gpu_vram_free_bytes{{gpu="{_label(gpu)}"}} {free}')

    return "\n".join(lines + info + totals) + "\n"


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
