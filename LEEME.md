# Mis Ventas por Catálogo

App para el celular (Android) que lleva los pedidos, cobros y deudas de las clientas.
Funciona sin internet y los datos se guardan en el teléfono (base de datos SQLite con sql.js).

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La página principal |
| `app.js` | Toda la lógica y la base de datos |
| `style.css` | El diseño (botones grandes, letra clara) |
| `sql-wasm.js` / `sql-wasm.wasm` | SQLite para el navegador (sql.js 1.10.3) |
| `manifest.json` / `sw.js` | Hacen que se instale como app y funcione sin internet |
| `icon-192.png` / `icon-512.png` | Ícono de la app |

## 1. Subirla a internet gratis (GitHub Pages) — una sola vez

1. Cree una cuenta en https://github.com (si no tiene).
2. Botón **New repository** → nombre: `mis-ventas` → **Public** → **Create repository**.
3. En el repositorio, toque **uploading an existing file** y arrastre **todos los archivos** de esta carpeta (no la carpeta, los archivos). Luego **Commit changes**.
4. Vaya a **Settings → Pages**. En *Branch* elija **main** y **/ (root)** → **Save**.
5. Espere 1–2 minutos. El link queda así: `https://SU-USUARIO.github.io/mis-ventas/`

## 2. Instalarla en el teléfono de su mamá

1. Abra el link en **Chrome** del teléfono.
2. Menú de los tres puntitos **⋮** → **Agregar a pantalla principal** (o **Instalar app**).
3. Listo: aparece el ícono rosado **Mis Ventas**. Desde ahí se abre siempre, aun sin internet.
4. En la app: **Copia y ajustes** → escriba su nombre (sale al final de los WhatsApp).

> Importante: los datos viven en ESE teléfono. No le borre los datos a Chrome.

## 3. Cómo se usa (para enseñarle)

- **Nuevo pedido:** elige la clienta (o crea una nueva) → escribe el código o el nombre del producto → lo toca → con **+ / −** cambia la cantidad → **Guardar pedido** → **Enviar por WhatsApp** (le llega el comprobante a la clienta).
- **Registrar pago:** elige la clienta → escribe cuánto dio (o toca **Pagó todo**) → guardar → puede mandar la constancia por WhatsApp.
- **¿Quién me debe?:** sale en la pantalla de inicio. Si alguien lleva más de 15 días sin pagar, aparece un aviso naranja.
- **Recordarle que pague:** en la ficha de la clienta. Manda por WhatsApp el detalle de lo que debe y lo que ya abonó.
- **Productos:** cada mes se cargan los del catálogo nuevo. Se pueden agregar uno por uno o cargar una lista desde Excel (guardada como CSV con columnas: código, nombre, precio).
- **Mes e historial:** cuando llega el catálogo nuevo, **Cerrar mes**. Lo del mes queda en el historial, las deudas siguen, y se pueden copiar los productos para solo cambiar precios. Desde el historial se descarga el mes en Excel.
- **Copia de seguridad:** una vez por semana, **Copia y ajustes → Enviar copia** y mandársela a usted mismo por WhatsApp o guardarla en Drive. Con ese archivo se recupera todo si cambia de teléfono.

## Para hacerle cambios después

Edite los archivos, súbalos de nuevo a GitHub y la app se actualiza sola la próxima vez que su mamá la abra con internet. Si cambia archivos, suba también el número en `sw.js` (`mis-ventas-v1` → `v2`).

## Base de datos (tablas)

`config`, `campanias` (meses), `productos` (por mes), `clientes`, `pedidos`, `detalle_pedido`, `pagos`.
El saldo de cada clienta = suma de sus pedidos − suma de sus pagos (de todos los meses), por eso las deudas no se pierden al cerrar el mes.
