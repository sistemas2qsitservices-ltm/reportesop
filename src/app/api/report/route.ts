import { NextResponse } from "next/server";
import { requireAdministrator } from "@/lib/auth";
import { getConnection } from "@/lib/catalog";
import { workReport } from "@/lib/sinube";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await requireAdministrator())) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  try {
    const results = await workReport(getConnection(params.get("connection") ?? ""), params.get("from") ?? "", params.get("to") ?? "", params.get("fromHour") ?? "", params.get("toHour") ?? "");
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo generar el reporte." }, { status: 400 });
  }
}

