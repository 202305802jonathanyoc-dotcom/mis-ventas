/* =========================================================
   Mis Ventas por Catálogo
   App web (PWA) con base de datos SQLite (sql.js) guardada
   en el teléfono (IndexedDB). Funciona sin internet.
   ========================================================= */

let db;                       // base de datos SQLite
const $app = document.getElementById('app');
const $titulo = document.getElementById('titulo');
const $atras = document.getElementById('btnAtras');

// Pedido que se está armando (se pierde si se cierra la app, a propósito)
let borrador = null;

/* ---------- Guardado en el teléfono (IndexedDB) ---------- */
function abrirIDB() {
  return new Promise((ok, mal) => {
    const r = indexedDB.open('mis-ventas', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('datos');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
}
async function leerIDB() {
  const idb = await abrirIDB();
  return new Promise(ok => {
    const r = idb.transaction('datos').objectStore('datos').get('db');
    r.onsuccess = () => ok(r.result || null);
    r.onerror = () => ok(null);
  });
}
async function guardarIDB(bytes) {
  const idb = await abrirIDB();
  return new Promise((ok, mal) => {
    const tx = idb.transaction('datos', 'readwrite');
    tx.objectStore('datos').put(bytes, 'db');
    tx.oncomplete = ok;
    tx.onerror = () => mal(tx.error);
  });
}
let guardando = Promise.resolve();
function guardar() {
  const bytes = db.export();
  guardando = guardando.then(() => guardarIDB(bytes)).catch(e => aviso('No se pudo guardar: ' + e));
  return guardando;
}

/* ---------- Base de datos ---------- */
const ESQUEMA = `
CREATE TABLE IF NOT EXISTS config (clave TEXT PRIMARY KEY, valor TEXT);
CREATE TABLE IF NOT EXISTS campanias (
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL,
  fecha_inicio TEXT NOT NULL, fecha_cierre TEXT, activa INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS productos (
  id INTEGER PRIMARY KEY, campania_id INTEGER NOT NULL REFERENCES campanias(id),
  codigo TEXT NOT NULL, nombre TEXT NOT NULL, precio REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, telefono TEXT, notas TEXT);
CREATE TABLE IF NOT EXISTS pedidos (
  id INTEGER PRIMARY KEY, cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  campania_id INTEGER NOT NULL REFERENCES campanias(id),
  fecha TEXT NOT NULL, total REAL NOT NULL, nota TEXT);
CREATE TABLE IF NOT EXISTS detalle_pedido (
  id INTEGER PRIMARY KEY, pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  codigo TEXT, nombre TEXT, precio REAL NOT NULL, cantidad INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS pagos (
  id INTEGER PRIMARY KEY, cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  campania_id INTEGER NOT NULL REFERENCES campanias(id),
  fecha TEXT NOT NULL, monto REAL NOT NULL, nota TEXT);
CREATE INDEX IF NOT EXISTS ix_prod ON productos(campania_id, codigo);
CREATE INDEX IF NOT EXISTS ix_ped ON pedidos(cliente_id);
CREATE INDEX IF NOT EXISTS ix_pag ON pagos(cliente_id);
`;

function q(sql, p = []) {
  const st = db.prepare(sql); st.bind(p);
  const filas = [];
  while (st.step()) filas.push(st.getAsObject());
  st.free();
  return filas;
}
const q1 = (sql, p) => q(sql, p)[0] || null;
function run(sql, p = []) { db.run(sql, p); }
const ultimoId = () => q1('SELECT last_insert_rowid() AS id').id;

function cfg(clave, valor) {
  if (valor === undefined) { const f = q1('SELECT valor FROM config WHERE clave=?', [clave]); return f ? f.valor : null; }
  run('INSERT INTO config(clave,valor) VALUES(?,?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor', [clave, String(valor)]);
}

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
function nombreMes(d = new Date()) { return `${MESES[d.getMonth()]} ${d.getFullYear()}`; }

function prepararBase() {
  db.run('PRAGMA foreign_keys = ON;');
  db.run(ESQUEMA);
  // v2: marcar productos que no vinieron (no se cobran pero quedan en el historial)
  if (!q('PRAGMA table_info(detalle_pedido)').some(c => c.name === 'no_vino'))
    db.run('ALTER TABLE detalle_pedido ADD COLUMN no_vino INTEGER NOT NULL DEFAULT 0');
  if (!q1('SELECT id FROM campanias WHERE activa=1')) {
    run('INSERT INTO campanias(nombre,fecha_inicio,activa) VALUES(?,?,1)', [nombreMes(), hoy()]);
  }
}
const campania = () => q1('SELECT * FROM campanias WHERE activa=1');

// Saldo de cada clienta = todo lo que ha pedido - todo lo que ha pagado (de todos los meses)
const SQL_SALDOS = `
SELECT c.id, c.nombre, c.telefono,
  IFNULL((SELECT SUM(total) FROM pedidos WHERE cliente_id=c.id),0) AS pedido,
  IFNULL((SELECT SUM(monto) FROM pagos WHERE cliente_id=c.id),0) AS pagado,
  (SELECT MIN(fecha) FROM pedidos WHERE cliente_id=c.id) AS primer_pedido,
  (SELECT MAX(fecha) FROM pagos WHERE cliente_id=c.id) AS ultimo_pago
FROM clientes c`;
function saldoDe(id) {
  const f = q1(SQL_SALDOS + ' WHERE c.id=?', [id]);
  return f ? redondear(f.pedido - f.pagado) : 0;
}

/* ---------- Utilidades ---------- */
const redondear = n => Math.round(n * 100) / 100;
const Q = n => 'Q' + Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
function fechaBonita(f) { if (!f) return ''; const [a, m, d] = f.split('-'); return `${+d} ${MESES[+m-1].slice(0,3).toLowerCase()} ${a}`; }
function diasDesde(f) { if (!f) return 0; return Math.floor((new Date(hoy()) - new Date(f)) / 86400000); }
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function numero(v) { const n = parseFloat(String(v).replace(/[Qq\s,]/g, '')); return isNaN(n) ? NaN : n; }

let tAviso;
function aviso(txt) {
  const a = document.getElementById('aviso');
  a.textContent = txt; a.hidden = false;
  clearTimeout(tAviso); tAviso = setTimeout(() => a.hidden = true, 2600);
}
function ir(ruta) { location.hash = ruta; }

function telefonoWA(t) {
  let d = String(t || '').replace(/\D/g, '');
  if (d.length === 8) d = '502' + d;        // número de Guatemala sin código
  return d;
}
function abrirWhatsApp(tel, texto) {
  const n = telefonoWA(tel);
  const url = n ? `https://wa.me/${n}?text=${encodeURIComponent(texto)}` : `https://wa.me/?text=${encodeURIComponent(texto)}`;
  window.open(url, '_blank');
}

/* ---------- Pantallas ---------- */
const rutas = {
  '': inicio,
  'pedido': pedidoElegirClienta,
  'pedido-productos': pedidoProductos,
  'pago': pagoElegirClienta,
  'pagar': pagar,
  'clientas': clientas,
  'clienta': fichaClienta,
  'clienta-editar': editarClienta,
  'productos': productos,
  'producto-editar': editarProducto,
  'importar': importarProductos,
  'mes': mes,
  'historial': historialMes,
  'respaldo': respaldo,
};

function render() {
  const [ruta, ...args] = location.hash.replace(/^#\/?/, '').split('/');
  const fn = rutas[ruta] || inicio;
  $atras.hidden = !ruta;
  window.scrollTo(0, 0);
  try { fn(...args.map(decodeURIComponent)); }
  catch (e) { console.error(e); $app.innerHTML = `<div class="banner alerta">Ocurrió un error: ${esc(e.message)}</div>`; }
}
$atras.onclick = () => history.length > 1 ? history.back() : ir('');
window.addEventListener('hashchange', render);

function pantalla(titulo, html) { $titulo.textContent = titulo; $app.innerHTML = html; }

/* ===== INICIO: resumen + quién me debe ===== */
function inicio() {
  const camp = campania();
  const deudoras = q(SQL_SALDOS).map(c => ({ ...c, saldo: redondear(c.pedido - c.pagado) }))
    .filter(c => c.saldo > 0.009).sort((a, b) => b.saldo - a.saldo);
  const totalDeuda = deudoras.reduce((s, c) => s + c.saldo, 0);
  const ventasMes = q1('SELECT IFNULL(SUM(total),0) AS t, COUNT(*) AS n FROM pedidos WHERE campania_id=?', [camp.id]);
  const nombre = cfg('vendedora');

  // Recordatorios
  let banners = '';
  const viejas = deudoras.filter(c => diasDesde(c.ultimo_pago || c.primer_pedido) >= 15);
  if (viejas.length) banners += `<div class="banner alerta">⏰ <b>${viejas.length}</b> ${viejas.length === 1 ? 'clienta lleva' : 'clientas llevan'} más de 15 días sin pagarle.</div>`;
  const ultRespaldo = cfg('ultimo_respaldo');
  const hayDatos = q1('SELECT COUNT(*) AS n FROM pedidos').n > 0;
  if (hayDatos && (!ultRespaldo || diasDesde(ultRespaldo) >= 7))
    banners += `<div class="banner info">💾 Hace tiempo que no guarda una copia de seguridad. <a href="#/respaldo">Hacerla ahora</a></div>`;

  pantalla(nombre ? `Hola, ${nombre}` : 'Mis Ventas', `
    ${banners}
    <p class="sub" style="margin:0 0 10px">📒 ${esc(camp.nombre)}</p>
    <div class="resumen">
      <div class="cifra deuda"><span>Me deben</span><b>${Q(totalDeuda)}</b></div>
      <div class="cifra venta"><span>Vendido este mes</span><b>${Q(ventasMes.t)}</b><span>${ventasMes.n} pedidos</span></div>
    </div>
    <div class="menu">
      <button class="principal" onclick="ir('pedido')"><span class="ico">🛍️</span>Nuevo pedido</button>
      <button class="verde" onclick="ir('pago')"><span class="ico">💵</span>Registrar pago</button>
      <button onclick="ir('clientas')"><span class="ico">👩</span>Clientas</button>
      <button onclick="ir('productos')"><span class="ico">📦</span>Productos</button>
      <button onclick="ir('mes')"><span class="ico">📅</span>Mes e historial</button>
      <button onclick="ir('respaldo')"><span class="ico">💾</span>Copia y ajustes</button>
    </div>
    <h2>¿Quién me debe?</h2>
    ${deudoras.length ? `<ul class="lista">${deudoras.map(c => {
      const dias = diasDesde(c.ultimo_pago || c.primer_pedido);
      return `<li class="item toca" onclick="ir('clienta/${c.id}')">
        <div class="info"><b>${esc(c.nombre)}</b>
          <small>${c.ultimo_pago ? 'Último pago: ' + fechaBonita(c.ultimo_pago) : 'Aún no ha pagado nada'}</small>
          ${dias >= 15 ? `<div><span class="etiqueta vieja">${dias} días</span></div>` : ''}
        </div>
        <span class="monto rojo">${Q(c.saldo)}</span></li>`;
    }).join('')}</ul>` : `<div class="vacio">🎉 Nadie le debe nada.</div>`}
  `);
}

/* ===== Elegir clienta (para pedido o pago) ===== */
function listaClientasHTML(destino, soloDeudoras = false) {
  let cs = q(SQL_SALDOS + ' ORDER BY c.nombre COLLATE NOCASE').map(c => ({ ...c, saldo: redondear(c.pedido - c.pagado) }));
  if (soloDeudoras) cs.sort((a, b) => (b.saldo > 0) - (a.saldo > 0));
  return `
    <div class="buscar"><input id="busca" type="search" placeholder="🔍 Buscar clienta…" autocomplete="off"></div>
    <ul class="lista" id="listaC">${cs.map(c => `
      <li class="item toca" data-n="${esc(sinTildes(c.nombre))}" onclick="ir('${destino}/${c.id}')">
        <div class="info"><b>${esc(c.nombre)}</b><small>${esc(c.telefono || 'Sin teléfono')}</small></div>
        ${c.saldo > 0.009 ? `<span class="monto rojo">${Q(c.saldo)}</span>` : ''}
      </li>`).join('')}</ul>
    ${cs.length ? '' : '<div class="vacio">Todavía no hay clientas. Agregue la primera.</div>'}`;
}
function activarBuscadorClientas() {
  const b = document.getElementById('busca');
  b.oninput = () => {
    const t = sinTildes(b.value);
    document.querySelectorAll('#listaC li').forEach(li => li.classList.toggle('oculto', !li.dataset.n.includes(t)));
  };
}

function pedidoElegirClienta() {
  pantalla('Nuevo pedido: ¿para quién?', `
    <button class="principal ancho" onclick="ir('clienta-editar/nueva/pedido')">➕ Clienta nueva</button>
    <h2>O elija una clienta</h2>
    ${listaClientasHTML('pedido-productos')}`);
  activarBuscadorClientas();
}

/* ===== Armar el pedido ===== */
function pedidoProductos(clienteId) {
  const c = q1('SELECT * FROM clientes WHERE id=?', [+clienteId]);
  if (!c) return ir('pedido');
  if (!borrador || borrador.clienteId !== c.id) borrador = { clienteId: c.id, items: [] };
  const camp = campania();
  const prods = q('SELECT * FROM productos WHERE campania_id=? ORDER BY codigo', [camp.id]);

  pantalla(`Pedido de ${c.nombre}`, `
    <div class="buscar"><input id="buscaP" type="search" inputmode="search" placeholder="🔍 Código o nombre del producto" autocomplete="off"></div>
    <div id="resultados"></div>
    <h2>Lo que lleva</h2>
    <ul class="lista" id="carrito"></ul>
    <div class="fila-botones">
      <button onclick="productoManual()">✏️ Producto que no está en la lista</button>
    </div>
    <label for="notaP">Nota (opcional)</label>
    <input id="notaP" placeholder="Ej.: se lo entrego el viernes">
    <div class="total-fijo">
      <div class="t"><small>Total</small><b id="totalP">Q0.00</b></div>
      <button class="principal" id="btnGuardarP">Guardar pedido</button>
    </div>`);

  const $b = document.getElementById('buscaP');
  const $r = document.getElementById('resultados');
  $b.oninput = () => {
    const t = sinTildes($b.value.trim());
    if (!t) { $r.innerHTML = prods.length ? '' : `<div class="vacio">No hay productos cargados para este mes. Puede agregarlos en <a href="#/productos">Productos</a> o usar "Producto que no está en la lista".</div>`; return; }
    const hallados = prods.filter(p => sinTildes(p.codigo).includes(t) || sinTildes(p.nombre).includes(t)).slice(0, 25);
    $r.innerHTML = hallados.length ? `<ul class="lista">${hallados.map(p => `
      <li class="item toca" onclick="agregarAlPedido(${p.id})">
        <div class="info"><b>${esc(p.nombre)}</b><small>Código ${esc(p.codigo)}</small></div>
        <span class="monto">${Q(p.precio)}</span><button class="chico principal">＋</button></li>`).join('')}</ul>`
      : `<div class="vacio">No encontré "${esc($b.value)}".</div>`;
  };
  $b.oninput();
  document.getElementById('btnGuardarP').onclick = guardarPedido;
  pintarCarrito();
}

function agregarAlPedido(prodId) {
  const p = q1('SELECT * FROM productos WHERE id=?', [prodId]);
  const ya = borrador.items.find(i => i.codigo === p.codigo && i.nombre === p.nombre && i.precio === p.precio);
  if (ya) ya.cantidad++; else borrador.items.push({ codigo: p.codigo, nombre: p.nombre, precio: p.precio, cantidad: 1 });
  const b = document.getElementById('buscaP'); b.value = ''; b.oninput();
  aviso('Agregado: ' + p.nombre);
  pintarCarrito();
}
function productoManual() {
  const nombre = prompt('Nombre del producto:'); if (!nombre) return;
  const codigo = prompt('Código (puede dejarlo vacío):') || '';
  const precio = numero(prompt('Precio en quetzales:'));
  if (isNaN(precio)) return aviso('El precio no es válido');
  borrador.items.push({ codigo, nombre, precio, cantidad: 1 });
  pintarCarrito();
}
function cambiarCantidad(i, d) {
  borrador.items[i].cantidad += d;
  if (borrador.items[i].cantidad <= 0) borrador.items.splice(i, 1);
  pintarCarrito();
}
function pintarCarrito() {
  const $c = document.getElementById('carrito');
  $c.innerHTML = borrador.items.length ? borrador.items.map((it, i) => `
    <li class="item">
      <div class="info"><b>${esc(it.nombre)}</b><small>${it.codigo ? 'Cód. ' + esc(it.codigo) + ' · ' : ''}${Q(it.precio)} c/u</small>
        <div class="monto">${Q(it.precio * it.cantidad)}</div></div>
      <div class="cantidad"><button onclick="cambiarCantidad(${i},-1)">−</button><span>${it.cantidad}</span><button onclick="cambiarCantidad(${i},1)">+</button></div>
    </li>`).join('') : '<div class="vacio">Busque arriba el producto por código o nombre y tóquelo para agregarlo.</div>';
  document.getElementById('totalP').textContent = Q(totalBorrador());
}
const totalBorrador = () => redondear(borrador.items.reduce((s, i) => s + i.precio * i.cantidad, 0));

async function guardarPedido() {
  if (!borrador.items.length) return aviso('Agregue al menos un producto');
  const camp = campania();
  const total = totalBorrador();
  run('INSERT INTO pedidos(cliente_id,campania_id,fecha,total,nota) VALUES(?,?,?,?,?)',
    [borrador.clienteId, camp.id, hoy(), total, document.getElementById('notaP').value.trim()]);
  const pid = ultimoId();
  borrador.items.forEach(i => run('INSERT INTO detalle_pedido(pedido_id,codigo,nombre,precio,cantidad) VALUES(?,?,?,?,?)',
    [pid, i.codigo, i.nombre, i.precio, i.cantidad]));
  await guardar();
  const cid = borrador.clienteId;
  borrador = null;
  aviso('✅ Pedido guardado');
  history.replaceState(null, '', '#/clienta/' + cid + '/nuevo-' + pid);
  render();
}

/* ===== Pagos ===== */
function pagoElegirClienta() {
  pantalla('Registrar pago: ¿quién pagó?', listaClientasHTML('pagar', true));
  activarBuscadorClientas();
}
function pagar(clienteId) {
  const c = q1('SELECT * FROM clientes WHERE id=?', [+clienteId]);
  if (!c) return ir('pago');
  const saldo = saldoDe(c.id);
  pantalla(`Pago de ${c.nombre}`, `
    <div class="saldo-grande ${saldo > 0 ? 'debe' : 'aldia'}"><span>Debe</span><b>${Q(saldo)}</b></div>
    <label for="monto">¿Cuánto le pagó?</label>
    <input id="monto" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00">
    ${saldo > 0 ? `<div class="fila-botones"><button onclick="document.getElementById('monto').value='${saldo.toFixed(2)}'">Pagó todo (${Q(saldo)})</button></div>` : ''}
    <label for="notaPago">Nota (opcional)</label>
    <input id="notaPago" placeholder="Ej.: depósito, efectivo…">
    <div class="fila-botones"><button class="verde" id="btnPagar">Guardar pago</button></div>`);
  document.getElementById('btnPagar').onclick = async () => {
    const m = numero(document.getElementById('monto').value);
    if (!(m > 0)) return aviso('Escriba cuánto pagó');
    if (m > saldo + 0.009 && !confirm(`Está registrando ${Q(m)} pero solo debe ${Q(saldo)}. ¿Guardar de todos modos? (le quedará saldo a favor)`)) return;
    run('INSERT INTO pagos(cliente_id,campania_id,fecha,monto,nota) VALUES(?,?,?,?,?)',
      [c.id, campania().id, hoy(), redondear(m), document.getElementById('notaPago').value.trim()]);
    await guardar();
    aviso('✅ Pago guardado');
    history.replaceState(null, '', '#/clienta/' + c.id + '/pago');
    render();
  };
}

/* ===== Clientas ===== */
function clientas() {
  pantalla('Clientas', `
    <button class="principal ancho" onclick="ir('clienta-editar/nueva')">➕ Clienta nueva</button>
    <h2>Todas</h2>
    ${listaClientasHTML('clienta')}`);
  activarBuscadorClientas();
}

function editarClienta(id, despues) {
  const c = id === 'nueva' ? { nombre: '', telefono: '', notas: '' } : q1('SELECT * FROM clientes WHERE id=?', [+id]);
  pantalla(id === 'nueva' ? 'Clienta nueva' : 'Editar clienta', `
    <label for="cN">Nombre</label><input id="cN" value="${esc(c.nombre)}" autocomplete="off">
    <label for="cT">WhatsApp (8 dígitos)</label><input id="cT" type="tel" inputmode="tel" value="${esc(c.telefono)}" placeholder="5555 5555">
    <label for="cO">Notas (dirección, dónde trabaja…)</label><textarea id="cO" rows="2">${esc(c.notas)}</textarea>
    <div class="fila-botones"><button class="principal" id="btnGC">Guardar</button></div>
    ${id !== 'nueva' ? `<div class="fila-botones"><button class="peligro" id="btnBC">Borrar clienta</button></div>` : ''}`);
  document.getElementById('cN').focus();
  document.getElementById('btnGC').onclick = async () => {
    const nombre = document.getElementById('cN').value.trim();
    if (!nombre) return aviso('Escriba el nombre');
    const datos = [nombre, document.getElementById('cT').value.trim(), document.getElementById('cO').value.trim()];
    let cid = +id;
    if (id === 'nueva') { run('INSERT INTO clientes(nombre,telefono,notas) VALUES(?,?,?)', datos); cid = ultimoId(); }
    else run('UPDATE clientes SET nombre=?,telefono=?,notas=? WHERE id=?', [...datos, cid]);
    await guardar();
    aviso('✅ Guardado');
    history.replaceState(null, '', despues === 'pedido' ? '#/pedido-productos/' + cid : '#/clienta/' + cid);
    render();
  };
  const bb = document.getElementById('btnBC');
  if (bb) bb.onclick = async () => {
    const tiene = q1('SELECT (SELECT COUNT(*) FROM pedidos WHERE cliente_id=?)+(SELECT COUNT(*) FROM pagos WHERE cliente_id=?) AS n', [+id, +id]).n;
    if (tiene) return alert('No se puede borrar porque tiene pedidos o pagos guardados. Bórrelos primero desde su ficha.');
    if (!confirm('¿Borrar a ' + c.nombre + '?')) return;
    run('DELETE FROM clientes WHERE id=?', [+id]); await guardar();
    aviso('Clienta borrada'); history.replaceState(null, '', '#/clientas'); render();
  };
}

function fichaClienta(id, recien) {
  const c = q1('SELECT * FROM clientes WHERE id=?', [+id]);
  if (!c) return ir('clientas');
  const saldo = saldoDe(c.id);
  const pedidos = q(`SELECT p.*, ca.nombre AS camp FROM pedidos p JOIN campanias ca ON ca.id=p.campania_id
                     WHERE cliente_id=? ORDER BY fecha DESC, p.id DESC`, [c.id]);
  const pagos = q('SELECT * FROM pagos WHERE cliente_id=? ORDER BY fecha DESC, id DESC', [c.id]);
  const detalle = pid => q('SELECT * FROM detalle_pedido WHERE pedido_id=?', [pid]);

  let enviar = '';
  if (recien && recien.startsWith('nuevo-')) enviar = `<div class="banner info">✅ Pedido guardado. ¿Le manda el comprobante?
     <div class="fila-botones"><button class="verde" onclick="enviarPedido(${+recien.slice(6)})">📲 Enviar por WhatsApp</button></div></div>`;
  if (recien === 'pago') enviar = `<div class="banner info">✅ Pago guardado. ¿Le manda la constancia?
     <div class="fila-botones"><button class="verde" onclick="enviarEstado(${c.id}, true)">📲 Enviar por WhatsApp</button></div></div>`;

  pantalla(c.nombre, `
    ${enviar}
    <div class="saldo-grande ${saldo > 0.009 ? 'debe' : 'aldia'}"><span>${saldo > 0.009 ? 'Le debe' : saldo < -0.009 ? 'Tiene saldo a favor' : 'Está al día'}</span><b>${Q(Math.abs(saldo))}</b></div>
    <p class="sub">${c.telefono ? '📞 ' + esc(c.telefono) : 'Sin teléfono'}${c.notas ? ' · ' + esc(c.notas) : ''}</p>
    <div class="fila-botones">
      <button class="principal" onclick="ir('pedido-productos/${c.id}')">🛍️ Nuevo pedido</button>
      <button class="verde" onclick="ir('pagar/${c.id}')">💵 Registrar pago</button>
    </div>
    <div class="fila-botones">
      <button onclick="enviarEstado(${c.id})">${saldo > 0.009 ? '⏰ Recordarle que pague' : '📲 Enviar estado de cuenta'}</button>
      <button onclick="ir('clienta-editar/${c.id}')">✏️ Editar datos</button>
    </div>

    <h2>Pedidos</h2>
    ${pedidos.length ? `<ul class="lista">${pedidos.map(p => `
      <li class="item" style="display:block">
        <div style="display:flex;gap:10px;align-items:center">
          <div class="info"><b>${fechaBonita(p.fecha)}</b><small>${esc(p.camp)}${p.nota ? ' · ' + esc(p.nota) : ''}</small></div>
          <span class="monto">${Q(p.total)}</span>
        </div>
        <div class="detalle-pedido">${detalle(p.id).map(d => `
          <div class="linea ${d.no_vino ? 'novino' : ''}">
            <span class="txt">${d.cantidad} × ${esc(d.nombre)}${d.codigo ? ' (' + esc(d.codigo) + ')' : ''}
              ${d.no_vino ? '<span class="etiqueta vieja">No vino</span>' : ''}</span>
            <span class="precio">${Q(d.precio * d.cantidad)}</span>
            <button class="chico mini" onclick="marcarNoVino(${d.id},${c.id})">${d.no_vino ? '↩️ Sí vino' : '🚫 No vino'}</button>
          </div>`).join('')}</div>
        <div class="fila-botones"><button class="chico" onclick="enviarPedido(${p.id})">📲 Enviar</button><button class="chico peligro" onclick="borrarPedido(${p.id},${c.id})">🗑️ Borrar</button></div>
      </li>`).join('')}</ul>` : '<div class="vacio">Sin pedidos todavía.</div>'}

    <h2>Pagos</h2>
    ${pagos.length ? `<ul class="lista">${pagos.map(p => `
      <li class="item"><div class="info"><b>${fechaBonita(p.fecha)}</b><small>${esc(p.nota || 'Pago')}</small></div>
        <span class="monto verde">${Q(p.monto)}</span>
        <button class="chico peligro" onclick="borrarPago(${p.id},${c.id})">🗑️</button></li>`).join('')}</ul>`
      : '<div class="vacio">Sin pagos todavía.</div>'}
  `);
}

// Marca un producto como "no vino": no se cobra, pero queda en el historial
async function marcarNoVino(did, cid) {
  const d = q1('SELECT * FROM detalle_pedido WHERE id=?', [did]);
  if (d.no_vino) {
    run('UPDATE detalle_pedido SET no_vino=0 WHERE id=?', [did]);
  } else {
    let faltan = d.cantidad;
    if (d.cantidad > 1) {
      const r = prompt(`Pidió ${d.cantidad}. ¿Cuántos NO vinieron?`, d.cantidad);
      if (r === null) return;
      faltan = parseInt(r, 10);
      if (!(faltan >= 1 && faltan <= d.cantidad)) return aviso('Cantidad no válida');
    }
    if (faltan === d.cantidad) run('UPDATE detalle_pedido SET no_vino=1 WHERE id=?', [did]);
    else {   // separa la línea: los que sí vinieron y los que no
      run('UPDATE detalle_pedido SET cantidad=? WHERE id=?', [d.cantidad - faltan, did]);
      run('INSERT INTO detalle_pedido(pedido_id,codigo,nombre,precio,cantidad,no_vino) VALUES(?,?,?,?,?,1)',
        [d.pedido_id, d.codigo, d.nombre, d.precio, faltan]);
    }
  }
  run(`UPDATE pedidos SET total=(SELECT IFNULL(SUM(precio*cantidad),0) FROM detalle_pedido
       WHERE pedido_id=? AND no_vino=0) WHERE id=?`, [d.pedido_id, d.pedido_id]);
  await guardar();
  aviso(d.no_vino ? '↩️ Se volvió a cobrar' : '🚫 Marcado como "no vino". Ya no se cobra.');
  fichaClienta(cid);
}

async function borrarPedido(pid, cid) {
  if (!confirm('¿Borrar este pedido? No se puede deshacer.')) return;
  run('DELETE FROM detalle_pedido WHERE pedido_id=?', [pid]);
  run('DELETE FROM pedidos WHERE id=?', [pid]);
  await guardar(); aviso('Pedido borrado'); fichaClienta(cid);
}
async function borrarPago(id, cid) {
  if (!confirm('¿Borrar este pago? No se puede deshacer.')) return;
  run('DELETE FROM pagos WHERE id=?', [id]);
  await guardar(); aviso('Pago borrado'); fichaClienta(cid);
}

/* ===== Mensajes de WhatsApp (comprobantes) ===== */
function firma() { const n = cfg('vendedora'); return n ? `\n\nGracias por su compra 🌸\n${n}` : '\n\nGracias por su compra 🌸'; }

function enviarPedido(pid) {
  const p = q1('SELECT p.*, c.nombre, c.telefono, c.id AS cid FROM pedidos p JOIN clientes c ON c.id=p.cliente_id WHERE p.id=?', [pid]);
  const items = q('SELECT * FROM detalle_pedido WHERE pedido_id=?', [pid]);
  const saldo = saldoDe(p.cid);
  let t = `Hola ${p.nombre} 👋\nLe comparto el detalle de su pedido del ${fechaBonita(p.fecha)}:\n\n`;
  const linea = i => `• ${i.cantidad} x ${i.nombre}${i.codigo ? ' (cód. ' + i.codigo + ')' : ''} — ${Q(i.precio * i.cantidad)}`;
  const vino = items.filter(i => !i.no_vino), noVino = items.filter(i => i.no_vino);
  t += vino.length ? vino.map(linea).join('\n') : '(ningún producto)';
  if (noVino.length) t += `\n\n🚫 *No vino* (no se le cobra):\n` + noVino.map(i => `• ${i.cantidad} x ${i.nombre}${i.codigo ? ' (cód. ' + i.codigo + ')' : ''}`).join('\n');
  t += `\n\n*Total del pedido: ${Q(p.total)}*`;
  if (Math.abs(saldo - p.total) > 0.009) t += `\n*Saldo pendiente total: ${Q(saldo)}*`;
  abrirWhatsApp(p.telefono, t + firma());
}

function enviarEstado(cid, trasPago = false) {
  const c = q1(SQL_SALDOS + ' WHERE c.id=?', [cid]);
  const saldo = redondear(c.pedido - c.pagado);
  let t = `Hola ${c.nombre} 👋\n`;
  if (trasPago) {
    const ult = q1('SELECT * FROM pagos WHERE cliente_id=? ORDER BY id DESC LIMIT 1', [cid]);
    t += `Le confirmo que recibí su pago de *${Q(ult.monto)}* el ${fechaBonita(ult.fecha)}. ¡Muchas gracias!\n`;
    t += saldo > 0.009 ? `\nSu saldo pendiente es de *${Q(saldo)}*.` : `\nYa está al día, no tiene saldo pendiente. 🎉`;
  } else if (saldo > 0.009) {
    // pedidos que aún no se cubren con los pagos (los más antiguos se pagan primero)
    let pagado = c.pagado;
    const pend = q('SELECT * FROM pedidos WHERE cliente_id=? ORDER BY fecha, id', [cid]).filter(p => {
      if (pagado >= p.total - 0.009) { pagado -= p.total; return false; }
      p.falta = redondear(p.total - pagado); pagado = 0; return true;
    });
    t += `Le escribo para recordarle con cariño su saldo pendiente:\n\n`;
    t += pend.map(p => `• Pedido del ${fechaBonita(p.fecha)}: ${Q(p.total)}${p.falta < p.total ? ' (falta ' + Q(p.falta) + ')' : ''}`).join('\n');
    if (c.pagado > 0) t += `\n\nAbonado hasta hoy: ${Q(c.pagado)}`;
    t += `\n\n*Total pendiente: ${Q(saldo)}*\n\nQuedo pendiente de su pago. ¡Gracias!`;
  } else {
    t += `Le confirmo que está al día con sus pagos. ¡Muchas gracias! 🎉`;
  }
  abrirWhatsApp(c.telefono, t + (cfg('vendedora') ? '\n\n' + cfg('vendedora') : ''));
}

/* ===== Productos del mes ===== */
function productos() {
  const camp = campania();
  const prods = q('SELECT * FROM productos WHERE campania_id=? ORDER BY codigo', [camp.id]);
  const anterior = q1(`SELECT c.id, c.nombre, COUNT(p.id) AS n FROM campanias c JOIN productos p ON p.campania_id=c.id
                       WHERE c.activa=0 GROUP BY c.id ORDER BY c.id DESC LIMIT 1`);
  pantalla('Productos', `
    <p class="sub" style="margin-top:0">Catálogo de <b>${esc(camp.nombre)}</b> · ${prods.length} productos</p>
    <div class="fila-botones">
      <button class="principal" onclick="ir('producto-editar/nuevo')">➕ Agregar</button>
      <button onclick="ir('importar')">📄 Cargar lista (Excel/CSV)</button>
    </div>
    ${!prods.length && anterior ? `<div class="fila-botones"><button onclick="copiarProductos(${anterior.id})">📋 Copiar los ${anterior.n} productos de ${esc(anterior.nombre)}</button></div>` : ''}
    <div class="buscar" style="margin-top:12px"><input id="busca" type="search" placeholder="🔍 Buscar producto…" autocomplete="off"></div>
    ${prods.length ? `<ul class="lista" id="listaC">${prods.map(p => `
      <li class="item toca" data-n="${esc(sinTildes(p.codigo + ' ' + p.nombre))}" onclick="ir('producto-editar/${p.id}')">
        <div class="info"><b>${esc(p.nombre)}</b><small>Código ${esc(p.codigo)}</small></div>
        <span class="monto">${Q(p.precio)}</span></li>`).join('')}</ul>`
      : '<div class="vacio">Aún no hay productos para este mes.</div>'}
  `);
  if (prods.length) activarBuscadorClientas();
}

async function copiarProductos(desde) {
  run(`INSERT INTO productos(campania_id,codigo,nombre,precio) SELECT ?,codigo,nombre,precio FROM productos WHERE campania_id=?`, [campania().id, desde]);
  await guardar(); aviso('✅ Productos copiados. Revise si cambió algún precio.'); productos();
}

function editarProducto(id) {
  const p = id === 'nuevo' ? { codigo: '', nombre: '', precio: '' } : q1('SELECT * FROM productos WHERE id=?', [+id]);
  pantalla(id === 'nuevo' ? 'Producto nuevo' : 'Editar producto', `
    <label for="pC">Código</label><input id="pC" value="${esc(p.codigo)}" autocomplete="off">
    <label for="pN">Nombre</label><input id="pN" value="${esc(p.nombre)}" autocomplete="off">
    <label for="pP">Precio (Q)</label><input id="pP" type="number" inputmode="decimal" step="0.01" value="${esc(p.precio)}">
    <div class="fila-botones"><button class="principal" id="btnGP">Guardar</button></div>
    ${id !== 'nuevo' ? '<div class="fila-botones"><button class="peligro" id="btnBP">Borrar producto</button></div>' : ''}`);
  document.getElementById('btnGP').onclick = async () => {
    const codigo = document.getElementById('pC').value.trim(), nombre = document.getElementById('pN').value.trim();
    const precio = numero(document.getElementById('pP').value);
    if (!nombre || isNaN(precio)) return aviso('Falta el nombre o el precio');
    if (id === 'nuevo') run('INSERT INTO productos(campania_id,codigo,nombre,precio) VALUES(?,?,?,?)', [campania().id, codigo, nombre, precio]);
    else run('UPDATE productos SET codigo=?,nombre=?,precio=? WHERE id=?', [codigo, nombre, precio, +id]);
    await guardar(); aviso('✅ Guardado');
    if (id === 'nuevo') { editarProducto('nuevo'); document.getElementById('pC').focus(); } else history.back();
  };
  const bb = document.getElementById('btnBP');
  if (bb) bb.onclick = async () => {
    if (!confirm('¿Borrar ' + p.nombre + '? (Los pedidos ya hechos no cambian)')) return;
    run('DELETE FROM productos WHERE id=?', [+id]); await guardar(); history.back();
  };
}

/* ===== Cargar lista de productos desde Excel/CSV ===== */
function importarProductos() {
  pantalla('Cargar lista de productos', `
    <div class="banner info">El archivo debe tener 3 columnas: <b>código, nombre, precio</b>.<br>
      En Excel: <i>Archivo → Guardar como → CSV</i>. También puede pegar la lista abajo.</div>
    <label for="arch">Elegir archivo CSV</label>
    <input id="arch" type="file" accept=".csv,.txt,text/csv,text/plain">
    <label for="texto">O pegue la lista aquí</label>
    <textarea id="texto" rows="6" placeholder="1234, Loción Floral 50ml, 85&#10;2345, Crema de manos, 39.90"></textarea>
    <label><input type="checkbox" id="reemplazar" style="width:auto"> Borrar la lista actual de este mes antes de cargar</label>
    <div class="fila-botones"><button class="principal" id="btnRev">Revisar</button></div>
    <div id="vista"></div>`);
  document.getElementById('arch').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    document.getElementById('texto').value = await f.text();
  };
  document.getElementById('btnRev').onclick = () => {
    const filas = leerCSV(document.getElementById('texto').value);
    const $v = document.getElementById('vista');
    if (!filas.length) { $v.innerHTML = '<div class="vacio">No encontré productos. Revise que tenga código, nombre y precio.</div>'; return; }
    $v.innerHTML = `<h2>${filas.length} productos encontrados</h2>
      <ul class="lista">${filas.slice(0, 50).map(f => `<li class="item"><div class="info"><b>${esc(f.nombre)}</b><small>Código ${esc(f.codigo)}</small></div><span class="monto">${Q(f.precio)}</span></li>`).join('')}</ul>
      ${filas.length > 50 ? `<p class="sub">…y ${filas.length - 50} más</p>` : ''}
      <div class="fila-botones"><button class="principal" id="btnImp">Guardar ${filas.length} productos</button></div>`;
    document.getElementById('btnImp').onclick = async () => {
      const cid = campania().id;
      if (document.getElementById('reemplazar').checked) run('DELETE FROM productos WHERE campania_id=?', [cid]);
      db.run('BEGIN');
      filas.forEach(f => {
        const ya = q1('SELECT id FROM productos WHERE campania_id=? AND codigo=?', [cid, f.codigo]);
        if (ya && f.codigo) run('UPDATE productos SET nombre=?,precio=? WHERE id=?', [f.nombre, f.precio, ya.id]);
        else run('INSERT INTO productos(campania_id,codigo,nombre,precio) VALUES(?,?,?,?)', [cid, f.codigo, f.nombre, f.precio]);
      });
      db.run('COMMIT');
      await guardar(); aviso(`✅ ${filas.length} productos cargados`);
      history.replaceState(null, '', '#/productos'); render();
    };
  };
}

function leerCSV(texto) {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lineas.length) return [];
  const sep = [';', '\t', ','].find(s => lineas[0].includes(s)) || ',';
  const partir = l => {
    const out = []; let cur = '', comillas = false;
    for (const ch of l) {
      if (ch === '"') comillas = !comillas;
      else if (ch === sep && !comillas) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur); return out.map(s => s.trim());
  };
  const res = [];
  for (const l of lineas) {
    const c = partir(l);
    if (c.length < 2) continue;
    let codigo, nombre, precio;
    if (c.length === 2) { codigo = ''; nombre = c[0]; precio = numero(c[1]); }
    else {
      // si el precio trae coma decimal y el separador es ";" (Excel en español)
      codigo = c[0]; nombre = c[1]; precio = numero(String(c[2]).replace(/^(\d+),(\d{1,2})$/, '$1.$2'));
    }
    if (isNaN(precio) || !nombre) continue;   // salta encabezados
    res.push({ codigo, nombre, precio: redondear(precio) });
  }
  return res;
}

/* ===== Mes: cerrar campaña e historial ===== */
function resumenCampania(id) {
  return q1(`SELECT
    (SELECT IFNULL(SUM(total),0) FROM pedidos WHERE campania_id=$id) AS vendido,
    (SELECT COUNT(*) FROM pedidos WHERE campania_id=$id) AS pedidos,
    (SELECT COUNT(DISTINCT cliente_id) FROM pedidos WHERE campania_id=$id) AS clientas,
    (SELECT IFNULL(SUM(monto),0) FROM pagos WHERE campania_id=$id) AS cobrado`, { $id: id });
}

function mes() {
  const camp = campania();
  const r = resumenCampania(camp.id);
  const cerradas = q('SELECT * FROM campanias WHERE activa=0 ORDER BY id DESC');
  const sig = new Date(); sig.setMonth(sig.getMonth() + 1);
  pantalla('Mes e historial', `
    <h2 style="margin-top:0">📒 ${esc(camp.nombre)} <span class="etiqueta">Abierto</span></h2>
    <p class="sub">Desde el ${fechaBonita(camp.fecha_inicio)}</p>
    <div class="resumen">
      <div class="cifra venta"><span>Vendido</span><b>${Q(r.vendido)}</b><span>${r.pedidos} pedidos · ${r.clientas} clientas</span></div>
      <div class="cifra"><span>Cobrado este mes</span><b>${Q(r.cobrado)}</b></div>
    </div>
    <div class="fila-botones"><button onclick="ir('historial/${camp.id}')">📋 Ver pedidos de este mes</button></div>

    <h2>Cerrar el mes</h2>
    <p class="sub">Cuando llegue el catálogo nuevo, cierre el mes. Lo de este mes se guarda en el historial y <b>las deudas pendientes se mantienen</b>.</p>
    <label for="nuevoNom">Nombre del mes nuevo</label>
    <input id="nuevoNom" value="${esc(nombreMes(sig))}">
    <label><input type="checkbox" id="copiar" checked style="width:auto"> Copiar los productos al mes nuevo (luego solo cambia los precios)</label>
    <div class="fila-botones"><button class="principal" id="btnCerrar">Cerrar ${esc(camp.nombre)} y empezar el nuevo</button></div>

    <h2>Historial</h2>
    ${cerradas.length ? `<ul class="lista">${cerradas.map(c => { const rc = resumenCampania(c.id); return `
      <li class="item toca" onclick="ir('historial/${c.id}')">
        <div class="info"><b>${esc(c.nombre)}</b><small>${fechaBonita(c.fecha_inicio)} – ${fechaBonita(c.fecha_cierre)} · ${rc.pedidos} pedidos</small></div>
        <span class="monto verde">${Q(rc.vendido)}</span></li>`; }).join('')}</ul>`
      : '<div class="vacio">Todavía no hay meses cerrados.</div>'}
  `);
  document.getElementById('btnCerrar').onclick = async () => {
    const nombre = document.getElementById('nuevoNom').value.trim();
    if (!nombre) return aviso('Escriba el nombre del mes nuevo');
    if (!confirm(`¿Cerrar "${camp.nombre}" y empezar "${nombre}"?`)) return;
    db.run('BEGIN');
    run('UPDATE campanias SET activa=0, fecha_cierre=? WHERE id=?', [hoy(), camp.id]);
    run('INSERT INTO campanias(nombre,fecha_inicio,activa) VALUES(?,?,1)', [nombre, hoy()]);
    const nueva = ultimoId();
    if (document.getElementById('copiar').checked)
      run('INSERT INTO productos(campania_id,codigo,nombre,precio) SELECT ?,codigo,nombre,precio FROM productos WHERE campania_id=?', [nueva, camp.id]);
    db.run('COMMIT');
    await guardar();
    aviso('✅ Mes nuevo iniciado'); mes();
  };
}

function historialMes(id) {
  const c = q1('SELECT * FROM campanias WHERE id=?', [+id]);
  if (!c) return ir('mes');
  const r = resumenCampania(c.id);
  const porClienta = q(`SELECT cl.id, cl.nombre, COUNT(p.id) AS n, SUM(p.total) AS total
                        FROM pedidos p JOIN clientes cl ON cl.id=p.cliente_id
                        WHERE p.campania_id=? GROUP BY cl.id ORDER BY total DESC`, [c.id]);
  const top = q(`SELECT d.codigo, d.nombre, SUM(d.cantidad) AS cant FROM detalle_pedido d JOIN pedidos p ON p.id=d.pedido_id
                 WHERE p.campania_id=? AND d.no_vino=0 GROUP BY d.codigo, d.nombre ORDER BY cant DESC LIMIT 5`, [c.id]);
  const noVino = q(`SELECT d.codigo, d.nombre, d.cantidad, cl.nombre AS clienta, cl.id AS cid, p.fecha
                    FROM detalle_pedido d JOIN pedidos p ON p.id=d.pedido_id JOIN clientes cl ON cl.id=p.cliente_id
                    WHERE p.campania_id=? AND d.no_vino=1 ORDER BY p.fecha, cl.nombre`, [c.id]);
  pantalla(c.nombre, `
    <p class="sub" style="margin-top:0">${fechaBonita(c.fecha_inicio)}${c.fecha_cierre ? ' – ' + fechaBonita(c.fecha_cierre) : ' (abierto)'}</p>
    <div class="resumen">
      <div class="cifra venta"><span>Vendido</span><b>${Q(r.vendido)}</b><span>${r.pedidos} pedidos</span></div>
      <div class="cifra"><span>Cobrado en el mes</span><b>${Q(r.cobrado)}</b></div>
    </div>
    <div class="fila-botones"><button onclick="exportarPedidosCSV(${c.id})">📥 Descargar en Excel (CSV)</button></div>
    <h2>Por clienta</h2>
    ${porClienta.length ? `<ul class="lista">${porClienta.map(x => `
      <li class="item toca" onclick="ir('clienta/${x.id}')"><div class="info"><b>${esc(x.nombre)}</b><small>${x.n} pedido${x.n > 1 ? 's' : ''}</small></div>
        <span class="monto">${Q(x.total)}</span></li>`).join('')}</ul>` : '<div class="vacio">Sin pedidos en este mes.</div>'}
    ${top.length ? `<h2>Lo más vendido</h2><ul class="lista">${top.map(t => `
      <li class="item"><div class="info"><b>${esc(t.nombre)}</b><small>${t.codigo ? 'Código ' + esc(t.codigo) : ''}</small></div><span class="monto">${t.cant} u.</span></li>`).join('')}</ul>` : ''}
    ${noVino.length ? `<h2>🚫 No vinieron (${noVino.reduce((s, x) => s + x.cantidad, 0)})</h2><ul class="lista">${noVino.map(x => `
      <li class="item toca" onclick="ir('clienta/${x.cid}')"><div class="info"><b>${x.cantidad} × ${esc(x.nombre)}</b>
        <small>${esc(x.clienta)} · ${fechaBonita(x.fecha)}${x.codigo ? ' · Cód. ' + esc(x.codigo) : ''}</small></div></li>`).join('')}</ul>` : ''}
  `);
}

function descargar(nombre, contenido, tipo) {
  const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function exportarPedidosCSV(cid) {
  const filas = q(`SELECT p.fecha, cl.nombre AS clienta, d.codigo, d.nombre AS producto, d.cantidad, d.precio,
                   CASE WHEN d.no_vino=1 THEN 0 ELSE d.cantidad*d.precio END AS subtotal,
                   CASE WHEN d.no_vino=1 THEN 'No vino' ELSE 'Entregado' END AS estado
                   FROM detalle_pedido d JOIN pedidos p ON p.id=d.pedido_id JOIN clientes cl ON cl.id=p.cliente_id
                   WHERE p.campania_id=? ORDER BY p.fecha, cl.nombre`, [cid]);
  const celda = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + ['Fecha;Clienta;Código;Producto;Cantidad;Precio;Subtotal;Estado',
    ...filas.map(f => [f.fecha, f.clienta, f.codigo, f.producto, f.cantidad, f.precio.toFixed(2), f.subtotal.toFixed(2), f.estado].map(celda).join(';'))].join('\r\n');
  const nom = q1('SELECT nombre FROM campanias WHERE id=?', [cid]).nombre;
  descargar(`pedidos-${sinTildes(nom).replace(/\s+/g, '-')}.csv`, csv, 'text/csv');
}

/* ===== Copia de seguridad y ajustes ===== */
function respaldo() {
  const ult = cfg('ultimo_respaldo');
  pantalla('Copia y ajustes', `
    <h2 style="margin-top:0">Su nombre</h2>
    <p class="sub">Aparece al final de los mensajes de WhatsApp.</p>
    <input id="vend" value="${esc(cfg('vendedora') || '')}" placeholder="Ej.: Doña Marta">
    <div class="fila-botones"><button class="principal" id="btnVend">Guardar nombre</button></div>

    <h2>Copia de seguridad</h2>
    <p class="sub">Guarde una copia cada semana (por ejemplo en WhatsApp o Google Drive). Si cambia de teléfono o se borra algo, con ese archivo se recupera todo.
      ${ult ? `<br>Última copia: <b>${fechaBonita(ult)}</b>` : '<br><b>Aún no ha hecho ninguna copia.</b>'}</p>
    <div class="fila-botones"><button class="verde" id="btnCopia">💾 Guardar copia en el teléfono</button></div>
    ${navigator.canShare ? '<div class="fila-botones"><button id="btnCompartir">📤 Enviar copia (WhatsApp, Drive…)</button></div>' : ''}

    <h2>Recuperar una copia</h2>
    <p class="sub">⚠️ Esto reemplaza todo lo que hay ahora en la app por lo que tenga la copia.</p>
    <input id="archDb" type="file" accept=".db,.sqlite,application/octet-stream">
  `);
  document.getElementById('btnVend').onclick = async () => { cfg('vendedora', document.getElementById('vend').value.trim()); await guardar(); aviso('✅ Guardado'); };
  const nombreArchivo = () => `mis-ventas-copia-${hoy()}.db`;
  const marcar = async () => { cfg('ultimo_respaldo', hoy()); await guardar(); };
  document.getElementById('btnCopia').onclick = async () => {
    await marcar();
    descargar(nombreArchivo(), new Blob([db.export()], { type: 'application/octet-stream' }));
    aviso('✅ Copia guardada en Descargas');
  };
  const bc = document.getElementById('btnCompartir');
  if (bc) bc.onclick = async () => {
    await marcar();
    const f = new File([db.export()], nombreArchivo(), { type: 'application/octet-stream' });
    try {
      if (navigator.canShare({ files: [f] })) await navigator.share({ files: [f], title: 'Copia Mis Ventas' });
      else descargar(f.name, f);
    } catch (e) { /* canceló */ }
  };
  document.getElementById('archDb').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    if (!confirm('¿Reemplazar todos los datos actuales con esta copia?')) return;
    try {
      const nueva = new SQL.Database(new Uint8Array(await f.arrayBuffer()));
      nueva.exec('SELECT COUNT(*) FROM pedidos; SELECT COUNT(*) FROM clientes;'); // verifica que sea una copia válida
      db.close(); db = nueva; prepararBase(); await guardar();
      aviso('✅ Copia recuperada'); ir('');
    } catch (err) { alert('Ese archivo no es una copia válida de Mis Ventas.'); }
  };
}

/* ---------- Arranque ---------- */
let SQL;
(async function arrancar() {
  try {
    SQL = await initSqlJs({ locateFile: f => f });
    const guardado = await leerIDB();
    db = guardado ? new SQL.Database(new Uint8Array(guardado)) : new SQL.Database();
    prepararBase();
    await guardar();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    render();
  } catch (e) {
    $app.innerHTML = `<div class="banner alerta">No se pudo abrir la app: ${esc(e.message)}</div>`;
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
})();
