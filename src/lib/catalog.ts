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
    const sharedPassword = process.env.SINUBE_COMMUNICATION_PASSWORD;
    return parsed.map((item) => {
      const candidate = item as Omit<Connection, "communicationPassword"> & { communicationPassword?: string };
      const communicationPassword = candidate.communicationPassword ?? sharedPassword;
      if (!communicationPassword) throw new Error("Falta SINUBE_COMMUNICATION_PASSWORD o la contraseña de la conexión.");
      return { ...candidate, communicationPassword };
    });
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

