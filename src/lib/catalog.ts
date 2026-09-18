export type Connection = {
  id: string;
  name: string;
  rfc: string;
  branch: string;
  site: "sinube" | "facturanube";
  sinubeUser: string;
  communicationPassword: string;
};

type ConnectionInput = Omit<Connection, "communicationPassword"> & { communicationPassword?: string };

const DEFAULT_CONNECTIONS: Omit<Connection, "communicationPassword">[] = [
  { id: "jugos-del-valle", name: "JUGOS DEL VALLE", rfc: "SCM180807MS9", branch: "Matriz", site: "sinube", sinubeUser: "sistemaskinn@gmail.com" },
  { id: "santa-clara", name: "SANTA CLARA", rfc: "SCM180807MS9-1", branch: "Matriz", site: "sinube", sinubeUser: "sistemaskinn@gmail.com" },
  { id: "alpura", name: "ALPURA", rfc: "SCM180807MS9-2", branch: "Matriz", site: "sinube", sinubeUser: "sistemaskinn@gmail.com" },
  { id: "jumex", name: "JUMEX", rfc: "SCM180807MS9-6", branch: "Matriz", site: "sinube", sinubeUser: "sistemaskinn@gmail.com" },
];

function connections(): Connection[] {
  const value = process.env.SINUBE_CONNECTIONS;
  if (!value) throw new Error("Falta configurar SINUBE_CONNECTIONS.");
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error();
    const configured = parsed as ConnectionInput[];
    // Existing deployments may still keep the original JUGOS password inside
    // SINUBE_CONNECTIONS. Use it as a backwards-compatible shared password.
    const sharedPassword = process.env.SINUBE_COMMUNICATION_PASSWORD ?? configured.find((item) => item.communicationPassword)?.communicationPassword;
    const configuredOnly = configured.filter((item) => !DEFAULT_CONNECTIONS.some((defaultItem) => defaultItem.id === item.id));
    return [...DEFAULT_CONNECTIONS, ...configuredOnly].map((defaultItem) => {
      const candidate = { ...defaultItem, ...configured.find((item) => item.id === defaultItem.id) };
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

