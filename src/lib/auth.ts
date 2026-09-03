import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const COOKIE = "sinube_report_session";

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET debe tener al menos 32 caracteres.");
  return value;
}

function sign(email: string) {
  const payload = `${email}|${Date.now() + 1000 * 60 * 60 * 12}`;
  const signature = createHmac("sha256", secret()).update(payload).digest("base64url");
  return Buffer.from(`${payload}|${signature}`).toString("base64url");
}

export function validAdministrator(email: string, password: string) {
  const allowed = (process.env.ADMIN_EMAILS ?? "").split(",").map((item) => item.trim().toLowerCase());
  const configured = process.env.ADMIN_PASSWORD ?? "";
  return allowed.includes(email.trim().toLowerCase()) && configured.length > 0 && safeEqual(password, configured);
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sessionCookie(email: string) {
  return { name: COOKIE, value: sign(email.trim().toLowerCase()), httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 12 };
}

export async function requireAdministrator() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return false;
  try {
    const decoded = Buffer.from(token, "base64url").toString();
    const [email, expiry, signature] = decoded.split("|");
    if (!email || !expiry || !signature) return false;
    const expected = createHmac("sha256", secret()).update(`${email}|${expiry}`).digest("base64url");
    return safeEqual(signature, expected) && Number(expiry) > Date.now();
  } catch {
    return false;
  }
}

