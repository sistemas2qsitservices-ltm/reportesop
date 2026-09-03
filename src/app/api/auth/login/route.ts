import { NextResponse } from "next/server";
import { sessionCookie, validAdministrator } from "@/lib/auth";

export async function POST(request: Request) {
  const { email, password } = await request.json();
  if (typeof email !== "string" || typeof password !== "string" || !validAdministrator(email, password)) return NextResponse.json({ error: "Credenciales inválidas." }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie(email));
  return response;
}

