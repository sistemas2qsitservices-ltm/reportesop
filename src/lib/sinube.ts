import { Connection } from "./catalog";

type Row = Record<string, string | null>;
type LotAllocation = {
  loteNivel1: string;
  opNivel2: string;
  idTarimaNivel3: string;
  palletNivel4: string;
  cantidadAsignada: number;
  cantidadLote: number;
};
export type WorkEvent = {
  folioOrden: string;
  usuario: string;
  fechaHora: string;
  fuente: "Bitácora" | "Creación OP" | "Entrada inicial";
  producto?: string;
  descripcion?: string;
  folioAlmEntrada?: string;
  cantidadBitacora?: number;
  lotes?: LotAllocation[];
};

type InternalLogEvent = WorkEvent & { timestamp: number; enRango: boolean };
type Entry = Row & { folioAlmEntrada: string; folioOrden: string };

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

function logEvents(folioOrden: string, folioAlmEntrada: string | null, bitacora: string | null, fromDate: string, toDate: string, fromHour: string, toHour: string): InternalLogEvent[] {
  if (!bitacora) return [];
  return bitacora.split("&PipeSiNube;").flatMap((item) => {
    const [rawDate, rawUser, rawQuantity] = item.split(",");
    const parsed = rawDate && parseLogDate(rawDate);
    // The bitácora timestamp, not the OP creation timestamp, determines whether
    // a warehouse event belongs to the selected date range.
    if (!parsed || !rawUser) return [];
    const inRange = fromHour <= toHour ? parsed.time >= fromHour && parsed.time <= toHour : parsed.time >= fromHour || parsed.time <= toHour;
    const cantidadBitacora = Number(rawQuantity);
    // Keep every valid history line for pallet allocation. enRango controls
    // presentation only: excluding older lines here would make their pallets
    // incorrectly appear again as part of the original entry.
    return [{
      folioOrden,
      folioAlmEntrada: folioAlmEntrada ?? undefined,
      usuario: rawUser.replaceAll("\\@", "@"),
      fechaHora: parsed.label,
      fuente: "Bitácora" as const,
      cantidadBitacora: Number.isFinite(cantidadBitacora) ? cantidadBitacora : undefined,
      timestamp: parsed.date.getTime(),
      enRango: parsed.day >= fromDate && parsed.day <= toDate && inRange,
    }];
  });
}

function removeLevelPrefix(value: string, level: string) {
  const trimmed = value.trim();
  return trimmed.startsWith(level) ? trimmed.slice(1) : trimmed;
}

function lotsFromDetails(details: Row[]) {
  return details.flatMap((detail) => {
    const levels = detail.lotes?.split(",") ?? [];
    const cantidadLote = Number(detail.cantidad);
    if (levels.length < 4 || !Number.isFinite(cantidadLote)) return [];
    const palletNivel4 = removeLevelPrefix(levels[3], "4");
    const palletNumber = Number(palletNivel4);
    return [{
      loteNivel1: removeLevelPrefix(levels[0], "1"),
      opNivel2: removeLevelPrefix(levels[1], "2"),
      idTarimaNivel3: removeLevelPrefix(levels[2], "3"),
      palletNivel4,
      palletNumber: Number.isFinite(palletNumber) ? palletNumber : -1,
      cantidadLote,
    }];
  }).sort((a, b) => b.palletNumber - a.palletNumber || b.palletNivel4.localeCompare(a.palletNivel4));
}

function allocateLots(details: Row[], entryEvents: InternalLogEvent[]) {
  const available = lotsFromDetails(details).map((lot) => ({ ...lot, disponible: lot.cantidadLote }));
  // A bitácora amount is assigned only once. Going from newest to oldest and
  // from highest to lowest pallet leaves the unlinked balance as the initial entry.
  for (const event of [...entryEvents].sort((a, b) => b.timestamp - a.timestamp)) {
    let remaining = event.cantidadBitacora ?? 0;
    const assigned: LotAllocation[] = [];
    for (const lot of available) {
      if (remaining <= 0) break;
      if (lot.disponible <= 0) continue;
      const cantidadAsignada = Math.min(remaining, lot.disponible);
      lot.disponible -= cantidadAsignada;
      remaining -= cantidadAsignada;
      assigned.push({
        loteNivel1: lot.loteNivel1,
        opNivel2: lot.opNivel2,
        idTarimaNivel3: lot.idTarimaNivel3,
        palletNivel4: lot.palletNivel4,
        cantidadAsignada,
        cantidadLote: lot.cantidadLote,
      });
    }
    event.lotes = assigned;
  }
  return available.filter((lot) => lot.disponible > 0).map((lot) => ({
    loteNivel1: lot.loteNivel1,
    opNivel2: lot.opNivel2,
    idTarimaNivel3: lot.idTarimaNivel3,
    palletNivel4: lot.palletNivel4,
    cantidadAsignada: lot.disponible,
    cantidadLote: lot.cantidadLote,
  }));
}

function formatEntryDate(value: string | null) {
  if (!value) return "Entrada inicial";
  const date = new Date(Number(value));
  if (Number.isNaN(+date)) return value;
  return new Intl.DateTimeFormat("es-MX", { timeZone: ZONE, dateStyle: "short", timeStyle: "medium" }).format(date);
}

function localDay(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : "";
}

function isEntryInRange(value: string | null, from: string, to: string, fromHour: string, toHour: string) {
  if (!value) return false;
  const date = formattedOrderDate(value);
  return Boolean(date && localDay(date) >= from && localDay(date) <= to && inTimeRange(date, fromHour, toHour));
}

function formattedOrderDate(value: string) {
  const date = new Date(Number(value));
  return Number.isNaN(+date) ? null : date;
}

export async function workReport(connection: Connection, from: string, to: string, fromHour: string, toHour: string) {
  if (!/^\d{2}:\d{2}$/.test(fromHour) || !/^\d{2}:\d{2}$/.test(toHour)) throw new Error("Las horas no son válidas.");
  const days = datesBetween(from, to);
  const events: WorkEvent[] = [];
  const entriesByFolio = new Map<string, Entry>();
  const allLogEventsByEntrada = new Map<string, InternalLogEvent[]>();

  // The event date is encoded inside bitacoraCantidadAdicional, not indexed in
  // a DbAlmEntrada day/month field. Therefore entries cannot be restricted to
  // the selected entry month: an entry from the 15th can contain an addition on
  // the 17th (or even in a later month). The resulting log lines are filtered
  // below using their own embedded timestamp.
  const entries = await queryAll(
    connection,
    `SELECT folioOrden, folioAlmEntrada, fechaAlmEntrada, bitacoraCantidadAdicional FROM DbAlmEntrada WHERE empresa = ${sqlString(connection.rfc)} AND sucursal = ${sqlString(connection.branch)} AND tipo = 5`,
  );
  entries.forEach((entry) => {
    if (!entry.folioAlmEntrada || !entry.folioOrden) return;
    const typedEntry = entry as Entry;
    entriesByFolio.set(typedEntry.folioAlmEntrada, typedEntry);
    const logLines = logEvents(typedEntry.folioOrden, typedEntry.folioAlmEntrada, typedEntry.bitacoraCantidadAdicional, from, to, fromHour, toHour);
    allLogEventsByEntrada.set(typedEntry.folioAlmEntrada, logLines);
  });

  for (const day of days) {
    const filter = `empresa = ${sqlString(connection.rfc)} AND sucursal = ${sqlString(connection.branch)} AND dia = ${dayNumber(day)}`;
    const orders = await queryAll(connection, `SELECT folioOrden, producto, descripcion, fechaCreacion, usuarioCreo FROM DbOrdenProduccion WHERE ${filter}`);
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
  const foliosConActividad = [
    ...events.map((event) => event.folioOrden),
    ...[...allLogEventsByEntrada.entries()].flatMap(([folioAlmEntrada, logLines]) => {
      const entry = entriesByFolio.get(folioAlmEntrada);
      return logLines.some((event) => event.enRango) || isEntryInRange(entry?.fechaAlmEntrada ?? null, from, to, fromHour, toHour) ? [entry?.folioOrden ?? ""] : [];
    }),
  ];
  for (const folioOrden of new Set(foliosConActividad.filter(Boolean))) {
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

  // Allocate all the entry's bitácora lines, including lines outside the
  // requested range, so a selected historic line does not reuse a pallet that
  // belongs to a newer one. Output only the lines selected by the user.
  for (const [folioAlmEntrada, logLines] of allLogEventsByEntrada) {
    const selectedLines = logLines.filter((event) => event.enRango);
    const entry = entriesByFolio.get(folioAlmEntrada);
    const includeInitialEntry = isEntryInRange(entry?.fechaAlmEntrada ?? null, from, to, fromHour, toHour);
    if ((!selectedLines.length && !includeInitialEntry) || !/^\d+$/.test(folioAlmEntrada)) continue;
    const details = await queryAll(connection, `SELECT folioAlmEntrada, producto, cantidad, lotes FROM DbAlmEntradaDetLote WHERE empresa = ${sqlString(connection.rfc)} AND sucursal = ${sqlString(connection.branch)} AND folioAlmEntrada = ${folioAlmEntrada}`);
    const initialLots = allocateLots(details, logLines);
    events.push(...selectedLines.map(({ timestamp: _timestamp, enRango: _enRango, ...event }) => ({ ...event, ...detailsByFolio.get(event.folioOrden) })));
    if (includeInitialEntry || selectedLines.length) {
      const details = entry && detailsByFolio.get(entry.folioOrden);
      events.push({
        folioOrden: entry?.folioOrden ?? "",
        folioAlmEntrada,
        usuario: "—",
        fechaHora: formatEntryDate(entry?.fechaAlmEntrada ?? null),
        fuente: "Entrada inicial",
        cantidadBitacora: initialLots.reduce((total, lot) => total + lot.cantidadAsignada, 0),
        lotes: initialLots.length ? initialLots : undefined,
        ...details,
      });
    }
  }
  return events.sort((a, b) => a.folioAlmEntrada?.localeCompare(b.folioAlmEntrada ?? "") || a.fechaHora.localeCompare(b.fechaHora) || a.usuario.localeCompare(b.usuario));
}
