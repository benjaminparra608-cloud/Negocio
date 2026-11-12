// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-purple; icon-glyph: bolt;

/**
 * ⚡ NEGOCIO • WIDGET NATIVO PARA IPHONE (SCRIPTABLE)
 * - Muestra en el escritorio de tu iPhone el diseño oscuro con las 3 tarjetas
 *   (💎 Cupo Créd., 💵 Efectivo, 💳 T. Débito) y un MINI-GRÁFICO debajo de cada saldo.
 * - Al tocar el widget en tu pantalla de inicio, abre un menú nativo de iOS
 *   (SIN abrir Safari ni la web) con los montos rápidos ($5.000, $15.000, $30.000, $50.000)
 *   para Restar (-) o Agregar (+) directamente en tu Supabase.
 *
 * CÓMO USARLO EN IPHONE:
 * 1. Descarga la app gratuita "Scriptable" en la App Store.
 * 2. Toca "+" arriba a la derecha, pega este código y nómbralo: Negocio
 * 3. En la pantalla de inicio de tu iPhone, mantén presionado el fondo -> "+" -> Scriptable (Tamaño Mediano).
 * 4. Mantén presionado el widget -> "Editar Widget" -> Script: Negocio -> When Interacting: "Run Script".
 */

const SUPABASE_URL = "https://bcnkbsiqrcoosasjlypc.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjbmtic2lxcmNvb3Nhc2pseXBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1ODA3NTYsImV4cCI6MjEwMzE1Njc1Nn0._MLWTyHL7fBIhYhIwvrguIcDqwz7D9uFoRSCbqPo6pU";
const META_SYNC_ID = "__almacen_sync_meta_v2__";

const fmt = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CL");

function getWallet(item) {
  if (item?.wallet === "Efectivo" || item?.wallet === "Tarjeta" || item?.wallet === "Crédito") return item.wallet;
  const d = String(item?.description || "");
  if (d.startsWith("[Efectivo]")) return "Efectivo";
  if (d.startsWith("[Crédito]") || d.startsWith("[Credito]")) return "Crédito";
  return "Tarjeta";
}

function calcDaysUntil(dayOfMonth) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const maxThis = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  let nextDate = new Date(now.getFullYear(), now.getMonth(), Math.min(dayOfMonth, maxThis));
  if (nextDate < today) {
    const maxNext = new Date(now.getFullYear(), now.getMonth() + 2, 0).getDate();
    nextDate = new Date(now.getFullYear(), now.getMonth() + 1, Math.min(dayOfMonth, maxNext));
  }
  return Math.max(0, Math.round((nextDate - today) / 86400000));
}

async function loadCloudData() {
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
  let snapshot = null;
  let personalFinances = [];
  let creditCardConfig = { totalLimit: 1000000, baseUsed: 0, paymentDay: 5, billingDay: 25 };

  try {
    const req = new Request(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${encodeURIComponent(META_SYNC_ID)}&select=*`);
    req.headers = headers;
    const rows = await req.loadJSON();
    if (Array.isArray(rows) && rows[0]?.phone) {
      snapshot = JSON.parse(rows[0].phone);
      if (Array.isArray(snapshot.personalFinances)) personalFinances = snapshot.personalFinances;
      if (snapshot.creditCardConfig) creditCardConfig = { ...creditCardConfig, ...snapshot.creditCardConfig };
    }
  } catch (e) {}

  if (personalFinances.length === 0) {
    try {
      const reqPf = new Request(`${SUPABASE_URL}/rest/v1/finanzas_personales?select=*`);
      reqPf.headers = headers;
      const rowsPf = await reqPf.loadJSON();
      if (Array.isArray(rowsPf)) {
        personalFinances = rowsPf.filter(r => r.id !== META_SYNC_ID);
      }
    } catch (e) {}
  }

  return { snapshot, personalFinances, creditCardConfig };
}

async function saveMovementToSupabase(data, wallet, type, amount, concept) {
  const today = new Date().toISOString().slice(0, 10);
  const category = wallet === "Crédito"
    ? (type === "ingreso" ? "Pago / Abono Tarjeta de Crédito" : "Compras con Tarjeta de Crédito")
    : (type === "ingreso" ? "Retiro de Ganancias" : "Compras Personales");

  const entry = {
    id: "pf-" + Date.now(),
    date: today,
    type,
    wallet,
    category,
    description: concept || category,
    amount: Number(amount)
  };

  const nextPF = [entry, ...data.personalFinances];
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates"
  };

  const reqPf = new Request(`${SUPABASE_URL}/rest/v1/finanzas_personales`);
  reqPf.method = "POST";
  reqPf.headers = headers;
  reqPf.body = JSON.stringify({
    id: entry.id,
    date: entry.date,
    type: entry.type,
    category: entry.category,
    description: `[${entry.wallet}] ${entry.description}`,
    amount: entry.amount
  });
  await reqPf.loadString();

  const updatedSnapshot = {
    ...(data.snapshot || {}),
    personalFinances: nextPF,
    creditCardConfig: data.creditCardConfig,
    updatedAt: Date.now()
  };
  const serialized = JSON.stringify(updatedSnapshot);

  const reqMeta = new Request(`${SUPABASE_URL}/rest/v1/clientes`);
  reqMeta.method = "POST";
  reqMeta.headers = headers;
  reqMeta.body = JSON.stringify({ id: META_SYNC_ID, name: "__sync_v2__", phone: serialized });
  await reqMeta.loadString();
}

// Dibuja el mini-gráfico de línea + barra de progreso debajo del saldo restante
function drawMiniChartImage(points, pctFree, hexColor) {
  const w = 160;
  const h = 44;
  const ctx = new DrawContext();
  ctx.size = new Size(w, h);
  ctx.opaque = false;

  const vals = points.length >= 2 ? points : [1, 1];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;

  const path = new Path();
  vals.forEach((v, idx) => {
    const x = 4 + (idx / (vals.length - 1)) * (w - 8);
    const y = 26 - ((v - min) / range) * 20;
    if (idx === 0) path.move(new Point(x, y));
    else path.addLine(new Point(x, y));
  });

  ctx.setStrokeColor(new Color(hexColor));
  ctx.setLineWidth(2.5);
  ctx.addPath(path);
  ctx.strokePath();

  // Barra inferior
  ctx.setFillColor(new Color("#263042"));
  ctx.fillRect(new Rect(4, 34, w - 8, 5));

  const barW = Math.max(8, ((w - 8) * Math.min(100, Math.max(5, pctFree))) / 100);
  ctx.setFillColor(new Color(hexColor));
  ctx.fillRect(new Rect(4, 34, barW, 5));

  return ctx.getImage();
}

// Menú interactivo nativo de iOS (NO abre Safari ni ninguna página web)
async function promptInteractiveMenu(data) {
  const walletAlert = new Alert();
  walletAlert.title = "⚡ Negocio • Modo Rápido";
  walletAlert.message = "Selecciona dónde deseas restar o agregar dinero/cupo:";
  walletAlert.addAction("💎 Cupo Tarjeta de Crédito");
  walletAlert.addAction("💵 Efectivo en Bolsillo");
  walletAlert.addAction("💳 Tarjeta Débito / Banco");
  walletAlert.addCancelAction("Cancelar");

  const wIdx = await walletAlert.presentSheet();
  if (wIdx === -1) return;
  const wallet = wIdx === 0 ? "Crédito" : wIdx === 1 ? "Efectivo" : "Tarjeta";

  const amtAlert = new Alert();
  amtAlert.title = `${wallet === "Crédito" ? "💎 Cupo Crédito" : wallet === "Efectivo" ? "💵 Efectivo" : "💳 T. Débito"}`;
  amtAlert.message = "Elige un monto rápido o escribe uno personalizado:";
  const presets = [5000, 15000, 30000, 50000];
  presets.forEach(p => amtAlert.addAction(fmt(p)));
  amtAlert.addAction("✏️ Escribir otro monto...");
  amtAlert.addCancelAction("Cancelar");

  const aIdx = await amtAlert.presentSheet();
  if (aIdx === -1) return;

  let amount = presets[aIdx] || 0;
  let concept = "";

  if (aIdx === 4) {
    const customAlert = new Alert();
    customAlert.title = "Ingresar Monto y Concepto";
    customAlert.addTextField("Monto $ (ej. 25000)", "");
    customAlert.addTextField("Concepto (ej. Supermercado)", "");
    customAlert.addAction("Continuar");
    customAlert.addCancelAction("Cancelar");
    const cRes = await customAlert.presentAlert();
    if (cRes === -1) return;
    amount = Number(customAlert.textFieldValue(0)) || 0;
    concept = customAlert.textFieldValue(1) || "";
  }

  if (amount <= 0) return;

  const actAlert = new Alert();
  actAlert.title = `Monto: ${fmt(amount)}`;
  actAlert.message = `¿Qué acción deseas aplicar en ${wallet}?`;
  actAlert.addDestructiveAction(wallet === "Crédito" ? `- Usar Tarjeta (Restar ${fmt(amount)})` : `- Restar de ${wallet} (${fmt(amount)})`);
  actAlert.addAction(wallet === "Crédito" ? `+ Pagar / Liberar Cupo (+${fmt(amount)})` : `+ Agregar a ${wallet} (+${fmt(amount)})`);
  actAlert.addCancelAction("Cancelar");

  const actIdx = await actAlert.presentSheet();
  if (actIdx === -1) return;
  const type = actIdx === 0 ? "gasto" : "ingreso";

  await saveMovementToSupabase(data, wallet, type, amount, concept);
}

const data = await loadCloudData();

if (config.runsInApp) {
  await promptInteractiveMenu(data);
}

const refreshed = config.runsInApp ? await loadCloudData() : data;
const pf = refreshed.personalFinances;
const cfg = refreshed.creditCardConfig;

const cashBal = pf.filter(f => getWallet(f) === "Efectivo").reduce((a, b) => a + (b.type === "ingreso" ? Number(b.amount) : -Number(b.amount)), 0);
const cardBal = pf.filter(f => getWallet(f) === "Tarjeta").reduce((a, b) => a + (b.type === "ingreso" ? Number(b.amount) : -Number(b.amount)), 0);
const credUsed = Math.max(0, Number(cfg.baseUsed || 0) + pf.filter(f => getWallet(f) === "Crédito").reduce((a, b) => a + (b.type === "gasto" ? Number(b.amount) : -Number(b.amount)), 0));
const totalLimit = Math.max(1, Number(cfg.totalLimit || 1000000));
const availCredit = Math.max(0, totalLimit - credUsed);
const daysLeft = calcDaysUntil(Number(cfg.paymentDay || 5));

// Construcción del Widget Oscuro idéntico a la captura con mini-gráfico abajo de cada saldo
const widget = new ListWidget();
widget.backgroundColor = new Color("#0b0f17");
widget.setPadding(12, 14, 12, 14);

const header = widget.addStack();
header.layoutHorizontally();
header.centerAlignContent();
const titleTxt = header.addText("⚡ Negocio • Modo Rápido");
titleTxt.font = Font.boldSystemFont(12);
titleTxt.textColor = new Color("#fbbf24");
header.addSpacer();

const pill = header.addStack();
pill.backgroundColor = new Color("#2c2008");
pill.cornerRadius = 10;
pill.setPadding(3, 8, 3, 8);
const pillTxt = pill.addText(`Pago día ${cfg.paymentDay || 5} (${daysLeft}d)`);
pillTxt.font = Font.semiboldSystemFont(10);
pillTxt.textColor = new Color("#fcd34d");

widget.addSpacer(10);

const cardsRow = widget.addStack();
cardsRow.layoutHorizontally();
cardsRow.spacing = 8;

function addWalletCard(parent, label, labelColor, amountVal, points, pctBar) {
  const card = parent.addStack();
  card.layoutVertically();
  card.backgroundColor = new Color("#151b28");
  card.cornerRadius = 12;
  card.setPadding(8, 8, 8, 8);

  const lbl = card.addText(label);
  lbl.font = Font.boldSystemFont(10);
  lbl.textColor = new Color(labelColor);

  card.addSpacer(3);
  const val = card.addText(fmt(amountVal));
  val.font = Font.boldSystemFont(13);
  val.textColor = new Color("#ffffff");
  val.minimumScaleFactor = 0.7;

  card.addSpacer(4);
  const chartImg = drawMiniChartImage(points, pctBar, labelColor);
  const imgWidget = card.addImage(chartImg);
  imgWidget.imageSize = new Size(88, 24);
}

const totalLiq = Math.max(1, Math.max(0, cashBal) + Math.max(0, cardBal));
addWalletCard(cardsRow, "💎 Cupo Créd.", "#fbbf24", availCredit, [availCredit * 0.9, availCredit * 0.95, availCredit], (availCredit / totalLimit) * 100);
addWalletCard(cardsRow, "💵 Efectivo", "#34d399", cashBal, [cashBal * 0.85, cashBal * 0.92, cashBal], (Math.max(0, cashBal) / totalLiq) * 100);
addWalletCard(cardsRow, "💳 T. Débito", "#38bdf8", cardBal, [cardBal * 0.88, cardBal * 0.94, cardBal], (Math.max(0, cardBal) / totalLiq) * 100);

widget.addSpacer(8);
const footer = widget.addText("Toca el widget para - Restar o + Agregar sin abrir la web");
footer.font = Font.mediumSystemFont(10);
footer.textColor = new Color("#64748b");

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();
