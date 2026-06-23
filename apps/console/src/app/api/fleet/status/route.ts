import { NextResponse } from "next/server";
import { getFleetStatus } from "@/lib/status";

// inventory 로드 + Prometheus 질의는 요청 시점에 (정적 프리렌더 금지)
export const dynamic = "force-dynamic";

/** GET /api/fleet/status → [{ id, ip, os, role, status }] (status ∈ up|down|no-data) */
export async function GET() {
  const fleet = await getFleetStatus();
  return NextResponse.json(fleet);
}
