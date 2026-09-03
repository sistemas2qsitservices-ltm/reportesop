# Reporte de Órdenes de Producción - SiNube

Aplicación Next.js para consultar qué usuarios trabajaron qué órdenes de producción en un rango de fechas y horas.

## Qué consulta

- `DbAlmEntrada`, con `tipo = 5`, por día. Decodifica `bitacoraCantidadAdicional` y conserva los eventos dentro del rango horario.
- `DbOrdenProduccion`, por día. Incluye `usuarioCreo` y `fechaCreacion` dentro del mismo rango.
- Los resultados se combinan por usuario, folio y fecha/hora para evitar duplicados.

Las consultas se hacen solo desde rutas de servidor. El navegador nunca recibe la contraseña de comunicaciones ni las credenciales de SiNube.

## Configuración local

1. Copia `.env.example` como `.env.local`.
2. Define contraseñas reales y al menos un correo administrador.
3. Instala dependencias y ejecuta:

```bash
npm install
npm run dev
```

## Despliegue en Vercel

1. Sube esta carpeta a un repositorio de GitHub.
2. Importa el repositorio desde Vercel.
3. Crea las variables de entorno de `.env.example` en Vercel. `SINUBE_CONNECTIONS` es un secreto y debe contener las credenciales de comunicación.
4. Despliega. Vercel detectará Next.js automáticamente.

## Notas operativas

- El rango máximo es 31 días para evitar consultas costosas. Si se requiere más, ejecuta varios reportes.
- Las consultas usan `TAMPAG 200` y continúan con el cursor que SiNube devuelve hasta recibir `&NullSiNube;`.
- El catálogo se administra hoy mediante `SINUBE_CONNECTIONS`. No se debe guardar una contraseña de comunicaciones en el repositorio.

