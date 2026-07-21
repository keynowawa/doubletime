import './pos.css';
import { strToU8, zipSync } from 'fflate';
import { Archive, Banknote, ChartNoAxesCombined, Check, ChevronDown, ChevronRight, CircleCheckBig, CirclePlus, Cloud, Copy, CreditCard, Download, FileSpreadsheet, House, ImagePlus, KeyRound, Landmark, LayoutGrid, LogOut, Mail, Minus, Pencil, PhilippinePeso, Plus, QrCode, ReceiptText, Search, Settings as SettingsIcon, ShoppingCart, Smartphone, Trash2, UserRound, UsersRound, WifiOff, X, createIcons } from 'lucide';
import { changePassword, createStaffAccount, getBusinessProfiles, getCurrentProfile, getSession, isCloudConfigured, sendSignInLink, signInWithPassword, signOut, watchAuth, watchBusinessChanges } from './pos-auth';
import { changeOrderStatus as persistOrderStatus, connectCloud, createOrder, exportBackup, flushOutbox, getModifiers, getOrders, getPriceLists, getProducts, getSettings, importBackup, initializeStore, save, syncFromCloud, updateManagerPin, usingCloud } from './pos-store';
import type { CartLine, Discount, Modifier, Order, OrderStatus, PaymentMethod, PosProfile, PriceList, Product, Settings } from './pos-types';

type View = 'sell' | 'dashboard' | 'orders' | 'catalog' | 'settings';
type Modal = '' | 'modifiers' | 'discount' | 'payment' | 'receipt' | 'product' | 'modifier' | 'order' | 'price-list' | 'price-picker' | 'account';

const app = document.querySelector<HTMLElement>('#pos-app')!;
const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const shortDate = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' });
const time = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' });

let products: Product[] = [];
let modifiers: Modifier[] = [];
let priceLists: PriceList[] = [];
let orders: Order[] = [];
let settings: Settings;
let cart: CartLine[] = [];
let view: View = 'sell';
let modal: Modal = '';
let activeProduct: Product | null = null;
let activeOrder: Order | null = null;
let editingProduct: Product | null = null;
let editingModifier: Modifier | null = null;
let selectedModifiers = new Set<string>();
let discount: Discount | null = null;
let customerName = '';
let orderNote = '';
let paymentMethod: PaymentMethod = 'cash';
let cashReceived = '';
let latestOrder: Order | null = null;
let dashboardRange = 'today';
let catalogTab: 'products' | 'addons' | 'prices' = 'products';
let orderSearch = '';
let orderRange = 'all';
let orderStatus = 'all';
let orderPayment = 'all';
let orderSort = 'newest';
let deferredInstallPrompt: Event | null = null;
let editingPriceList: PriceList | null = null;
let currentProfile: PosProfile | null = null;
let businessProfiles: PosProfile[] = [];
let signInSentTo = '';
let stopBusinessWatcher: (() => void) | null = null;
let authWatcherStarted = false;
let localPreviewEnabled = sessionStorage.getItem('doubletime-local-preview') === 'true';

const paymentMethods: { id: PaymentMethod; label: string; note: string; icon: string }[] = [
  { id: 'cash', label: 'cash', note: 'calculate change', icon: 'banknote' },
  { id: 'gcash', label: 'gcash', note: 'record e-wallet', icon: 'smartphone' },
  { id: 'maya', label: 'maya', note: 'record e-wallet', icon: 'smartphone' },
  { id: 'qrph', label: 'qr ph', note: 'record qr payment', icon: 'qr-code' },
  { id: 'card', label: 'card', note: 'record card sale', icon: 'credit-card' },
  { id: 'bank', label: 'bank transfer', note: 'record transfer', icon: 'landmark' },
];
const paymentLabel = (method: PaymentMethod) => paymentMethods.find((item) => item.id === method)?.label || method;
const isOwner = () => !isCloudConfigured || currentProfile?.role === 'owner';
const canOpenView = (requested: View) => isOwner() || requested === 'sell' || requested === 'orders';
const profileInitials = () => (currentProfile?.displayName || currentProfile?.email || 'local').split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toLowerCase();

const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const clone = <T>(value: T): T => typeof globalThis.structuredClone === 'function'
  ? globalThis.structuredClone(value)
  : JSON.parse(JSON.stringify(value)) as T;
const esc = (value: unknown) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!);
const activePriceList = () => priceLists.find((item) => item.id === settings.activePriceListId && !item.archived) || priceLists.find((item) => !item.archived);
const currentPrice = (product: Product) => activePriceList()?.prices[product.id] ?? product.price;
const lineUnitPrice = (line: CartLine) => line.unitPrice ?? currentPrice(line.product) + line.modifiers.reduce((sum, item) => sum + item.price, 0);
const subtotal = () => cart.reduce((sum, line) => sum + lineUnitPrice(line) * line.quantity, 0);
const discountAmount = () => {
  if (!discount) return 0;
  return Math.min(subtotal(), discount.type === 'percent' ? subtotal() * discount.value / 100 : discount.value);
};
const totals = () => {
  const beforeTax = Math.max(0, subtotal() - discountAmount());
  const rate = settings.taxEnabled ? Math.max(0, settings.taxRate) / 100 : 0;
  const tax = !rate ? 0 : settings.taxInclusive ? beforeTax - beforeTax / (1 + rate) : beforeTax * rate;
  return { subtotal: subtotal(), discount: discountAmount(), tax, total: settings.taxInclusive ? beforeTax : beforeTax + tax };
};

function navItem(id: View, label: string, glyph: string) {
  return `<button class="nav-item ${view === id ? 'active' : ''}" data-view="${id}" aria-label="${label}"><i data-lucide="${glyph}"></i><small>${label}</small></button>`;
}

function brandMark() {
  return `<div class="brand-mark"><img src="/assets/DT-LOGO-001.png" alt="doubletime"></div>`;
}

function hydrateIcons() {
  createIcons({ icons: { Archive, Banknote, ChartNoAxesCombined, Check, ChevronDown, ChevronRight, CircleCheckBig, CirclePlus, Cloud, Copy, CreditCard, Download, FileSpreadsheet, House, ImagePlus, KeyRound, Landmark, LayoutGrid, LogOut, Mail, Minus, Pencil, PhilippinePeso, Plus, QrCode, ReceiptText, Search, Settings: SettingsIcon, ShoppingCart, Smartphone, Trash2, UserRound, UsersRound, WifiOff, X }, attrs: { 'stroke-width': '1.8', 'aria-hidden': 'true' } });
}

function render() {
  if (!canOpenView(view)) view = 'sell';
  const ownerNavigation = isOwner() ? `${navItem('dashboard', 'insights', 'chart-no-axes-combined')}` : '';
  const ownerManagement = isOwner() ? `${navItem('catalog', 'menu', 'layout-grid')}${navItem('settings', 'settings', 'settings')}` : '';
  app.innerHTML = `<div class="app-shell">
    <aside class="app-nav">
      ${brandMark()}
      <nav>${navItem('sell', 'sell', 'shopping-cart')}${ownerNavigation}${navItem('orders', 'orders', 'receipt-text')}${ownerManagement}</nav>
      <button class="account-nav" data-action="open-account" aria-label="account"><span>${profileInitials()}</span><small>${currentProfile?.role || 'local'}</small></button>
    </aside>
    <section class="view-stage">${renderView()}</section>
  </div>${renderModal()}<div class="toast" id="toast" role="status"></div>`;
  hydrateIcons();
}

function renderView() {
  if (view === 'dashboard') return renderDashboard();
  if (view === 'orders') return renderOrders();
  if (view === 'catalog') return renderCatalog();
  if (view === 'settings') return renderSettings();
  return renderSell();
}

function renderSell() {
  const availableProducts = products.filter((product) => !product.archived);
  const amount = totals();
  return `<div class="sell-layout">
    <section class="product-stage">
      <header class="page-header sell-header">
        <div><p class="eyebrow">take your time.</p><h1>what are we making?</h1><p>tap a drink, choose the extras, and keep the line moving.</p></div>
        <div class="header-badges">${isOwner() ? `<button class="price-switcher" data-action="open-price-picker"><span>${esc(activePriceList()?.name || 'pricing')}</span><i data-lucide="chevron-down"></i></button>` : `<span class="price-switcher read-only"><span>${esc(activePriceList()?.name || 'pricing')}</span></span>`}<span class="date-badge">${new Date().toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }).toLowerCase()}</span></div>
      </header>
      <div class="section-label"><span>matcha</span><small>${availableProducts.filter((item) => !item.soldOut).length} available</small></div>
      <div class="product-grid">${availableProducts.map(renderProductCard).join('')}</div>
    </section>
    <aside class="cart-stage">
      <div class="cart-header"><div class="cart-title"><h2>current order</h2><span>#${String(settings.nextOrderNumber).padStart(3, '0')}</span></div>${cart.length ? '<button class="text-button light clear-order" data-action="clear-cart" aria-label="clear current order"><i data-lucide="trash-2"></i><span>clear</span></button>' : ''}</div>
      <div class="cart-scroll">${cart.length ? cart.map(renderCartLine).join('') : `<div class="empty-cart"><div class="empty-cup"><span></span></div><h3>take your time.</h3><p>your next good cup<br>starts on the left.</p></div>`}</div>
      ${cart.length ? `<div class="order-fields">
        <div class="inline-fields"><label><span>customer</span><input data-field="customer" value="${esc(customerName)}" placeholder="walk-in name (optional)"></label><label><span>note</span><input data-field="note" value="${esc(orderNote)}" placeholder="e.g. less ice"></label></div>
        <button class="discount-row" data-action="open-discount"><span>${discount ? esc(discount.label) : 'add a discount'}</span><strong>${discount ? `−${money.format(amount.discount)}` : '+'}</strong></button>
      </div>` : ''}
      <div class="cart-summary">
        ${cart.length ? `<div><span>subtotal</span><strong>${money.format(amount.subtotal)}</strong></div>` : ''}
        ${amount.discount ? `<div class="discount-total"><span>discount</span><strong>−${money.format(amount.discount)}</strong></div>` : ''}
        ${settings.taxEnabled ? `<div><span>${esc(settings.taxName)} ${settings.taxInclusive ? 'included' : ''}</span><strong>${money.format(amount.tax)}</strong></div>` : ''}
        <div class="grand-total"><span>total</span><strong>${money.format(amount.total)}</strong></div>
        <button class="primary-action" data-action="checkout" ${cart.length ? '' : 'disabled'}>${cart.length ? `<span>charge</span><strong>${money.format(amount.total)}</strong>` : '<span>add a drink to begin</span>'}</button>
      </div>
    </aside>
  </div>`;
}

function renderProductCard(product: Product) {
  const price = currentPrice(product);
  return `<button class="product-card ${product.soldOut ? 'sold-out' : ''}" data-product="${product.id}" ${product.soldOut ? 'disabled' : ''}>
    <div class="product-image"><img src="${esc(product.image)}" alt="" loading="lazy"><span class="add-dot">+</span>${product.soldOut ? '<em>sold out</em>' : ''}</div>
    <small>${esc(product.sku)}</small><h3>${esc(product.name)}</h3><p>${esc(product.description)}</p>
    <div class="product-price"><strong>${money.format(price)}</strong></div>
  </button>`;
}

function renderCartLine(line: CartLine, index: number) {
  return `<article class="cart-line">
    <div class="cart-line-top"><div><h3>${esc(line.product.name)}</h3><p>${line.modifiers.length ? line.modifiers.map((item) => esc(item.name)).join(' · ') : 'no add-ons'}</p></div><strong>${money.format(lineUnitPrice(line) * line.quantity)}</strong></div>
    <div class="line-controls"><div class="stepper"><button data-quantity="${index}" data-delta="-1" aria-label="decrease ${esc(line.product.name)} quantity"><i data-lucide="minus"></i></button><span>${line.quantity}</span><button data-quantity="${index}" data-delta="1" aria-label="increase ${esc(line.product.name)} quantity"><i data-lucide="plus"></i></button></div><button class="remove-line" data-remove="${index}" aria-label="remove ${esc(line.product.name)} from order"><i data-lucide="trash-2"></i><span class="visually-hidden">remove ${esc(line.product.name)}</span></button></div>
  </article>`;
}

function filteredOrders() {
  const now = new Date();
  let start: Date | null = null;
  if (dashboardRange === 'today') start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (dashboardRange === '7days') start = new Date(now.getTime() - 6 * 86400000);
  if (dashboardRange === '30days') start = new Date(now.getTime() - 29 * 86400000);
  return orders.filter((order) => (!start || new Date(order.createdAt) >= start) && order.status === 'completed');
}

function renderDashboard() {
  const sales = filteredOrders();
  const revenue = sales.reduce((sum, order) => sum + order.total, 0);
  const itemCount = sales.reduce((sum, order) => sum + order.lines.reduce((lineSum, line) => lineSum + line.quantity, 0), 0);
  const discounts = sales.reduce((sum, order) => sum + order.discount, 0);
  const average = sales.length ? revenue / sales.length : 0;
  const series = dashboardSeries(sales);
  const maxSeries = Math.max(...series.map((item) => item.value), 1);
  const payments = [
    { method: 'cash', value: sales.filter((order) => order.paymentMethod === 'cash').reduce((sum, order) => sum + order.total, 0) },
    { method: 'wallets + qr', value: sales.filter((order) => ['gcash','maya','qrph'].includes(order.paymentMethod)).reduce((sum, order) => sum + order.total, 0) },
    { method: 'card + bank', value: sales.filter((order) => ['card','bank'].includes(order.paymentMethod)).reduce((sum, order) => sum + order.total, 0) },
  ];
  const cashAngle = revenue ? payments[0].value / revenue * 360 : 0;
  const gcashAngle = revenue ? payments[1].value / revenue * 360 + cashAngle : 0;
  const productSales = productPerformance(sales).slice(0, 5);
  const maxProduct = Math.max(...productSales.map((item) => item.quantity), 1);

  return `<div class="page dashboard-page">
    ${pageHeader('good cups, at a glance.', 'sales, orders, and what people keep coming back for.', `<select class="range-select" data-range>${rangeOptions()}</select>`)}
    <div class="kpi-grid">
      ${kpi('net sales', money.format(revenue), 'after discounts')}${kpi('orders', String(sales.length), 'completed sales')}${kpi('average order', money.format(average), 'per transaction')}${kpi('items sold', String(itemCount), 'drinks + extras')}${kpi('discounts', money.format(discounts), 'given this period')}
    </div>
    <div class="dashboard-grid">
      <section class="panel sales-chart"><div class="panel-title"><div><h2>sales rhythm</h2><p>${rangeLabel()}</p></div><strong>${money.format(revenue)}</strong></div>
        ${sales.length ? `<div class="bar-chart">${series.map((item) => `<div class="bar-column"><span class="bar-value">${item.value ? money.format(item.value) : ''}</span><i style="height:${Math.max(4, item.value / maxSeries * 100)}%"></i><small>${item.label}</small></div>`).join('')}</div>` : emptyPanel('no sales in this range yet', 'chart-no-axes-combined')}
      </section>
      <section class="panel payment-panel"><div class="panel-title"><div><h2>payment mix</h2><p>where sales landed</p></div></div>
        ${sales.length ? `<div class="payment-content"><div class="donut" style="--cash:${cashAngle}deg;--gcash:${gcashAngle}deg"><span><strong>${sales.length}</strong><small>orders</small></span></div><div class="legend">${payments.map((item, index) => `<div><i class="pay-${index}"></i><span>${item.method}</span><strong>${money.format(item.value)}</strong></div>`).join('')}</div></div>` : emptyPanel('payment mix appears after your first sale', 'credit-card')}
      </section>
      <section class="panel product-panel"><div class="panel-title"><div><h2>crowd favorites</h2><p>best-selling drinks</p></div></div>
        ${productSales.length ? `<div class="ranking">${productSales.map((item, index) => `<div><span class="rank">0${index + 1}</span><div><strong>${esc(item.name)}</strong><i><b style="width:${item.quantity / maxProduct * 100}%"></b></i></div><em>${item.quantity}</em></div>`).join('')}</div>` : emptyPanel('best sellers appear after your first sale', 'shopping-cart')}
      </section>
      <section class="panel quick-panel"><div class="panel-title"><div><h2>quick actions</h2><p>keep your records close</p></div></div><div class="quick-actions"><button data-action="export-excel"><span><i data-lucide="file-spreadsheet"></i></span><strong>export excel</strong><small>full sales workbook</small></button><button data-action="export-csv"><span><i data-lucide="receipt-text"></i></span><strong>export csv</strong><small>order summary</small></button><button data-action="backup"><span><i data-lucide="download"></i></span><strong>backup data</strong><small>device recovery file</small></button></div></section>
    </div>
  </div>`;
}

function dashboardSeries(sales: Order[]) {
  const now = new Date();
  if (dashboardRange === 'today') {
    return [8, 10, 12, 14, 16, 18, 20].map((hour) => ({ label: `${hour > 12 ? hour - 12 : hour}${hour >= 12 ? 'p' : 'a'}`, value: sales.filter((order) => { const h = new Date(order.createdAt).getHours(); return h >= hour && h < hour + 2; }).reduce((sum, order) => sum + order.total, 0) }));
  }
  const days = dashboardRange === '30days' ? 10 : 7;
  const step = dashboardRange === '30days' ? 3 : 1;
  return Array.from({ length: days }, (_, index) => {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1 - index) * step + 1);
    const start = new Date(end.getTime() - step * 86400000);
    return { label: shortDate.format(start).toLowerCase(), value: sales.filter((order) => { const date = new Date(order.createdAt); return date >= start && date < end; }).reduce((sum, order) => sum + order.total, 0) };
  });
}

function productPerformance(sales: Order[]) {
  const map = new Map<string, { name: string; quantity: number }>();
  for (const order of sales) for (const line of order.lines) {
    const current = map.get(line.product.id) || { name: line.product.name, quantity: 0 };
    current.quantity += line.quantity;
    map.set(line.product.id, current);
  }
  return [...map.values()].sort((a, b) => b.quantity - a.quantity);
}

function renderOrders() {
  const query = orderSearch.trim().toLowerCase();
  const now = new Date();
  const rangeStart = orderRange === 'today' ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : orderRange === '7days' ? new Date(now.getTime() - 6 * 86400000) : orderRange === '30days' ? new Date(now.getTime() - 29 * 86400000) : null;
  const matches = orders.filter((order) => {
    const matchesSearch = !query || String(order.number).includes(query) || order.customerName.toLowerCase().includes(query) || paymentLabel(order.paymentMethod).includes(query);
    return matchesSearch && (!rangeStart || new Date(order.createdAt) >= rangeStart) && (orderStatus === 'all' || order.status === orderStatus) && (orderPayment === 'all' || order.paymentMethod === orderPayment);
  }).sort((a, b) => orderSort === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : orderSort === 'highest' ? b.total - a.total : orderSort === 'lowest' ? a.total - b.total : b.createdAt.localeCompare(a.createdAt));
  const today = new Date().toDateString();
  const todayOrders = orders.filter((order) => new Date(order.createdAt).toDateString() === today && order.status === 'completed');
  return `<div class="page orders-page">
    ${pageHeader('orders', 'all recorded orders, with today shown up top.', isOwner() ? `<div class="order-header-actions"><button class="secondary-button" data-action="export-csv">export csv</button><button class="secondary-button dark" data-action="export-excel">export excel</button></div>` : '')}
    <div class="order-strip"><div><span>today's sales</span><strong>${money.format(todayOrders.reduce((sum, order) => sum + order.total, 0))}</strong></div><div><span>today's orders</span><strong>${todayOrders.length}</strong></div><div class="all-orders-stat"><span>all recorded</span><strong>${orders.length} orders</strong></div></div>
    <div class="orders-toolbar panel"><label class="search-box"><i data-lucide="search"></i><input data-field="order-search" value="${esc(orderSearch)}" placeholder="search order, customer, payment"></label><div class="table-filters"><label><span class="visually-hidden">date range</span><select data-order-filter="range"><option value="all" ${orderRange === 'all' ? 'selected' : ''}>all time</option><option value="today" ${orderRange === 'today' ? 'selected' : ''}>today</option><option value="7days" ${orderRange === '7days' ? 'selected' : ''}>last 7 days</option><option value="30days" ${orderRange === '30days' ? 'selected' : ''}>last 30 days</option></select></label><label><span class="visually-hidden">status</span><select data-order-filter="status"><option value="all" ${orderStatus === 'all' ? 'selected' : ''}>all statuses</option><option value="completed" ${orderStatus === 'completed' ? 'selected' : ''}>completed</option><option value="refunded" ${orderStatus === 'refunded' ? 'selected' : ''}>refunded</option><option value="voided" ${orderStatus === 'voided' ? 'selected' : ''}>voided</option></select></label><label><span class="visually-hidden">payment</span><select data-order-filter="payment"><option value="all" ${orderPayment === 'all' ? 'selected' : ''}>all payments</option>${paymentMethods.map((method) => `<option value="${method.id}" ${orderPayment === method.id ? 'selected' : ''}>${method.label}</option>`).join('')}</select></label><label><span class="visually-hidden">sort orders</span><select data-order-filter="sort"><option value="newest" ${orderSort === 'newest' ? 'selected' : ''}>newest first</option><option value="oldest" ${orderSort === 'oldest' ? 'selected' : ''}>oldest first</option><option value="highest" ${orderSort === 'highest' ? 'selected' : ''}>highest total</option><option value="lowest" ${orderSort === 'lowest' ? 'selected' : ''}>lowest total</option></select></label></div></div>
    <section class="order-table panel"><div class="table-head"><span>order</span><span>time</span><span>items</span><span>payment</span><span>status</span><span>total</span></div>
      ${matches.length ? matches.map((order) => `<button class="table-row" data-order="${order.id}"><span><strong>#${String(order.number).padStart(3, '0')}</strong><small>${esc(order.customerName || 'walk-in')}</small></span><span>${shortDate.format(new Date(order.createdAt)).toLowerCase()} · ${time.format(new Date(order.createdAt)).toLowerCase()}</span><span>${order.lines.reduce((sum, line) => sum + line.quantity, 0)}</span><span>${paymentLabel(order.paymentMethod)}</span><span><i class="status-pill ${order.status}">${order.status}</i></span><span><strong>${money.format(order.total)}</strong><i data-lucide="chevron-right"></i></span></button>`).join('') : emptyTable(query || orderRange !== 'all' || orderStatus !== 'all' || orderPayment !== 'all' ? 'no orders match these filters.' : 'completed orders will appear here.')}
    </section>
  </div>`;
}

function renderCatalog() {
  const activeProducts = products.filter((item) => !item.archived);
  const activeModifiers = modifiers.filter((item) => !item.archived);
  const availablePriceLists = priceLists.filter((item) => !item.archived);
  const action = catalogTab === 'products' ? '<button class="primary-small add-action" data-action="new-product"><i data-lucide="circle-plus"></i><span>add product</span></button>' : catalogTab === 'addons' ? '<button class="primary-small add-action" data-action="new-modifier"><i data-lucide="circle-plus"></i><span>add add-on</span></button>' : '<button class="primary-small add-action" data-action="new-price-list"><i data-lucide="circle-plus"></i><span>add price list</span></button>';
  return `<div class="page catalog-page">
    ${pageHeader('menu', 'drinks, add-ons, and pricing in one quiet place.', action)}
    <div class="tabs"><button class="${catalogTab === 'products' ? 'active' : ''}" data-catalog-tab="products">products <span>${activeProducts.length}</span></button><button class="${catalogTab === 'addons' ? 'active' : ''}" data-catalog-tab="addons">add-ons <span>${activeModifiers.length}</span></button><button class="${catalogTab === 'prices' ? 'active' : ''}" data-catalog-tab="prices">price lists <span>${availablePriceLists.length}</span></button></div>
    ${catalogTab === 'products' ? `<div class="catalog-list">${activeProducts.map((product) => `<article class="catalog-row product-admin-row ${product.soldOut ? 'is-sold' : ''}"><div class="catalog-thumb"><img src="${esc(product.image)}" alt=""></div><div class="catalog-name"><small>${esc(product.sku)}</small><strong>${esc(product.name)}</strong><span>${esc(product.description)}</span></div><div class="catalog-price"><small>${esc(activePriceList()?.name || 'active price')}</small><strong>${money.format(currentPrice(product))}</strong></div><button class="stock-toggle ${product.soldOut ? 'sold' : ''}" data-sold-out="${product.id}">${product.soldOut ? 'sold out' : 'available'}</button><button class="row-menu" data-edit-product="${product.id}"><i data-lucide="pencil"></i><span>edit</span></button></article>`).join('')}</div>` : catalogTab === 'addons' ? `<div class="catalog-list">${activeModifiers.map((item) => `<article class="catalog-row addon-row"><div class="addon-mark"><i data-lucide="circle-plus"></i></div><div class="catalog-name"><small>${esc(item.sku)}</small><strong>${esc(item.name)}</strong><span>available on ${products.filter((product) => !product.archived && product.modifierIds.includes(item.id)).length} product(s)</span></div><div class="catalog-price"><small>price</small><strong>${money.format(item.price)}</strong></div><button class="row-menu" data-edit-modifier="${item.id}"><i data-lucide="pencil"></i><span>edit</span></button></article>`).join('')}</div>` : `<div class="price-list-grid">${availablePriceLists.map((list) => renderPriceListCard(list)).join('')}</div>`}
  </div>`;
}

function renderSettings() {
  const availablePriceLists = priceLists.filter((item) => !item.archived);
  const teamCard = isCloudConfigured && currentProfile?.role === 'owner' ? `<section class="settings-card panel team-card"><div class="settings-title"><span><i data-lucide="users-round"></i></span><div><h2>team access</h2><p>create staff access without waiting for email.</p></div></div><form id="invite-staff-form"><div class="team-create-fields"><label><span>staff name</span><input name="displayName" autocomplete="name" placeholder="e.g. sam" required></label><label><span>email</span><input name="email" type="email" autocomplete="email" placeholder="name@example.com" required></label><label class="full"><span>temporary password</span><input name="temporaryPassword" type="password" autocomplete="new-password" minlength="8" placeholder="at least 8 characters" required></label></div><p class="team-helper">share this password privately. staff can change it from account after signing in.</p><button class="secondary-button wide invite-button" type="submit"><i data-lucide="key-round"></i><span>create staff account</span></button></form><div class="team-list">${businessProfiles.map((profile) => `<div><span class="team-avatar">${esc((profile.displayName || profile.email).slice(0, 1).toLowerCase())}</span><span><strong>${esc(profile.displayName || profile.email)}</strong><small>${esc(profile.email)}</small></span><em class="team-role">${profile.role}</em></div>`).join('') || '<p>your team will appear here.</p>'}</div></section>` : '';
  return `<div class="page settings-page">
    ${pageHeader('settings', 'the small things that keep service smooth.', '')}
    <div class="settings-grid">
      <form class="settings-card panel" id="business-settings"><div class="settings-title"><span><i data-lucide="philippine-peso"></i></span><div><h2>pricing & tax</h2><p>change how totals are calculated.</p></div></div>
        <label><span>active price list</span><select name="activePriceListId">${availablePriceLists.map((item) => `<option value="${item.id}" ${settings.activePriceListId === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label>
        <button class="subtle-link" type="button" data-action="manage-price-lists">manage price lists</button>
        <label class="switch-row"><span><strong>add tax</strong><small>keep off if prices are final as-is</small></span><input type="checkbox" name="taxEnabled" ${settings.taxEnabled ? 'checked' : ''}><i></i></label>
        <fieldset class="tax-controls ${settings.taxEnabled ? '' : 'disabled'}" ${settings.taxEnabled ? '' : 'disabled'}><div class="two-fields"><label><span>tax name</span><input name="taxName" value="${esc(settings.taxName)}" placeholder="e.g. vat"></label><label><span>tax rate</span><div class="suffix-input"><input name="taxRate" type="number" min="0" max="100" step="0.01" value="${settings.taxRate}" placeholder="e.g. 12"><span>%</span></div></label></div>
        <label><span>tax behavior</span><select name="taxInclusive"><option value="true" ${settings.taxInclusive ? 'selected' : ''}>included in menu prices</option><option value="false" ${!settings.taxInclusive ? 'selected' : ''}>added at checkout</option></select></label></fieldset>
        <button class="primary-small wide" type="submit">save settings</button>
      </form>
      <section class="settings-card panel"><div class="settings-title"><span><i data-lucide="download"></i></span><div><h2>exports & backup</h2><p>keep a copy somewhere safe.</p></div></div>
        <div class="settings-actions"><button data-action="export-excel"><strong>export excel workbook</strong><small>summary, orders, items, and payments</small><b><i data-lucide="file-spreadsheet"></i></b></button><button data-action="export-csv"><strong>export sales csv</strong><small>opens in excel or google sheets</small><b><i data-lucide="receipt-text"></i></b></button><button data-action="backup"><strong>download full backup</strong><small>products, settings, and all sales</small><b><i data-lucide="download"></i></b></button><button data-action="import"><strong>restore from backup</strong><small>choose a doubletime backup file</small><b class="restore-icon"><i data-lucide="download"></i></b></button><input id="backup-input" type="file" accept="application/json" hidden></div>
      </section>
      <section class="settings-card panel"><div class="settings-title"><span><i data-lucide="house"></i></span><div><h2>ipad home screen</h2><p>open doubletime like a regular app.</p></div></div><ol class="install-steps"><li><span>1</span>open this page in safari</li><li><span>2</span>tap the share button</li><li><span>3</span>choose “add to home screen”</li></ol><button class="secondary-button wide" data-action="install">${deferredInstallPrompt ? 'install doubletime' : 'ready for home screen'}</button></section>
      <form class="settings-card panel" id="security-settings"><div class="settings-title"><span><i data-lucide="settings"></i></span><div><h2>manager pin</h2><p>used for voids and refunds.</p></div></div><label><span>4–8 digit pin</span><input name="managerPin" inputmode="numeric" pattern="[0-9]{4,8}" value="${esc(settings.managerPin)}" placeholder="enter a new 4–8 digit pin" required></label><button class="secondary-button wide" type="submit">update pin</button></form>
      ${teamCard}
    </div>
  </div>`;
}

function pageHeader(title: string, description: string, actions: string) {
  return `<header class="page-header"><div><p class="eyebrow">take your time.</p><h1>${title}</h1><p>${description}</p></div>${actions}</header>`;
}

function renderPriceListCard(list: PriceList) {
  const isActive = list.id === settings.activePriceListId;
  return `<article class="price-list-card ${isActive ? 'active' : ''}"><div class="price-list-icon"><i data-lucide="philippine-peso"></i></div><div><small>${isActive ? 'active now' : 'price list'}</small><h3>${esc(list.name)}</h3><p>${products.filter((item) => !item.archived && list.prices[item.id] !== undefined).length} products priced</p></div><div class="price-list-actions">${isActive ? '<span class="active-check"><i data-lucide="check"></i> in use</span>' : `<button class="activate-price" data-use-price-list="${list.id}" aria-label="activate ${esc(list.name)}" title="activate price list"><i data-lucide="circle-check-big"></i></button>`}<button data-edit-price-list="${list.id}" aria-label="edit ${esc(list.name)}"><i data-lucide="pencil"></i></button><button data-duplicate-price-list="${list.id}" aria-label="duplicate ${esc(list.name)}"><i data-lucide="copy"></i></button>${!isActive && priceLists.filter((item) => !item.archived).length > 1 ? `<button class="danger-icon" data-archive-price-list="${list.id}" aria-label="delete ${esc(list.name)}"><i data-lucide="trash-2"></i></button>` : ''}</div></article>`;
}

function kpi(label: string, value: string, note: string) { return `<article class="kpi"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`; }
function emptyPanel(text: string, icon: string) { return `<div class="panel-empty"><span class="empty-state-icon"><i data-lucide="${icon}"></i></span><p>${text}</p></div>`; }
function emptyTable(text: string) { return `<div class="table-empty"><span class="empty-state-icon"><i data-lucide="receipt-text"></i></span><p>${text}</p></div>`; }
function rangeOptions() { return [['today','today'],['7days','last 7 days'],['30days','last 30 days'],['all','all time']].map(([value,label]) => `<option value="${value}" ${dashboardRange === value ? 'selected' : ''}>${label}</option>`).join(''); }
function rangeLabel() { return dashboardRange === 'today' ? 'today, by time of day' : dashboardRange === '7days' ? 'the last seven days' : dashboardRange === '30days' ? 'the last thirty days' : 'all recorded sales'; }

function renderSignIn() {
  const access = signInSentTo
    ? `<div class="auth-sent"><i data-lucide="mail"></i><div><strong>check your email</strong><span>we sent a private sign-in link to ${esc(signInSentTo)}.</span></div></div><button class="secondary-button wide" data-action="change-sign-in-email">back to password sign in</button>`
    : `<form id="sign-in-form"><label><span>account email</span><input id="sign-in-email" name="email" type="email" autocomplete="email" placeholder="doubletime.ph@gmail.com" required autofocus></label><label><span>password</span><input name="password" type="password" autocomplete="current-password" minlength="8" placeholder="your account password" required></label><button class="modal-primary" type="submit"><span>sign in</span><i data-lucide="key-round"></i></button><button class="auth-link-button" type="button" data-action="email-sign-in-link"><i data-lucide="mail"></i><span>email me a sign-in link instead</span></button></form>`;
  app.innerHTML = `<div class="auth-screen"><section class="auth-card">${brandMark()}<p class="eyebrow">your daily reward.</p><h1>sign in to doubletime</h1><p class="auth-intro">products, orders, and reports stay shared across every authorized ipad.</p>${access}<small class="auth-footnote">access is invite-only. each owner and staff member uses their own account.</small></section></div><div class="toast" id="toast" role="status"></div>`;
  hydrateIcons();
}

function renderCloudSetup() {
  app.innerHTML = `<div class="auth-screen"><section class="auth-card">${brandMark()}<p class="eyebrow">shared pos access</p><h1>supabase connection needed</h1><p class="auth-intro">the sign-in screen and shared multi-ipad database are ready. connect the DoubleTime Supabase project to activate them.</p><div class="auth-sent setup"><i data-lucide="cloud"></i><div><strong>what changes after connection</strong><span>owner and staff sign-in, shared orders, shared products, and automatic syncing.</span></div></div><button class="secondary-button wide" data-action="continue-local-preview">continue with local preview</button><small class="auth-footnote">local preview records stay on this device and are not shared.</small></section></div><div class="toast" id="toast" role="status"></div>`;
  hydrateIcons();
}

function renderAccountModal() {
  const cloudCopy = usingCloud() ? 'synced with the doubletime cloud database' : 'local preview only · not shared with other devices';
  const access = currentProfile ? `<section class="account-password"><div><strong>account password</strong><small>set or change the password used on your devices.</small></div><form id="change-password-form"><label><span>new password</span><input name="password" type="password" autocomplete="new-password" minlength="8" placeholder="at least 8 characters" required></label><label><span>confirm password</span><input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" placeholder="type it again" required></label><button class="secondary-button wide" type="submit"><i data-lucide="key-round"></i><span>save password</span></button></form></section><button class="danger-button account-signout" data-action="sign-out"><i data-lucide="log-out"></i><span>sign out on this ipad</span></button>` : '<p class="local-account-note">add the Supabase project details to enable owner and staff sign-in.</p>';
  return `<div class="modal-layer"><section class="modal-card compact account-card">${modalHead('account', 'the person currently using this ipad.')}<div class="account-profile"><span>${profileInitials()}</span><div><strong>${esc(currentProfile?.displayName || 'local preview')}</strong><small>${esc(currentProfile?.email || 'supabase is not connected yet')}</small></div><em>${currentProfile?.role || 'local'}</em></div><div class="sync-note ${usingCloud() ? '' : 'local'}"><i data-lucide="${usingCloud() ? 'cloud' : 'wifi-off'}"></i><span>${cloudCopy}</span></div>${access}</section></div>`;
}

function renderModal() {
  if (!modal) return '';
  if (modal === 'modifiers' && activeProduct) return renderModifierModal();
  if (modal === 'discount') return renderDiscountModal();
  if (modal === 'payment') return renderPaymentModal();
  if (modal === 'receipt' && latestOrder) return renderReceiptModal(latestOrder);
  if (modal === 'product') return renderProductModal();
  if (modal === 'modifier') return renderAddonModal();
  if (modal === 'order' && activeOrder) return renderOrderModal(activeOrder);
  if (modal === 'price-list') return renderPriceListModal();
  if (modal === 'price-picker') return renderPricePickerModal();
  if (modal === 'account') return renderAccountModal();
  return '';
}

function modalHead(title: string, note: string) { return `<div class="modal-head"><div><p class="eyebrow">doubletime</p><h2>${title}</h2><p>${note}</p></div><button class="modal-close" type="button" data-action="close-modal" aria-label="close"><i data-lucide="x"></i></button></div>`; }

function renderModifierModal() {
  const available = modifiers.filter((item) => !item.archived && activeProduct!.modifierIds.includes(item.id));
  const extra = available.filter((item) => selectedModifiers.has(item.id)).reduce((sum, item) => sum + item.price, 0);
  return `<div class="modal-layer"><section class="modal-card compact">${modalHead(activeProduct!.name, 'make it yours. add-ons are optional.')}
    <div class="selected-product"><div><img src="${esc(activeProduct!.image)}" alt=""></div><span>${esc(activeProduct!.description)}</span><strong>${money.format(currentPrice(activeProduct!))}</strong></div>
    <div class="field-heading"><span>add-ons</span><small>choose any</small></div>
    ${available.length ? `<div class="modifier-grid">${available.map((item) => `<button class="modifier-option ${selectedModifiers.has(item.id) ? 'selected' : ''}" data-modifier="${item.id}"><span>${esc(item.name)}</span><strong>+${money.format(item.price)}</strong><i>✓</i></button>`).join('')}</div>` : '<div class="simple-empty">no add-ons are set for this drink.</div>'}
    <button class="modal-primary" data-action="add-to-cart"><span>add to order</span><strong>${money.format(currentPrice(activeProduct!) + extra)}</strong></button>
  </section></div>`;
}

function renderDiscountModal() {
  return `<div class="modal-layer"><form class="modal-card compact" id="discount-form">${modalHead('add a discount', 'a quick adjustment for this order.')}
    <div class="preset-discounts"><button type="button" data-preset-discount="10">10% off</button><button type="button" data-preset-discount="15">15% off</button><button type="button" data-preset-discount="20">20% off</button></div>
    <div class="two-fields"><label><span>discount type</span><select name="type"><option value="percent" ${discount?.type !== 'fixed' ? 'selected' : ''}>percentage</option><option value="fixed" ${discount?.type === 'fixed' ? 'selected' : ''}>fixed amount</option></select></label><label><span>value</span><input name="value" type="number" min="0" step="0.01" value="${discount?.value ?? ''}" placeholder="e.g. 10" required></label></div>
    <label><span>label or reason</span><input name="label" value="${esc(discount?.label || '')}" placeholder="promo, staff, event…"></label>
    <div class="modal-split">${discount ? '<button type="button" class="danger-button" data-action="remove-discount"><i data-lucide="trash-2"></i><span>remove discount</span></button>' : '<span></span>'}<button class="modal-primary fit" type="submit">apply discount</button></div>
  </form></div>`;
}

function renderPaymentModal() {
  const amount = totals();
  const received = Number(cashReceived) || 0;
  const change = Math.max(0, received - amount.total);
  return `<div class="modal-layer"><section class="modal-card payment-card">${modalHead('payment', `order #${String(settings.nextOrderNumber).padStart(3, '0')} · ${money.format(amount.total)}`)}
    <div class="payment-options">${paymentMethods.map((method) => `<button class="payment-option ${paymentMethod === method.id ? 'selected' : ''}" data-payment="${method.id}"><i><span data-lucide="${method.icon}"></span></i><span>${method.label}</span><small>${method.note}</small></button>`).join('')}</div>
    ${paymentMethod === 'cash' ? `<div class="cash-section"><label><span>cash received</span><div class="money-input"><b>₱</b><input id="cash-received" inputmode="decimal" value="${esc(cashReceived)}" placeholder="0.00"></div></label><div class="quick-cash">${quickCash(amount.total).map((value) => `<button data-cash="${value}">${money.format(value)}</button>`).join('')}</div><div class="change-row"><span>change</span><strong id="change-value">${money.format(change)}</strong></div></div>` : `<div class="payment-note">confirm the ${paymentLabel(paymentMethod)} payment before completing the sale.</div>`}
    <button class="modal-primary" data-action="complete-sale" ${paymentMethod === 'cash' && received < amount.total ? 'disabled' : ''}><span>complete sale</span><strong>${money.format(amount.total)}</strong></button>
  </section></div>`;
}

function quickCash(total: number) { return [...new Set([Math.ceil(total / 50) * 50, Math.ceil(total / 100) * 100, 500, 1000])].filter((value) => value >= total).slice(0, 4); }

function renderReceiptModal(order: Order) {
  const change = order.cashReceived ? order.cashReceived - order.total : 0;
  return `<div class="modal-layer receipt-layer"><section class="modal-card receipt-card"><button class="modal-close receipt-close" data-action="new-order" aria-label="close receipt"><i data-lucide="x"></i></button>${brandMark()}<p>the sip you deserve.</p><div class="receipt-number">order #${String(order.number).padStart(3, '0')}</div><div class="receipt-lines">${order.lines.map((line) => `<div><span>${line.quantity}× ${esc(line.product.name)}<small>${line.modifiers.map((item) => esc(item.name)).join(', ')}</small></span><strong>${money.format(lineUnitPrice(line) * line.quantity)}</strong></div>`).join('')}</div><div class="receipt-totals"><div><span>paid via ${paymentLabel(order.paymentMethod)}</span><strong>${money.format(order.total)}</strong></div>${order.paymentMethod === 'cash' ? `<div><span>change</span><strong>${money.format(change)}</strong></div>` : ''}</div><small class="receipt-time">${new Date(order.createdAt).toLocaleString('en-PH').toLowerCase()}</small><button class="modal-primary" data-action="new-order">start a new order</button></section></div>`;
}

function renderProductModal() {
  const item = editingProduct;
  const image = item?.image || '';
  return `<div class="modal-layer"><form class="modal-card editor-card" id="product-form">${modalHead(item ? 'edit product' : 'add product', 'changes only affect the pos menu.')}
    <input type="hidden" name="id" value="${esc(item?.id || '')}"><div class="two-fields"><label><span>product name</span><input name="name" value="${esc(item?.name || '')}" placeholder="e.g. strawberry cloud" required></label><label><span>sku</span><input name="sku" value="${esc(item?.sku || '')}" placeholder="e.g. DT-MAT-NEW" required></label></div>
    <label><span>short description</span><input name="description" value="${esc(item?.description || '')}" placeholder="e.g. matcha with strawberry cream" required></label>
    <div class="two-fields"><label><span>category</span><input name="category" value="${esc(item?.category || 'matcha')}" placeholder="e.g. matcha" required></label><label><span>${esc(activePriceList()?.name || 'active')} price</span><input name="price" type="number" min="0" step="0.01" value="${item ? currentPrice(item) : ''}" placeholder="0.00" required></label></div>
    <div class="product-image-field"><span class="product-image-label">product image</span><label class="image-upload ${image ? 'has-image' : ''}" for="product-image-input">
      <input class="image-file-input" id="product-image-input" type="file" accept="image/*">
      <input id="product-image-value" type="hidden" name="image" value="${esc(image)}">
      <img class="image-upload-preview" src="${esc(image)}" alt="product preview" ${image ? '' : 'hidden'}>
      <span class="image-upload-placeholder" ${image ? 'hidden' : ''}><i data-lucide="image-plus"></i></span>
      <span class="image-upload-copy"><strong>${image ? 'replace photo' : 'choose a photo'}</strong><small>tap to open photos, or drag an image here</small></span>
    </label></div>
    <div class="field-heading"><span>available add-ons</span><small>shown when this product is tapped</small></div><div class="checkbox-grid">${modifiers.filter((modifier) => !modifier.archived).map((modifier) => `<label><input type="checkbox" name="modifierIds" value="${modifier.id}" ${item?.modifierIds.includes(modifier.id) ? 'checked' : ''}><i>✓</i><span>${esc(modifier.name)}</span></label>`).join('')}</div>
    <div class="modal-split">${item ? '<button type="button" class="danger-button" data-action="archive-product"><i data-lucide="archive"></i><span>archive product</span></button>' : '<span></span>'}<button class="modal-primary fit" type="submit">save product</button></div>
  </form></div>`;
}

function renderAddonModal() {
  const item = editingModifier;
  return `<div class="modal-layer"><form class="modal-card compact" id="modifier-form">${modalHead(item ? 'edit add-on' : 'add an add-on', 'keep extras simple and quick to tap.')}<input type="hidden" name="id" value="${esc(item?.id || '')}"><label><span>add-on name</span><input name="name" value="${esc(item?.name || '')}" placeholder="e.g. oat milk" required></label><div class="two-fields"><label><span>sku</span><input name="sku" value="${esc(item?.sku || '')}" placeholder="e.g. DT-ADD-OAT" required></label><label><span>price</span><input name="price" type="number" min="0" step="0.01" value="${item?.price ?? ''}" placeholder="0.00" required></label></div><div class="modal-split">${item ? '<button type="button" class="danger-button" data-action="archive-modifier"><i data-lucide="archive"></i><span>archive add-on</span></button>' : '<span></span>'}<button class="modal-primary fit" type="submit">save add-on</button></div></form></div>`;
}

function renderPricePickerModal() {
  const available = priceLists.filter((item) => !item.archived);
  return `<div class="modal-layer"><section class="modal-card compact">${modalHead('choose pricing', 'switch the whole menu in one tap.')}<div class="price-picker-list">${available.map((list) => `<button class="price-picker-option ${list.id === settings.activePriceListId ? 'selected' : ''}" data-use-price-list="${list.id}"><span><i data-lucide="philippine-peso"></i></span><div><strong>${esc(list.name)}</strong><small>${products.filter((item) => !item.archived && list.prices[item.id] !== undefined).length} products</small></div>${list.id === settings.activePriceListId ? '<i data-lucide="check"></i>' : ''}</button>`).join('')}</div><button class="subtle-link centered" data-action="manage-price-lists">manage price lists</button></section></div>`;
}

function renderPriceListModal() {
  const source = editingPriceList || activePriceList();
  const availableProducts = products.filter((item) => !item.archived);
  return `<div class="modal-layer"><form class="modal-card price-editor" id="price-list-form">${modalHead(editingPriceList ? 'edit price list' : 'new price list', 'one menu, one price for every drink.')}<input type="hidden" name="id" value="${esc(editingPriceList?.id || '')}"><label><span>price list name</span><input name="name" value="${esc(editingPriceList?.name || '')}" placeholder="e.g. porsche & pilates" required autofocus></label><div class="field-heading"><span>product prices</span><small>changes apply when this list is active</small></div><div class="price-editor-list">${availableProducts.map((product) => `<label><span class="price-product"><img src="${esc(product.image)}" alt=""><span><strong>${esc(product.name)}</strong><small>${esc(product.sku)}</small></span></span><span class="price-input"><b>₱</b><input name="price:${product.id}" type="number" min="0" step="0.01" value="${source?.prices[product.id] ?? product.price}" placeholder="0.00" required></span></label>`).join('')}</div><label class="switch-row activate-list"><span><strong>use after saving</strong><small>switch the selling screen to this list</small></span><input type="checkbox" name="activate" ${!editingPriceList ? 'checked' : ''}><i></i></label><button class="modal-primary" type="submit"><span>save price list</span><i data-lucide="check"></i></button></form></div>`;
}

function renderOrderModal(order: Order) {
  return `<div class="modal-layer"><section class="modal-card order-detail">${modalHead(`order #${String(order.number).padStart(3, '0')}`, `${shortDate.format(new Date(order.createdAt)).toLowerCase()} · ${time.format(new Date(order.createdAt)).toLowerCase()} · ${paymentLabel(order.paymentMethod)}`)}<div class="order-detail-status"><span class="status-pill ${order.status}">${order.status}</span><strong>${money.format(order.total)}</strong></div><div class="detail-lines">${order.lines.map((line) => `<div><span><strong>${line.quantity}× ${esc(line.product.name)}</strong><small>${line.modifiers.map((item) => esc(item.name)).join(' · ') || 'no add-ons'}</small></span><strong>${money.format(lineUnitPrice(line) * line.quantity)}</strong></div>`).join('')}</div>${order.customerName || order.note ? `<div class="order-memo"><span>${esc(order.customerName || 'walk-in')}</span><p>${esc(order.note || 'no order note')}</p></div>` : ''}<div class="detail-totals"><div><span>subtotal</span><strong>${money.format(order.subtotal)}</strong></div>${order.discount ? `<div><span>${esc(order.discountLabel)}</span><strong>−${money.format(order.discount)}</strong></div>` : ''}${order.tax ? `<div><span>${esc(order.taxName)}</span><strong>${money.format(order.tax)}</strong></div>` : ''}<div><span>total</span><strong>${money.format(order.total)}</strong></div></div>${order.status === 'completed' ? `<div class="order-fix"><p>need to fix this sale? enter the manager pin.</p><div><input id="order-pin" inputmode="numeric" type="password" placeholder="manager pin"><button data-order-status="refunded">refund</button><button data-order-status="voided">void</button></div></div>` : ''}</section></div>`;
}

app.addEventListener('click', async (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-view],[data-action],[data-product],[data-modifier],[data-quantity],[data-remove],[data-payment],[data-cash],[data-preset-discount],[data-range],[data-order],[data-catalog-tab],[data-sold-out],[data-edit-product],[data-edit-modifier],[data-order-status],[data-use-price-list],[data-edit-price-list],[data-duplicate-price-list],[data-archive-price-list]');
  if (!target) return;

  if (target.dataset.view) { const requested = target.dataset.view as View; if (!canOpenView(requested)) { toast('owner access required'); return; } view = requested; modal = ''; render(); return; }
  if (target.dataset.product) { activeProduct = products.find((item) => item.id === target.dataset.product)!; selectedModifiers.clear(); modal = 'modifiers'; render(); return; }
  if (target.dataset.modifier) { selectedModifiers.has(target.dataset.modifier) ? selectedModifiers.delete(target.dataset.modifier) : selectedModifiers.add(target.dataset.modifier); render(); return; }
  if (target.dataset.quantity) { const index = Number(target.dataset.quantity); cart[index].quantity += Number(target.dataset.delta); if (cart[index].quantity < 1) cart.splice(index, 1); render(); return; }
  if (target.dataset.remove) { cart.splice(Number(target.dataset.remove), 1); render(); return; }
  if (target.dataset.payment) { paymentMethod = target.dataset.payment as PaymentMethod; cashReceived = ''; render(); return; }
  if (target.dataset.cash) { cashReceived = target.dataset.cash; render(); focusCash(); return; }
  if (target.dataset.presetDiscount) { discount = { type: 'percent', value: Number(target.dataset.presetDiscount), label: `${target.dataset.presetDiscount}% off` }; modal = ''; render(); return; }
  if (target.dataset.order) { activeOrder = orders.find((item) => item.id === target.dataset.order)!; modal = 'order'; render(); return; }
  if (target.dataset.catalogTab) { catalogTab = target.dataset.catalogTab as 'products' | 'addons' | 'prices'; render(); return; }
  if (target.dataset.soldOut) { const item = products.find((product) => product.id === target.dataset.soldOut)!; item.soldOut = !item.soldOut; await save('products', item); await refreshData(); render(); return; }
  if (target.dataset.editProduct) { editingProduct = products.find((item) => item.id === target.dataset.editProduct)!; modal = 'product'; render(); return; }
  if (target.dataset.editModifier) { editingModifier = modifiers.find((item) => item.id === target.dataset.editModifier)!; modal = 'modifier'; render(); return; }
  if (target.dataset.orderStatus) { await changeOrderStatus(target.dataset.orderStatus as OrderStatus); return; }
  if (target.dataset.usePriceList) { await usePriceList(target.dataset.usePriceList); return; }
  if (target.dataset.editPriceList) { editingPriceList = priceLists.find((item) => item.id === target.dataset.editPriceList)!; modal = 'price-list'; render(); return; }
  if (target.dataset.duplicatePriceList) { await duplicatePriceList(target.dataset.duplicatePriceList); return; }
  if (target.dataset.archivePriceList) { await archivePriceList(target.dataset.archivePriceList); return; }

  switch (target.dataset.action) {
    case 'close-modal': modal = ''; render(); break;
    case 'open-account': modal = 'account'; render(); break;
    case 'change-sign-in-email': signInSentTo = ''; renderSignIn(); break;
    case 'email-sign-in-link': {
      const emailInput = document.querySelector<HTMLInputElement>('#sign-in-email');
      if (!emailInput?.reportValidity()) break;
      const button = target as HTMLButtonElement;
      button.disabled = true;
      try { await sendSignInLink(emailInput.value); signInSentTo = emailInput.value.trim().toLowerCase(); renderSignIn(); }
      catch (error) { button.disabled = false; toast(error instanceof Error ? error.message.toLowerCase() : 'sign-in link could not be sent'); }
      break;
    }
    case 'continue-local-preview': localPreviewEnabled = true; sessionStorage.setItem('doubletime-local-preview', 'true'); await refreshData(); render(); break;
    case 'sign-out': await handleSignOut(); break;
    case 'clear-cart': cart = []; discount = null; customerName = ''; orderNote = ''; render(); break;
    case 'add-to-cart': addToCart(); break;
    case 'open-discount': modal = 'discount'; render(); break;
    case 'remove-discount': discount = null; modal = ''; render(); break;
    case 'checkout': paymentMethod = 'cash'; cashReceived = ''; modal = 'payment'; render(); focusCash(); break;
    case 'complete-sale': await completeSale(); break;
    case 'new-order': latestOrder = null; modal = ''; render(); break;
    case 'new-product': editingProduct = null; modal = 'product'; render(); break;
    case 'new-modifier': editingModifier = null; modal = 'modifier'; render(); break;
    case 'new-price-list': editingPriceList = null; modal = 'price-list'; render(); break;
    case 'open-price-picker': modal = 'price-picker'; render(); break;
    case 'manage-price-lists': catalogTab = 'prices'; view = 'catalog'; modal = ''; render(); break;
    case 'archive-product': await archiveProduct(); break;
    case 'archive-modifier': await archiveModifier(); break;
    case 'export-csv': if (isOwner()) exportCsv(); else toast('owner access required'); break;
    case 'export-excel': if (isOwner()) await exportExcel(); else toast('owner access required'); break;
    case 'backup': if (isOwner()) await downloadBackup(); else toast('owner access required'); break;
    case 'import': if (isOwner()) document.querySelector<HTMLInputElement>('#backup-input')?.click(); else toast('owner access required'); break;
    case 'install': await installApp(); break;
  }
});

app.addEventListener('input', (event) => {
  const input = event.target as HTMLInputElement;
  if (input.dataset.field === 'customer') customerName = input.value;
  if (input.dataset.field === 'note') orderNote = input.value;
  if (input.dataset.field === 'order-search') { orderSearch = input.value; render(); const restored = document.querySelector<HTMLInputElement>('[data-field="order-search"]'); restored?.focus(); restored?.setSelectionRange(orderSearch.length, orderSearch.length); }
  if (input.id === 'cash-received') {
    cashReceived = input.value;
    const change = Math.max(0, (Number(cashReceived) || 0) - totals().total);
    const value = document.querySelector('#change-value'); if (value) value.textContent = money.format(change);
    const button = document.querySelector<HTMLButtonElement>('[data-action="complete-sale"]'); if (button) button.disabled = (Number(cashReceived) || 0) < totals().total;
  }
});

app.addEventListener('change', async (event) => {
  const input = event.target as HTMLInputElement | HTMLSelectElement;
  if (input.hasAttribute('data-range')) { dashboardRange = input.value; render(); }
  if (input.dataset.orderFilter === 'range') { orderRange = input.value; render(); }
  if (input.dataset.orderFilter === 'status') { orderStatus = input.value; render(); }
  if (input.dataset.orderFilter === 'payment') { orderPayment = input.value; render(); }
  if (input.dataset.orderFilter === 'sort') { orderSort = input.value; render(); }
  if (input.getAttribute('name') === 'taxEnabled') { const controls = document.querySelector<HTMLFieldSetElement>('.tax-controls'); if (controls) { controls.disabled = !(input as HTMLInputElement).checked; controls.classList.toggle('disabled', !(input as HTMLInputElement).checked); } }
  if (input.id === 'product-image-input' && (input as HTMLInputElement).files?.[0]) await prepareProductImage((input as HTMLInputElement).files![0]);
  if (input.id === 'backup-input' && (input as HTMLInputElement).files?.[0]) {
    try { await importBackup(JSON.parse(await (input as HTMLInputElement).files![0].text())); await refreshData(); render(); toast('backup restored'); } catch { toast('that backup file could not be restored'); }
  }
});

app.addEventListener('dragenter', (event) => {
  const picker = (event.target as Element).closest<HTMLElement>('.image-upload');
  if (!picker) return;
  event.preventDefault();
  picker.classList.add('dragging');
});

app.addEventListener('dragover', (event) => {
  const picker = (event.target as Element).closest<HTMLElement>('.image-upload');
  if (!picker) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  picker.classList.add('dragging');
});

app.addEventListener('dragleave', (event) => {
  const picker = (event.target as Element).closest<HTMLElement>('.image-upload');
  if (!picker || picker.contains(event.relatedTarget as Node | null)) return;
  picker.classList.remove('dragging');
});

app.addEventListener('drop', async (event) => {
  const picker = (event.target as Element).closest<HTMLElement>('.image-upload');
  if (!picker) return;
  event.preventDefault();
  picker.classList.remove('dragging');
  const file = event.dataTransfer?.files?.[0];
  if (file) await prepareProductImage(file);
});

app.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  const data = new FormData(form);
  if (form.id === 'sign-in-form') {
    const email = String(data.get('email') || '').trim().toLowerCase();
    const password = String(data.get('password') || '');
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (button) button.disabled = true;
    try { await signInWithPassword(email, password); }
    catch (error) { if (button) button.disabled = false; toast(error instanceof Error ? error.message.toLowerCase() : 'sign in failed'); }
    return;
  }
  if (form.id === 'invite-staff-form') {
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      await createStaffAccount(String(data.get('email') || ''), String(data.get('displayName') || ''), String(data.get('temporaryPassword') || ''));
      businessProfiles = await getBusinessProfiles();
      render(); toast('staff account created');
    } catch (error) { if (button) button.disabled = false; toast(error instanceof Error ? error.message.toLowerCase() : 'staff account could not be created'); }
    return;
  }
  if (form.id === 'change-password-form') {
    const password = String(data.get('password') || '');
    const confirmation = String(data.get('confirmPassword') || '');
    if (password.length < 8) { toast('password must be at least 8 characters'); return; }
    if (password !== confirmation) { toast('passwords do not match'); return; }
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (button) button.disabled = true;
    try { await changePassword(password); form.reset(); if (button) button.disabled = false; toast('password updated'); }
    catch (error) { if (button) button.disabled = false; toast(error instanceof Error ? error.message.toLowerCase() : 'password could not be updated'); }
    return;
  }
  if (form.id === 'discount-form') {
    discount = { type: data.get('type') as Discount['type'], value: Number(data.get('value')), label: String(data.get('label') || 'discount') };
    modal = ''; render(); return;
  }
  if (form.id === 'product-form') { await saveProduct(data); return; }
  if (form.id === 'modifier-form') { await saveModifier(data); return; }
  if (form.id === 'price-list-form') { await savePriceList(data); return; }
  if (form.id === 'business-settings') {
    settings.activePriceListId = String(data.get('activePriceListId'));
    settings.taxEnabled = data.get('taxEnabled') === 'on';
    if (settings.taxEnabled) { settings.taxName = String(data.get('taxName') || 'tax'); settings.taxRate = Number(data.get('taxRate')) || 0; settings.taxInclusive = data.get('taxInclusive') === 'true'; }
    await save('settings', settings); await refreshData(); render(); toast('settings saved'); return;
  }
  if (form.id === 'security-settings') { try { await updateManagerPin(String(data.get('managerPin'))); settings.managerPin = ''; render(); toast('manager pin updated'); } catch (error) { toast(error instanceof Error ? error.message.toLowerCase() : 'pin could not be updated'); } }
});

function addToCart() {
  if (!activeProduct) return;
  const selected = modifiers.filter((item) => selectedModifiers.has(item.id));
  const signature = `${activeProduct.id}:${selected.map((item) => item.id).sort().join(',')}`;
  const existing = cart.find((line) => line.id === signature);
  if (existing) existing.quantity += 1;
  else cart.push({ id: signature, product: clone(activeProduct), modifiers: clone(selected), unitPrice: currentPrice(activeProduct) + selected.reduce((sum, item) => sum + item.price, 0), quantity: 1 });
  modal = ''; render();
}

async function prepareProductImage(file: File) {
  const picker = document.querySelector<HTMLElement>('.image-upload');
  const hiddenInput = document.querySelector<HTMLInputElement>('#product-image-value');
  const preview = document.querySelector<HTMLImageElement>('.image-upload-preview');
  const placeholder = document.querySelector<HTMLElement>('.image-upload-placeholder');
  const title = document.querySelector<HTMLElement>('.image-upload-copy strong');
  if (!picker || !hiddenInput || !preview || !placeholder || !title) return;
  if (!file.type.startsWith('image/')) { toast('choose an image from photos'); return; }
  if (file.size > 30 * 1024 * 1024) { toast('that photo is too large'); return; }

  picker.classList.add('is-processing');
  title.textContent = 'preparing photo…';
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('image could not be opened'));
      element.src = objectUrl;
    });
    const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = Math.min(1, 1200 / longestSide);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('image could not be prepared');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let dataUrl = canvas.toDataURL('image/webp', 0.84);
    if (!dataUrl.startsWith('data:image/webp')) dataUrl = canvas.toDataURL('image/jpeg', 0.86);
    hiddenInput.value = dataUrl;
    preview.src = dataUrl;
    preview.hidden = false;
    placeholder.hidden = true;
    picker.classList.add('has-image');
    title.textContent = 'replace photo';
    toast('photo ready');
  } catch {
    title.textContent = hiddenInput.value ? 'replace photo' : 'choose a photo';
    toast('that photo could not be opened');
  } finally {
    URL.revokeObjectURL(objectUrl);
    picker.classList.remove('is-processing');
  }
}

async function completeSale() {
  if (!cart.length) return;
  const amount = totals();
  if (paymentMethod === 'cash' && Number(cashReceived) < amount.total) return;
  const selectedPriceList = activePriceList();
  const order: Order = { id: uid(), number: settings.nextOrderNumber, createdAt: new Date().toISOString(), status: 'completed', paymentMethod, priceListId: selectedPriceList?.id, priceListName: selectedPriceList?.name, customerName: customerName.trim(), note: orderNote.trim(), lines: clone(cart), subtotal: amount.subtotal, discount: amount.discount, discountLabel: discount?.label || '', tax: amount.tax, taxName: settings.taxEnabled ? settings.taxName : '', total: amount.total, createdBy: currentProfile?.id, createdByName: currentProfile?.displayName, ...(paymentMethod === 'cash' ? { cashReceived: Number(cashReceived) } : {}) };
  const savedOrder = await createOrder(order);
  latestOrder = savedOrder; cart = []; discount = null; customerName = ''; orderNote = ''; cashReceived = '';
  if (usingCloud() && navigator.onLine) await syncFromCloud();
  await refreshData(); modal = 'receipt'; render();
}

async function saveProduct(data: FormData) {
  const existing = products.find((item) => item.id === data.get('id'));
  const enteredPrice = Number(data.get('price'));
  const item: Product = { id: existing?.id || uid(), sku: String(data.get('sku')).trim(), name: String(data.get('name')).trim(), description: String(data.get('description')).trim(), category: String(data.get('category')).trim(), price: enteredPrice, standardPrice: existing?.standardPrice || enteredPrice, image: String(data.get('image') || '/assets/DT-LOGO-001.png'), modifierIds: data.getAll('modifierIds').map(String), soldOut: existing?.soldOut || false, archived: false, createdAt: existing?.createdAt || new Date().toISOString() };
  await save('products', item);
  for (const list of priceLists.filter((priceList) => !priceList.archived)) {
    if (list.id === settings.activePriceListId || list.prices[item.id] === undefined) list.prices[item.id] = enteredPrice;
    await save('priceLists', list);
  }
  await refreshData(); modal = ''; render(); toast(existing ? 'product updated' : 'product added');
}

async function savePriceList(data: FormData) {
  const existing = priceLists.find((item) => item.id === data.get('id'));
  const prices = Object.fromEntries(products.filter((item) => !item.archived).map((product) => [product.id, Number(data.get(`price:${product.id}`)) || 0]));
  const item: PriceList = { id: existing?.id || uid(), name: String(data.get('name')).trim(), prices, archived: false, createdAt: existing?.createdAt || new Date().toISOString() };
  await save('priceLists', item);
  if (data.get('activate') === 'on') { settings.activePriceListId = item.id; await save('settings', settings); }
  await refreshData(); modal = ''; catalogTab = 'prices'; view = 'catalog'; render(); toast(existing ? 'price list updated' : 'price list added');
}

async function usePriceList(id: string) { settings.activePriceListId = id; await save('settings', settings); await refreshData(); modal = ''; render(); toast(`${activePriceList()?.name} is now active`); }
async function duplicatePriceList(id: string) { const source = priceLists.find((item) => item.id === id); if (!source) return; const copy: PriceList = { ...clone(source), id: uid(), name: `${source.name} copy`, createdAt: new Date().toISOString() }; await save('priceLists', copy); await refreshData(); editingPriceList = priceLists.find((item) => item.id === copy.id)!; modal = 'price-list'; render(); }
async function archivePriceList(id: string) { const item = priceLists.find((list) => list.id === id); if (!item || item.id === settings.activePriceListId || priceLists.filter((list) => !list.archived).length < 2) return; item.archived = true; await save('priceLists', item); await refreshData(); render(); toast('price list removed'); }

async function saveModifier(data: FormData) {
  const existing = modifiers.find((item) => item.id === data.get('id'));
  const item: Modifier = { id: existing?.id || uid(), sku: String(data.get('sku')).trim(), name: String(data.get('name')).trim(), price: Number(data.get('price')), archived: false, createdAt: existing?.createdAt || new Date().toISOString() };
  await save('modifiers', item); await refreshData(); modal = ''; render(); toast(existing ? 'add-on updated' : 'add-on added');
}

async function archiveProduct() { if (!editingProduct) return; editingProduct.archived = true; await save('products', editingProduct); await refreshData(); modal = ''; render(); toast('product archived'); }
async function archiveModifier() { if (!editingModifier) return; editingModifier.archived = true; await save('modifiers', editingModifier); for (const product of products.filter((item) => item.modifierIds.includes(editingModifier!.id))) { product.modifierIds = product.modifierIds.filter((id) => id !== editingModifier!.id); await save('products', product); } await refreshData(); modal = ''; render(); toast('add-on archived'); }

async function changeOrderStatus(status: OrderStatus) {
  if (!activeOrder) return;
  const pin = document.querySelector<HTMLInputElement>('#order-pin')?.value;
  try {
    activeOrder = await persistOrderStatus(activeOrder.id, status, pin || '');
    if (usingCloud() && navigator.onLine) await syncFromCloud();
    await refreshData(); activeOrder = orders.find((item) => item.id === activeOrder!.id)!; render(); toast(`order ${status}`);
  } catch (error) { toast(error instanceof Error ? error.message.toLowerCase() : 'order could not be updated'); }
}

function exportCsv() {
  const rows = [['order number','date','status','customer','payment','items','subtotal','discount','tax','total'], ...orders.slice().sort((a,b) => a.number-b.number).map((order) => [order.number, order.createdAt, order.status, order.customerName, order.paymentMethod, order.lines.reduce((sum,line)=>sum+line.quantity,0), order.subtotal, order.discount, order.tax, order.total])];
  const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `doubletime-sales-${dateStamp()}.csv`);
  toast('csv exported');
}

async function exportExcel() {
  toast('building excel workbook…');
  const completed = orders.filter((order) => order.status === 'completed');
  const revenue = completed.reduce((sum, order) => sum + order.total, 0);
  const sorted = orders.slice().sort((a, b) => a.number - b.number);
  const summaryRows: (string | number)[][] = [['doubletime sales summary'], ['exported', new Date().toLocaleString('en-PH')], [], ['metric', 'value'], ['net sales', revenue], ['completed orders', completed.length], ['average order', completed.length ? revenue / completed.length : 0], ['discounts', completed.reduce((sum, order) => sum + order.discount, 0)], ['tax', completed.reduce((sum, order) => sum + order.tax, 0)]];
  const orderRows: (string | number)[][] = [['order', 'date', 'status', 'customer', 'payment', 'price list', 'subtotal', 'discount', 'tax', 'total'], ...sorted.map((order) => [order.number, new Date(order.createdAt).toLocaleString('en-PH'), order.status, order.customerName || 'walk-in', order.paymentMethod, order.priceListName || '', order.subtotal, order.discount, order.tax, order.total])];
  const itemRows: (string | number)[][] = [['order', 'sku', 'product', 'add-ons', 'quantity', 'unit price', 'line total']];
  sorted.forEach((order) => order.lines.forEach((line) => {
    const price = lineUnitPrice(line);
    itemRows.push([order.number, line.product.sku, line.product.name, line.modifiers.map((item) => item.name).join(', '), line.quantity, price, price * line.quantity]);
  }));
  const workbook = createXlsx([['summary', summaryRows], ['orders', orderRows], ['order items', itemRows]]);
  const workbookBytes = new Uint8Array(workbook.byteLength);
  workbookBytes.set(workbook);
  download(new Blob([workbookBytes.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `doubletime-sales-${dateStamp()}.xlsx`); toast('excel workbook exported');
}

function createXlsx(sheets: [string, (string | number)[][]][]) {
  const xml = (value: unknown) => String(value).replace(/[<>&'"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char]!);
  const column = (index: number) => { let name = ''; for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name; return name; };
  const sheetXml = (rows: (string | number)[][]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((cell, cellIndex) => typeof cell === 'number' ? `<c r="${column(cellIndex)}${rowIndex + 1}"${rowIndex === 0 ? ' s="1"' : ''}><v>${cell}</v></c>` : `<c r="${column(cellIndex)}${rowIndex + 1}" t="inlineStr"${rowIndex === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(cell)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(([name], index) => `<sheet name="${xml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E3B6A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`),
  };
  sheets.forEach(([, rows], index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheetXml(rows)); });
  return zipSync(files, { level: 6 });
}

async function downloadBackup() { const backup = await exportBackup(); download(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),`doubletime-backup-${dateStamp()}.json`); toast('backup downloaded'); }
function download(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
function dateStamp() { return new Date().toISOString().slice(0,10); }
function focusCash() { setTimeout(()=>document.querySelector<HTMLInputElement>('#cash-received')?.focus(),0); }
function toast(message: string) { const element = document.querySelector<HTMLElement>('#toast'); if (!element) return; element.textContent = message; element.classList.add('show'); setTimeout(()=>element.classList.remove('show'),2400); }

async function installApp() {
  if (deferredInstallPrompt && 'prompt' in deferredInstallPrompt) { await (deferredInstallPrompt as Event & { prompt: () => Promise<void> }).prompt(); deferredInstallPrompt = null; render(); }
  else toast('in safari, tap share then “add to home screen”');
}

async function refreshData() { [products, modifiers, priceLists, orders, settings] = await Promise.all([getProducts(), getModifiers(), getPriceLists(), getOrders(), getSettings()]); }

async function activateCloudSession() {
  const profile = await getCurrentProfile();
  if (!profile || !profile.active) throw new Error('this account does not have active doubletime access');
  currentProfile = profile;
  connectCloud(profile);
  if (navigator.onLine) await syncFromCloud();
  await refreshData();
  businessProfiles = profile.role === 'owner' && navigator.onLine ? await getBusinessProfiles() : [];
  stopBusinessWatcher?.();
  stopBusinessWatcher = watchBusinessChanges(async () => {
    try { await syncFromCloud(); await refreshData(); render(); } catch { /* keep the last good local copy */ }
  });
}

async function handleSignOut() {
  stopBusinessWatcher?.(); stopBusinessWatcher = null;
  try { await signOut(); } catch { /* the local session is cleared below */ }
  currentProfile = null; businessProfiles = []; connectCloud(null); modal = ''; view = 'sell'; signInSentTo = '';
  renderSignIn();
}

function startAuthWatcher() {
  if (authWatcherStarted || !isCloudConfigured) return;
  authWatcherStarted = true;
  watchAuth((event, session) => {
    if (event === 'SIGNED_OUT') { currentProfile = null; connectCloud(null); renderSignIn(); }
    if (event === 'SIGNED_IN' && session && !currentProfile) {
      setTimeout(async () => {
        try { await activateCloudSession(); render(); }
        catch (error) { app.innerHTML = `<div class="fatal-error"><h1>access unavailable</h1><p>${esc(error instanceof Error ? error.message : 'this account could not be loaded')}</p></div>`; }
      }, 0);
    }
  });
}

window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferredInstallPrompt = event; if (view === 'settings') render(); });
window.addEventListener('online', async () => { try { if (usingCloud()) { await flushOutbox(); await syncFromCloud(); await refreshData(); } render(); } catch { render(); } });
window.addEventListener('offline', render);
if ('serviceWorker' in navigator) window.addEventListener('load', () => {
  window.setTimeout(() => navigator.serviceWorker.register('/pos-sw.js', { scope: __POS_BASE__, updateViaCache: 'none' }).catch(() => undefined), 1200);
});

async function start() {
  app.innerHTML = `<div class="loading-screen">${brandMark()}<p>getting the good cups ready…</p></div>`;
  try {
    await initializeStore();
    if (isCloudConfigured) {
      const session = await getSession();
      if (!session) { renderSignIn(); startAuthWatcher(); return; }
      await activateCloudSession();
    } else {
      if (!localPreviewEnabled) { renderCloudSetup(); return; }
      await refreshData();
    }
    render(); startAuthWatcher();
  } catch (error) {
    console.error(error);
    app.innerHTML = `<div class="fatal-error"><h1>doubletime</h1><p>${esc(error instanceof Error ? error.message.toLowerCase() : 'the pos could not be opened. please reload the page.')}</p></div>`;
  }
}

start();
