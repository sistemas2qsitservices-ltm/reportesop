import { Connection } from "./catalog";

type Row = Record<string, string | null>;
export type WorkEvent = { folioOrden: string; usuario: string; fechaHora: string; fuente: "Bitácora" | "Creación OP"; producto?: string; descripcion?: string };

const NULL = "&NullSiNube;";
const ROW = "¬";
const ZONE = "America/Mexico_City";

function endpoint(site: Connection["site"]) {
  // SiNube's current HTTPS certificate does not match its Appspot hostname.
  // The documented POST endpoint is therefore called over HTTP until SiNube
  // restores a valid certificate for this hostname.
  return site === "facturanube" ? "http://getpost.facturanube.appspot.com/getpost" : "http://getpost.si-nube.appspot.com/getpost";
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "&SiNubeApostrofo;")}'`;
}

function parseResponse(text: string) {
  if (text.startsWith("Error:")) throw new Error(text);
  const rows = text.split(ROW).filter(Boolean);
  if (!rows.length) return { cursor: NULL, rows: [] as Row[] };
  const header = rows[0].split("|");
  const cursor = header[1] ?? NULL;
  const fields: string[] = [];
  for (let index = 2; index < header.length; index += 2) fields.push(header[index]);
  return {
    cursor,
    rows: rows.slice(1).map((line) => {
      const values = line.split("|");
      return Object.fromEntries(fields.map((field, index) => [field, values[index] === NULL ? null : values[index] ?? null]));
    }),
  };
}

async function queryAll(connection: Connection, baseSql: string) {
  const output: Row[] = [];
  let cursor: string | undefined;
  do {
    const sql = `${baseSql}\nTAMPAG 200${cursor ? `\nCURSOR ${cursor}` : ""}`;
    const body = new URLSearchParams({ tipo: "3", emp: connection.rfc, suc: connection.branch, usu: connection.sinubeUser, pas: connection.communicationPassword, cns: sql });
    const response = await fetch(endpoint(connection.site), { method: "POST", body, cache: "no-store" });
    if (!response.ok) throw new Error(`SiNube respondió HTTP ${response.status}.`);
    const page = parseResponse(await response.text());
    output.push(...page.rows);
    cursor = page.cursor === NULL ? undefined : page.cursor;
  } while (cursor);
  return output;
}

function datesBetween(from: string, to: string) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(+start) || Number.isNaN(+end) || start > end) throw new Error("El rango de fechas no es válido.");
  const days = Math.floor((+end - +start) / 86400000) + 1;
  if (days > 31) throw new Error("El rango máximo permitido es 31 días.");
  return Array.from({ length: days }, (_, index) => new Date(+start + index * 86400000).toISOString().slice(0, 10));
}

function dayNumber(day: string) { return day.replaceAll("-", ""); }
function inTimeRange(date: Date, from: string, to: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  const value = `${hour}:${minute}`;
  return from <= to ? value >= from && value <= to : value >= from || value <= to;
}

function parseLogDate(value: string) {
  const normalized = value.replaceAll("&DiagonalSiNube;", "/");
  const match = normalized.match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, day, month, year, hour, minute, second] = match;
  return { label: normalized, date: new Date(Date.UTC(2000 + Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))), day: `20${year}-${month}-${day}`, time: `${hour}:${minute}` };
}

function logEvents(folioOrden: string, bitacora: string | null, selectedDays: Set<string>, fromHour: string, toHour: string): WorkEvent[] {
  if (!bitacora) return [];
  return bitacora.split("&PipeSiNube;").flatMap((item) => {
    const [rawDate, rawUser] = item.split(",");
    const parsed = rawDate && parseLogDate(rawDate);
    if (!parsed || !rawUser || !selectedDays.has(parsed.day)) return [];
    const inRange = fromHour <= toHour ? parsed.time >= fromHour && parsed.time <= toHour : parsed.time >= fromHour || parsed.time <= toHour;
    return inRange ? [{ folioOrden, usuario: rawUser.replaceAll("\\@", "@"), fechaHora: parsed.label, fuente: "Bitácora" as const }] : [];
  });
}

function formattedOrderDate(value: string) {
  const date = new Date(Number(value));
  return Number.isNaN(+date) ? null : date;
}

export async function workReport(connection: Connection, from: string, to: string, fromHour: string, toHour: string) {
  if (!/^\d{2}:\d{2}$/.test(fromHour) || !/^\d{2}:\d{2}$/.test(toHour)) throw new Error("Las horas no son válidas.");
  const days = datesBetween(from, to);
  const selectedDays = new Set(days);
  const events: WorkEvent[] = [];
  for (const day of days) {
    const filter = `empresa = ${sqlString(connection.rfc)} AND sucursal = ${sqlString(connection.branch)} AND dia = ${dayNumber(day)}`;
    const [entries, orders] = await Promise.all([
      queryAll(connection, `SELECT folioOrden, bitacoraCantidadAdicional FROM DbAlmEntrada WHERE ${filter} AND tipo = 5`),
      queryAll(connection, `SELECT folioOrden, producto, descripcion, fechaCreacion, usuarioCreo FROM DbOrdenProduccion WHERE ${filter}`),
    ]);
    entries.forEach((entry) => events.push(...logEvents(entry.folioOrden ?? "", entry.bitacoraCantidadAdicional, selectedDays, fromHour, toHour)));
    orders.forEach((order) => {
      const date = order.fechaCreacion && formattedOrderDate(order.fechaCreacion);
      if (!date || !order.usuarioCreo || !order.folioOrden || !inTimeRange(date, fromHour, toHour)) return;
      const formatted = new Intl.DateTimeFormat("es-MX", { timeZone: ZONE, dateStyle: "short", timeStyle: "medium" }).format(date);
      events.push({ folioOrden: order.folioOrden, usuario: order.usuarioCreo.replaceAll("\\@", "@"), fechaHora: formatted, fuente: "Creación OP", producto: order.producto ?? undefined, descripcion: order.descripcion?.replaceAll("&DiagonalSiNube;", "/") ?? undefined });
    });
  }

  // An OP can have activity on a later day than its creation date. Fetch its
  // master record by folio so bitácora rows also receive product/description.
  const detailsByFolio = new Map<string, Pick<WorkEvent, "producto" | "descripcion">>();
  for (const folioOrden of new Set(events.map((event) => event.folioOrden).filter(Boolean))) {
    if (!/^\d+$/.test(folioOrden)) continue;
    const details = await queryAll(
      connection,
      `SELECT folioOrden, producto, descripcion, fechaCreacion, usuarioCreo, fechaModifico, usuarioModifico FROM DbOrdenProduccion WHERE empresa = ${sqlString(connection.rfc)} AND sucursal = ${sqlString(connection.branch)} AND folioOrden = ${folioOrden}`,
    );
    const order = details[0];
    if (order) detailsByFolio.set(folioOrden, {
      producto: order.producto ?? undefined,
      descripcion: order.descripcion?.replaceAll("&DiagonalSiNube;", "/") ?? undefined,
    });
  }

  events.forEach((event, index) => {
    const details = detailsByFolio.get(event.folioOrden);
    if (details) events[index] = { ...event, ...details };
  });
  const merged = new Map<string, WorkEvent>();
  events.forEach((event) => {
    const key = `${event.folioOrden}|${event.usuario}|${event.fechaHora}`;
    const previous = merged.get(key);
    merged.set(key, previous ? { ...previous, fuente: previous.fuente === event.fuente ? event.fuente : "Bitácora" } : event);
  });
  return [...merged.values()].sort((a, b) => a.usuario.localeCompare(b.usuario) || a.folioOrden.localeCompare(b.folioOrden) || a.fechaHora.localeCompare(b.fechaHora));
}

