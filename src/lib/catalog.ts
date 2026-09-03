export type Connection = {
  id: string;
  name: string;
  rfc: string;
  branch: string;
  site: "sinube" | "facturanube";
  sinubeUser: string;
  communicationPassword: string;
};

function connections(): Connection[] {
  const value = process.env.SINUBE_CONNECTIONS;
  if (!value) throw new Error("Falta configurar SINUBE_CONNECTIONS.");
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error();
    return parsed as Connection[];
  } catch {
    throw new Error("SINUBE_CONNECTIONS no contiene JSON válido.");
  }
}

export function listConnections() {
  return connections().map(({ communicationPassword, sinubeUser, ...safe }) => safe);
}

export function getConnection(id: string) {
  const connection = connections().find((item) => item.id === id);
  if (!connection) throw new Error("Cliente o sucursal no encontrado.");
  return connection;
}

