#!/usr/bin/env python3
"""지식 그래프를 오프라인 단일 HTML로 export한다 (pyvis, CDN 불필요).

LightRAG가 색인 시 자동 산출하는 graph_chunk_entity_relation.graphml을
읽으므로 별도 export 호출이 필요 없다.

사용:
    infra/rag/.venv/bin/python infra/rag/visualize.py [출력.html]
    기본 출력: ~/.local/share/keiwi-rag/knowledge_graph.html
"""

import sys
from pathlib import Path

import networkx as nx
from pyvis.network import Network

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import GRAPHML_PATH, RAG_HOME  # noqa: E402

# entity_type별 색 (KRDS 계열 팔레트)
TYPE_COLORS = {
    "category": "#256ef4",
    "organization": "#0b50d0",
    "person": "#eb003b",
    "location": "#008a21",
    "event": "#9c27b0",
    "technology": "#00838f",
    "equipment": "#e65100",
}
DEFAULT_COLOR = "#607d8b"


def main() -> None:
    if not GRAPHML_PATH.exists():
        raise SystemExit(f"GraphML 없음: {GRAPHML_PATH} — 먼저 ingest.py를 실행하세요.")
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else RAG_HOME / "knowledge_graph.html"

    g = nx.read_graphml(GRAPHML_PATH)
    print(f"[visualize] 노드 {g.number_of_nodes()} · 엣지 {g.number_of_edges()}")

    net = Network(
        height="100vh",
        width="100%",
        bgcolor="#0e1116",
        font_color="#e6e9ef",
        cdn_resources="in_line",  # CDN 없이 단일 HTML(오프라인)
    )
    net.from_nx(g)

    degrees = dict(g.degree())
    for node in net.nodes:
        etype = (node.get("entity_type") or "").strip('"')
        node["color"] = TYPE_COLORS.get(etype, DEFAULT_COLOR)
        node["size"] = 8 + min(degrees.get(node["id"], 1), 30) * 1.5
        title = node.get("description", "")
        node["title"] = f"[{etype or 'unknown'}] {node['id']}\n\n{title}"
    for edge in net.edges:
        if "description" in edge:
            edge["title"] = edge["description"]
        edge["color"] = {"color": "#3b4351", "opacity": 0.6}

    net.set_options("""
    {
      "physics": {
        "solver": "forceAtlas2Based",
        "forceAtlas2Based": {"gravitationalConstant": -60, "springLength": 120},
        "stabilization": {"iterations": 300}
      },
      "interaction": {"hover": true, "tooltipDelay": 120}
    }
    """)
    net.write_html(str(out), open_browser=False, notebook=False)
    print(f"[visualize] 저장: {out}")


if __name__ == "__main__":
    main()
