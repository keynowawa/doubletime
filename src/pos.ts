import './pos.css';
import { strToU8, zipSync } from 'fflate';
import { Archive, Banknote, Bell, ChartNoAxesCombined, Check, ChevronDown, ChevronRight, CircleCheckBig, CirclePlus, Clock3, Cloud, Copy, CreditCard, Download, FileSpreadsheet, House, ImagePlus, KeyRound, Landmark, LayoutGrid, LogOut, Mail, Minus, Pencil, PhilippinePeso, Plus, QrCode, ReceiptText, Search, Settings as SettingsIcon, ShieldCheck, ShoppingCart, Smartphone, Trash2, UserRound, UsersRound, WifiOff, X, createIcons } from 'lucide';
import { changePassword, createTeamAccount, getBusinessProfiles, getCurrentProfile, getSession, isCloudConfigured, resetTeamMemberPassword, sendSignInLink, signInWithPassword, signOut, updateTeamMemberActive, updateTeamMemberRole, watchAuth, watchBusinessChanges } from './pos-auth';
import { OFFLINE_ACCESS_DAYS, adjustProductStock, cacheOfflineAccess, changeOrderStatus as persistOrderStatus, clearOfflineAccess, connectCloud, createOrder, exportBackup, getDeviceIdentity, getModifiers, getOfflineAccess, getOrderActionRequests, getOrders, getPendingSyncState, getPriceLists, getProducts, getSettings, importBackup, initializeStore, removeCatalogItem, requestOrderAction, reviewOrderAction, save, syncFromCloud, updateDeviceIdentity, updateManagerPin, usingCloud } from './pos-store';
import type { CartLine, DeviceIdentity, Discount, Modifier, Order, OrderAction, OrderActionRequest, OrderStatus, PaymentMethod, PosProfile, PriceList, Product, Settings, UserRole } from './pos-types';

type View = 'sell' | 'dashboard' | 'orders' | 'approvals' | 'catalog' | 'settings';
type Modal = '' | 'modifiers' | 'discount' | 'payment' | 'receipt' | 'product' | 'modifier' | 'order' | 'price-list' | 'price-picker' | 'account' | 'delete-archive' | 'team-password' | 'request-action' | 'review-request';
type ArchiveKind = 'product' | 'modifier' | 'priceList';
type ArchiveDeleteTarget = { kind: ArchiveKind; id: string; name: string };

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
let catalogTab: 'products' | 'addons' | 'prices' | 'archive' = 'products';
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
let deviceIdentity: DeviceIdentity;
let pendingSyncCount = 0;
let pendingOrderIds = new Set<string>();
let syncPhase: 'online' | 'offline' | 'syncing' = navigator.onLine ? 'online' : 'offline';
let sellCategory = '';
let archiveDeleteTarget: ArchiveDeleteTarget | null = null;
let teamPasswordTarget: PosProfile | null = null;
let orderActionRequests: OrderActionRequest[] = [];
let requestedOrderAction: OrderAction = 'refunded';
let reviewRequestTarget: OrderActionRequest | null = null;
let reviewDecision: 'approved' | 'declined' = 'approved';

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
const isPendingOrder = (order: Order) => pendingOrderIds.has(order.id);
const orderReference = (order: Order) => isPendingOrder(order) && order.localReceiptCode ? order.localReceiptCode : `#${String(order.number).padStart(3, '0')}`;
const nextOrderReference = () => !navigator.onLine && deviceIdentity ? `${deviceIdentity.prefix}-${String(deviceIdentity.nextLocalOrderNumber).padStart(3, '0')}` : `#${String(settings.nextOrderNumber).padStart(3, '0')}`;
const orderActionLabel = (action: OrderAction) => action === 'refunded' ? 'refund' : 'void';
const pendingApprovalCount = () => orderActionRequests.filter((request) => request.status === 'pending').length;
const requestsForOrder = (orderId: string) => orderActionRequests.filter((request) => request.orderId === orderId).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));

const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const clone = <T>(value: T): T => typeof globalThis.structuredClone === 'function'
  ? globalThis.structuredClone(value)
  : JSON.parse(JSON.stringify(value)) as T;
const esc = (value: unknown) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!);
const activePriceList = () => priceLists.find((item) => item.id === settings.activePriceListId && !item.archived) || priceLists.find((item) => !item.archived);
const priceListIncludes = (list: PriceList | undefined, product: Product) => !list?.productIds || list.productIds.includes(product.id);
const priceListProductCount = (list: PriceList) => products.filter((product) => !product.archived && priceListIncludes(list, product)).length;
const currentPrice = (product: Product) => activePriceList()?.prices[product.id] ?? product.price;
const productUnavailable = (product: Product) => product.soldOut || Boolean(product.trackStock && (product.stockQuantity || 0) <= 0);
const menuTaxMultiplier = () => settings.taxEnabled && settings.taxInclusive ? 1 + Math.max(0, settings.taxRate) / 100 : 1;
const menuAmount = (amount: number) => amount * menuTaxMultiplier();
const menuUnitPrice = (product: Product, selected: Modifier[]) => menuAmount(currentPrice(product) + selected.reduce((sum, item) => sum + item.price, 0));
const lineUnitPrice = (line: CartLine) => line.unitPrice ?? menuUnitPrice(line.product, line.modifiers);
const currencyRound = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;
const checkoutPriceTotal = () => cart.reduce((sum, line) => sum + lineUnitPrice(line) * line.quantity, 0);
const subtotal = () => currencyRound(checkoutPriceTotal() / menuTaxMultiplier());
const discountAmount = () => {
  if (!discount) return 0;
  return currencyRound(Math.min(subtotal(), discount.type === 'percent' ? subtotal() * discount.value / 100 : discount.value));
};
const totals = () => {
  const beforeTax = Math.max(0, subtotal() - discountAmount());
  const rate = settings.taxEnabled ? Math.max(0, settings.taxRate) / 100 : 0;
  const tax = currencyRound(beforeTax * rate);
  return { subtotal: subtotal(), discount: discountAmount(), tax, total: currencyRound(beforeTax + tax) };
};

function navItem(id: View, label: string, glyph: string) {
  return `<button class="nav-item ${view === id ? 'active' : ''}" data-view="${id}" aria-label="${label}"><i data-lucide="${glyph}"></i><small>${label}</small></button>`;
}

function brandMark() {
  return `<div class="brand-mark"><img src="/assets/DT-LOGO-001.png" alt="doubletime"></div>`;
}

function renderSyncBadge() {
  const state = !navigator.onLine ? 'offline' : syncPhase;
  const label = state === 'syncing' ? 'syncing' : state === 'offline' ? 'offline' : 'online';
  const detail = pendingSyncCount ? `${pendingSyncCount} pending` : '';
  const approvals = isOwner() && pendingApprovalCount() ? `<button class="global-approval-badge" data-action="open-approvals" aria-label="${pendingApprovalCount()} approval request${pendingApprovalCount() === 1 ? '' : 's'}"><i data-lucide="bell"></i><strong>${pendingApprovalCount()}</strong><span>approval${pendingApprovalCount() === 1 ? '' : 's'}</span></button>` : '';
  return `<div class="global-status-stack">${approvals}<div class="global-sync-badge ${state}" role="status" aria-label="${label}${detail ? `, ${detail}` : ''}"><i data-lucide="${state === 'offline' ? 'wifi-off' : 'cloud'}"></i><span>${label}</span>${detail ? `<small>${detail}</small>` : ''}</div></div>`;
}

function hydrateIcons() {
  createIcons({ icons: { Archive, Banknote, Bell, ChartNoAxesCombined, Check, ChevronDown, ChevronRight, CircleCheckBig, CirclePlus, Clock3, Cloud, Copy, CreditCard, Download, FileSpreadsheet, House, ImagePlus, KeyRound, Landmark, LayoutGrid, LogOut, Mail, Minus, Pencil, PhilippinePeso, Plus, QrCode, ReceiptText, Search, Settings: SettingsIcon, ShieldCheck, ShoppingCart, Smartphone, Trash2, UserRound, UsersRound, WifiOff, X }, attrs: { 'stroke-width': '1.8', 'aria-hidden': 'true' } });
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
  </div>${renderSyncBadge()}${renderModal()}<div class="toast" id="toast" role="status"></div>`;
  hydrateIcons();
}

function renderView() {
  if (view === 'dashboard') return renderDashboard();
  if (view === 'orders') return renderOrders();
  if (view === 'approvals') return renderApprovals();
  if (view === 'catalog') return renderCatalog();
  if (view === 'settings') return renderSettings();
  return renderSell();
}

function renderSell() {
  const list = activePriceList();
  const availableProducts = products.filter((product) => !product.archived && priceListIncludes(list, product));
  const categories = [...new Set(availableProducts.map((product) => product.category.trim().toLowerCase() || 'other'))].sort();
  if (!categories.includes(sellCategory)) sellCategory = categories[0] || '';
  const shownProducts = sellCategory ? availableProducts.filter((product) => (product.category.trim().toLowerCase() || 'other') === sellCategory) : availableProducts;
  const amount = totals();
  return `<div class="sell-layout">
    <section class="product-stage">
      <header class="page-header sell-header">
        <div><p class="eyebrow">take your time.</p><h1>what are we making?</h1><p>tap a drink, choose the extras, and keep the line moving.</p></div>
        <div class="header-badges">${isOwner() ? `<button class="price-switcher" data-action="open-price-picker"><span>${esc(activePriceList()?.name || 'pricing')}</span><i data-lucide="chevron-down"></i></button>` : `<span class="price-switcher read-only"><span>${esc(activePriceList()?.name || 'pricing')}</span></span>`}<span class="date-badge">${new Date().toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }).toLowerCase()}</span></div>
      </header>
      <div class="category-section"><div><span>categories</span><small>${shownProducts.filter((item) => !productUnavailable(item)).length} available</small></div><nav aria-label="product categories">${categories.map((category) => `<button class="${sellCategory === category ? 'active' : ''}" data-sell-category="${esc(category)}">${esc(category)}</button>`).join('')}</nav></div>
      <div class="product-grid">${shownProducts.map(renderProductCard).join('')}</div>
    </section>
    <aside class="cart-stage">
      <div class="cart-header"><div class="cart-title"><h2>current order</h2><span>${nextOrderReference()}</span></div>${cart.length ? '<button class="text-button light clear-order" data-action="clear-cart" aria-label="clear current order"><i data-lucide="trash-2"></i><span>clear</span></button>' : ''}</div>
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
  const price = menuAmount(currentPrice(product));
  const unavailable = productUnavailable(product);
  return `<button class="product-card ${unavailable ? 'sold-out' : ''}" data-product="${product.id}" ${unavailable ? 'disabled' : ''}>
    <div class="product-image"><img src="${esc(product.image)}" alt="" loading="lazy"><span class="add-dot"><i data-lucide="plus"></i></span>${unavailable ? '<em>unavailable</em>' : ''}</div>
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
    const matchesSearch = !query || String(order.number).includes(query) || order.localReceiptCode?.toLowerCase().includes(query) || order.customerName.toLowerCase().includes(query) || order.deviceName?.toLowerCase().includes(query) || paymentLabel(order.paymentMethod).includes(query);
    return matchesSearch && (!rangeStart || new Date(order.createdAt) >= rangeStart) && (orderStatus === 'all' || order.status === orderStatus) && (orderPayment === 'all' || order.paymentMethod === orderPayment);
  }).sort((a, b) => orderSort === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : orderSort === 'highest' ? b.total - a.total : orderSort === 'lowest' ? a.total - b.total : b.createdAt.localeCompare(a.createdAt));
  const today = new Date().toDateString();
  const todayOrders = orders.filter((order) => new Date(order.createdAt).toDateString() === today && order.status === 'completed');
  return `<div class="page orders-page">
    ${pageHeader('orders', 'all recorded orders, with today shown up top.', isOwner() ? `<div class="order-header-actions"><button class="secondary-button approvals-button ${pendingApprovalCount() ? 'has-pending' : ''}" data-action="open-approvals"><i data-lucide="shield-check"></i><span>approvals</span>${pendingApprovalCount() ? `<strong>${pendingApprovalCount()}</strong>` : ''}</button><button class="secondary-button" data-action="export-csv">export csv</button><button class="secondary-button dark" data-action="export-excel">export excel</button></div>` : '')}
    <div class="order-strip"><div class="sales-stat"><span>today's sales</span><strong>${money.format(todayOrders.reduce((sum, order) => sum + order.total, 0))}</strong></div><div class="orders-stat"><span>today's orders</span><strong>${todayOrders.length}</strong></div><div class="all-orders-stat"><span>all recorded</span><strong>${orders.length} orders</strong></div></div>
    <div class="orders-toolbar panel"><label class="search-box"><i data-lucide="search"></i><input data-field="order-search" value="${esc(orderSearch)}" placeholder="search order, customer, payment"></label><div class="table-filters"><label><span class="visually-hidden">date range</span><select data-order-filter="range"><option value="all" ${orderRange === 'all' ? 'selected' : ''}>all time</option><option value="today" ${orderRange === 'today' ? 'selected' : ''}>today</option><option value="7days" ${orderRange === '7days' ? 'selected' : ''}>last 7 days</option><option value="30days" ${orderRange === '30days' ? 'selected' : ''}>last 30 days</option></select></label><label><span class="visually-hidden">status</span><select data-order-filter="status"><option value="all" ${orderStatus === 'all' ? 'selected' : ''}>all statuses</option><option value="completed" ${orderStatus === 'completed' ? 'selected' : ''}>completed</option><option value="refunded" ${orderStatus === 'refunded' ? 'selected' : ''}>refunded</option><option value="voided" ${orderStatus === 'voided' ? 'selected' : ''}>voided</option></select></label><label><span class="visually-hidden">payment</span><select data-order-filter="payment"><option value="all" ${orderPayment === 'all' ? 'selected' : ''}>all payments</option>${paymentMethods.map((method) => `<option value="${method.id}" ${orderPayment === method.id ? 'selected' : ''}>${method.label}</option>`).join('')}</select></label><label><span class="visually-hidden">sort orders</span><select data-order-filter="sort"><option value="newest" ${orderSort === 'newest' ? 'selected' : ''}>newest first</option><option value="oldest" ${orderSort === 'oldest' ? 'selected' : ''}>oldest first</option><option value="highest" ${orderSort === 'highest' ? 'selected' : ''}>highest total</option><option value="lowest" ${orderSort === 'lowest' ? 'selected' : ''}>lowest total</option></select></label></div></div>
    <section class="order-table panel"><div class="table-head"><span>order</span><span>time</span><span>items</span><span>payment</span><span>status</span><span>total</span></div>
      ${matches.length ? matches.map((order) => `<button class="table-row" data-order="${order.id}"><span><strong>${orderReference(order)}</strong><small>${esc(order.customerName || 'walk-in')}${isPendingOrder(order) ? ' · waiting to sync' : ''}</small></span><span>${shortDate.format(new Date(order.createdAt)).toLowerCase()} · ${time.format(new Date(order.createdAt)).toLowerCase()}</span><span>${order.lines.reduce((sum, line) => sum + line.quantity, 0)}</span><span>${paymentLabel(order.paymentMethod)}</span><span><i class="status-pill ${isPendingOrder(order) ? 'pending' : order.status}">${isPendingOrder(order) ? 'pending' : order.status}</i></span><span><strong>${money.format(order.total)}</strong><i data-lucide="chevron-right"></i></span></button>`).join('') : emptyTable(query || orderRange !== 'all' || orderStatus !== 'all' || orderPayment !== 'all' ? 'no orders match these filters.' : 'completed orders will appear here.')}
    </section>
  </div>`;
}

function renderApprovalCard(request: OrderActionRequest, actionable: boolean) {
  const order = orders.find((item) => item.id === request.orderId);
  const reference = order ? orderReference(order) : 'order';
  const reviewed = request.reviewedAt ? `${shortDate.format(new Date(request.reviewedAt)).toLowerCase()} · ${time.format(new Date(request.reviewedAt)).toLowerCase()}` : '';
  return `<article class="approval-card panel ${request.status}">
    <div class="approval-icon"><i data-lucide="${request.action === 'refunded' ? 'receipt-text' : 'x'}"></i></div>
    <div class="approval-main"><div class="approval-heading"><span class="approval-action">${orderActionLabel(request.action)} request</span><span class="status-pill ${request.status}">${request.status}</span></div><h3>${esc(reference)}${order ? ` · ${money.format(order.total)}` : ''}</h3><p>${esc(request.reason)}</p><small>requested by ${esc(request.requestedByName)} · ${shortDate.format(new Date(request.requestedAt)).toLowerCase()} · ${time.format(new Date(request.requestedAt)).toLowerCase()}</small>${request.reviewedByName ? `<small>${request.status} by ${esc(request.reviewedByName)}${reviewed ? ` · ${reviewed}` : ''}${request.reviewNote ? ` · ${esc(request.reviewNote)}` : ''}</small>` : ''}</div>
    ${actionable ? `<div class="approval-actions"><button class="secondary-button" data-review-request="${request.id}" data-review-decision="declined">decline</button><button class="primary-small" data-review-request="${request.id}" data-review-decision="approved"><i data-lucide="check"></i><span>review & approve</span></button></div>` : ''}
  </article>`;
}

function renderApprovals() {
  const pending = orderActionRequests.filter((request) => request.status === 'pending');
  const history = orderActionRequests.filter((request) => request.status !== 'pending');
  return `<div class="page approvals-page">
    ${pageHeader('approvals', 'refund and void requests from your team.', '<button class="secondary-button" data-view="orders"><i data-lucide="chevron-right"></i><span>back to orders</span></button>')}
    <section class="approval-section"><div class="approval-section-head"><div><h2>waiting for you</h2><p>review the order and reason before deciding.</p></div><span>${pending.length}</span></div>${pending.length ? `<div class="approval-list">${pending.map((request) => renderApprovalCard(request, true)).join('')}</div>` : emptyPanel('no requests need approval.', 'shield-check')}</section>
    <section class="approval-section history"><div class="approval-section-head"><div><h2>request history</h2><p>approved and declined requests stay here for accountability.</p></div><span>${history.length}</span></div>${history.length ? `<div class="approval-list">${history.map((request) => renderApprovalCard(request, false)).join('')}</div>` : emptyPanel('reviewed requests will appear here.', 'clock-3')}</section>
  </div>`;
}

function renderCatalog() {
  const activeProducts = products.filter((item) => !item.archived);
  const activeModifiers = modifiers.filter((item) => !item.archived);
  const availablePriceLists = priceLists.filter((item) => !item.archived);
  const archivedProducts = products.filter((item) => item.archived);
  const archivedModifiers = modifiers.filter((item) => item.archived);
  const archivedPriceLists = priceLists.filter((item) => item.archived);
  const archivedCount = archivedProducts.length + archivedModifiers.length + archivedPriceLists.length;
  const action = catalogTab === 'products' ? '<button class="primary-small add-action" data-action="new-product"><i data-lucide="circle-plus"></i><span>add product</span></button>' : catalogTab === 'addons' ? '<button class="primary-small add-action" data-action="new-modifier"><i data-lucide="circle-plus"></i><span>add add-on</span></button>' : catalogTab === 'prices' ? '<button class="primary-small add-action" data-action="new-price-list"><i data-lucide="circle-plus"></i><span>add price list</span></button>' : '';
  const archiveActions = (kind: ArchiveKind, id: string, restoreAttribute: string) => `<div class="archive-actions"><button ${restoreAttribute}="${esc(id)}"><i data-lucide="check"></i><span>restore</span></button><button class="archive-delete" data-delete-archive="${esc(id)}" data-archive-kind="${kind}" aria-label="permanently delete"><i data-lucide="trash-2"></i><span>delete</span></button></div>`;
  const archiveRows = [
    ...archivedProducts.map((item) => `<article class="archive-row"><span class="archive-kind"><i data-lucide="archive"></i></span><div><small>product · ${esc(item.sku)}</small><strong>${esc(item.name)}</strong></div>${archiveActions('product', item.id, 'data-restore-product')}</article>`),
    ...archivedModifiers.map((item) => `<article class="archive-row"><span class="archive-kind"><i data-lucide="archive"></i></span><div><small>add-on · ${esc(item.sku)}</small><strong>${esc(item.name)}</strong></div>${archiveActions('modifier', item.id, 'data-restore-modifier')}</article>`),
    ...archivedPriceLists.map((item) => `<article class="archive-row"><span class="archive-kind"><i data-lucide="archive"></i></span><div><small>price list</small><strong>${esc(item.name)}</strong></div>${archiveActions('priceList', item.id, 'data-restore-price-list')}</article>`),
  ].join('');
  return `<div class="page catalog-page">
    ${pageHeader('menu', 'drinks, add-ons, and pricing in one quiet place.', action)}
    <div class="tabs"><button class="${catalogTab === 'products' ? 'active' : ''}" data-catalog-tab="products">products <span>${activeProducts.length}</span></button><button class="${catalogTab === 'addons' ? 'active' : ''}" data-catalog-tab="addons">add-ons <span>${activeModifiers.length}</span></button><button class="${catalogTab === 'prices' ? 'active' : ''}" data-catalog-tab="prices">price lists <span>${availablePriceLists.length}</span></button><button class="${catalogTab === 'archive' ? 'active' : ''}" data-catalog-tab="archive">archive <span>${archivedCount}</span></button></div>
    ${catalogTab === 'products' ? `<div class="catalog-list">${activeProducts.map((product) => { const unavailable = productUnavailable(product); return `<article class="catalog-row product-admin-row ${unavailable ? 'is-sold' : ''}"><div class="catalog-thumb"><img src="${esc(product.image)}" alt=""></div><div class="catalog-name"><small>${esc(product.sku)}</small><strong>${esc(product.name)}</strong><span>${esc(product.description)}</span></div><div class="catalog-price"><small>${esc(activePriceList()?.name || 'active price')}</small><strong>${money.format(currentPrice(product))}</strong></div><div class="inventory-cell">${product.trackStock ? `<small>stock on hand</small><div class="stock-stepper"><button data-stock-adjust="${product.id}" data-delta="-1" aria-label="remove one from ${esc(product.name)} stock"><i data-lucide="minus"></i></button><strong>${product.stockQuantity || 0}</strong><button data-stock-adjust="${product.id}" data-delta="1" aria-label="add one to ${esc(product.name)} stock"><i data-lucide="plus"></i></button></div>` : '<small>stock</small><strong>not tracked</strong>'}</div><button class="stock-toggle ${unavailable ? 'sold' : ''}" data-availability="${product.id}"><i data-lucide="${unavailable ? 'x' : 'check'}"></i><span>${unavailable ? 'unavailable' : 'available'}</span></button><button class="row-menu" data-edit-product="${product.id}"><i data-lucide="pencil"></i><span>edit</span></button></article>`; }).join('')}</div>` : catalogTab === 'addons' ? `<div class="catalog-list">${activeModifiers.map((item) => `<article class="catalog-row addon-row"><div class="addon-mark"><i data-lucide="circle-plus"></i></div><div class="catalog-name"><small>${esc(item.sku)}</small><strong>${esc(item.name)}</strong><span>available on ${products.filter((product) => !product.archived && product.modifierIds.includes(item.id)).length} product(s)</span></div><div class="catalog-price"><small>price</small><strong>${money.format(item.price)}</strong></div><button class="row-menu" data-edit-modifier="${item.id}"><i data-lucide="pencil"></i><span>edit</span></button></article>`).join('')}</div>` : catalogTab === 'prices' ? `<div class="price-list-grid">${availablePriceLists.map((list) => renderPriceListCard(list)).join('')}</div>` : `<section class="archive-panel"><div class="archive-explainer"><i data-lucide="archive"></i><div><strong>archive keeps items recoverable</strong><small>restore anytime, or permanently delete an item you are certain you no longer need. past orders stay unchanged.</small></div></div>${archiveRows || emptyPanel('nothing is archived.', 'archive')}</section>`}
  </div>`;
}

function renderSettings() {
  const availablePriceLists = priceLists.filter((item) => !item.archived);
  const teamRows = businessProfiles.map((profile) => `<div class="${profile.active ? '' : 'inactive'}"><span class="team-avatar">${esc((profile.displayName || profile.email).slice(0, 1).toLowerCase())}</span><span><strong>${esc(profile.displayName || profile.email)}</strong><small>${esc(profile.email)}${profile.id === currentProfile?.id ? ' · you' : ''} · ${profile.active ? 'active' : 'access revoked'}</small></span><label class="team-role-control"><span class="visually-hidden">account type</span><select data-team-role="${profile.id}" ${profile.id === currentProfile?.id || !navigator.onLine ? 'disabled' : ''}><option value="staff" ${profile.role === 'staff' ? 'selected' : ''}>staff</option><option value="owner" ${profile.role === 'owner' ? 'selected' : ''}>owner</option></select></label>${profile.id === currentProfile?.id ? '' : `<div class="team-account-actions"><button type="button" data-team-password="${profile.id}" ${navigator.onLine ? '' : 'disabled'}><i data-lucide="key-round"></i><span>reset password</span></button><button type="button" class="${profile.active ? 'revoke' : 'restore'}" data-team-active="${profile.id}" data-active="${profile.active ? 'false' : 'true'}" ${navigator.onLine ? '' : 'disabled'}><i data-lucide="${profile.active ? 'x' : 'check'}"></i><span>${profile.active ? 'revoke access' : 'restore access'}</span></button></div>`}</div>`).join('');
  const teamCard = isCloudConfigured && currentProfile?.role === 'owner' ? `<section class="settings-card panel team-card"><div class="settings-title"><span><i data-lucide="users-round"></i></span><div><h2>team access</h2><p>create accounts, reset passwords, and revoke access.</p></div></div><form id="invite-staff-form"><div class="team-create-fields"><label><span>name</span><input name="displayName" autocomplete="name" placeholder="e.g. sam" required></label><label><span>email</span><input name="email" type="email" autocomplete="email" placeholder="name@example.com" required></label><label><span>account type</span><select name="role"><option value="staff">staff · sell and view orders</option><option value="owner">owner · full access</option></select></label><label><span>temporary password</span><input name="temporaryPassword" type="password" autocomplete="new-password" autocapitalize="none" minlength="8" placeholder="at least 8 characters" required></label></div><p class="team-helper">give each person their own account. revoked accounts keep their order history but cannot sign in.</p><button class="secondary-button wide invite-button" type="submit" ${navigator.onLine ? '' : 'disabled'}><i data-lucide="key-round"></i><span>${navigator.onLine ? 'create account' : 'internet required to create accounts'}</span></button></form><div class="team-list">${teamRows || '<p>your team will appear here.</p>'}</div></section>` : '';
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
      <form class="settings-card panel" id="security-settings"><div class="settings-title"><span><i data-lucide="settings"></i></span><div><h2>manager pin</h2><p>emergency offline approval only.</p></div></div><label><span>4–8 digit pin</span><input name="managerPin" inputmode="numeric" pattern="[0-9]{4,8}" value="${esc(settings.managerPin)}" placeholder="enter a new 4–8 digit pin" required></label><p class="pin-readiness ${settings.offlinePinVerifier ? 'ready' : ''}"><i data-lucide="${settings.offlinePinVerifier ? 'check' : 'wifi-off'}"></i><span>${settings.offlinePinVerifier ? 'offline fallback is ready on synced ipads' : 'save your current pin once to enable offline fallback'}</span></p><button class="secondary-button wide" type="submit">update pin</button></form>
      ${teamCard}
    </div>
  </div>`;
}

function pageHeader(title: string, description: string, actions: string) {
  return `<header class="page-header"><div><p class="eyebrow">take your time.</p><h1>${title}</h1><p>${description}</p></div>${actions}</header>`;
}

function renderPriceListCard(list: PriceList) {
  const isActive = list.id === settings.activePriceListId;
  return `<article class="price-list-card ${isActive ? 'active' : ''}"><div class="price-list-icon"><i data-lucide="philippine-peso"></i></div><div><small>${isActive ? 'active now' : 'price list'}</small><h3>${esc(list.name)}</h3><p>${priceListProductCount(list)} products included</p></div><div class="price-list-actions">${isActive ? '<span class="active-check"><i data-lucide="check"></i> in use</span>' : `<button class="activate-price" data-use-price-list="${list.id}" aria-label="activate ${esc(list.name)}" title="activate price list"><i data-lucide="circle-check-big"></i></button>`}<button data-edit-price-list="${list.id}" aria-label="edit ${esc(list.name)}"><i data-lucide="pencil"></i></button><button data-duplicate-price-list="${list.id}" aria-label="duplicate ${esc(list.name)}"><i data-lucide="copy"></i></button>${!isActive && priceLists.filter((item) => !item.archived).length > 1 ? `<button class="danger-icon" data-archive-price-list="${list.id}" aria-label="archive ${esc(list.name)}"><i data-lucide="archive"></i></button>` : ''}</div></article>`;
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
  const state = !navigator.onLine ? 'offline' : syncPhase;
  const cloudCopy = usingCloud() ? state === 'offline' ? `offline access active · ${pendingSyncCount ? `${pendingSyncCount} waiting to sync` : 'saved data is ready'}` : state === 'syncing' ? 'syncing changes with your other devices' : pendingSyncCount ? `${pendingSyncCount} changes waiting to sync` : 'up to date across your authorized devices' : 'local preview only · not shared with other devices';
  const access = currentProfile ? `<section class="account-password"><div><strong>account password</strong><small>set or change the password used on your devices.</small></div><form id="change-password-form"><label><span>new password</span><input name="password" type="password" autocomplete="new-password" minlength="8" placeholder="at least 8 characters" required></label><label><span>confirm password</span><input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" placeholder="type it again" required></label><button class="secondary-button wide" type="submit"><i data-lucide="key-round"></i><span>save password</span></button></form></section><button class="danger-button account-signout" data-action="sign-out"><i data-lucide="log-out"></i><span>sign out on this ipad</span></button>` : '<p class="local-account-note">add the Supabase project details to enable owner and staff sign-in.</p>';
  const device = deviceIdentity ? `<section class="device-account"><div><strong>this ipad</strong><small>offline receipts use ${esc(deviceIdentity.prefix)}-001, ${esc(deviceIdentity.prefix)}-002, and so on.</small></div><form id="device-settings-form"><label><span>device name</span><input name="deviceName" value="${esc(deviceIdentity.name)}" maxlength="30" placeholder="e.g. popup ipad" required></label><label><span>receipt prefix</span><input name="devicePrefix" value="${esc(deviceIdentity.prefix)}" maxlength="3" pattern="[A-Za-z0-9]{1,3}" placeholder="e.g. A" required></label><button class="secondary-button wide" type="submit">save ipad details</button></form></section>` : '';
  return `<div class="modal-layer"><section class="modal-card compact account-card">${modalHead('account', 'the person and ipad currently in use.')}<div class="account-profile"><span>${profileInitials()}</span><div><strong>${esc(currentProfile?.displayName || 'local preview')}</strong><small>${esc(currentProfile?.email || 'supabase is not connected yet')}</small></div><em>${currentProfile?.role || 'local'}</em></div><div class="sync-note ${state} ${usingCloud() ? '' : 'local'}"><i data-lucide="${state === 'offline' ? 'wifi-off' : 'cloud'}"></i><span>${cloudCopy}</span></div>${device}${access}</section></div>`;
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
  if (modal === 'delete-archive' && archiveDeleteTarget) return renderArchiveDeleteModal();
  if (modal === 'team-password' && teamPasswordTarget) return renderTeamPasswordModal();
  if (modal === 'request-action' && activeOrder) return renderRequestActionModal();
  if (modal === 'review-request' && reviewRequestTarget) return renderReviewRequestModal();
  return '';
}

function modalHead(title: string, note: string) { return `<div class="modal-head"><div><p class="eyebrow">doubletime</p><h2>${title}</h2><p>${note}</p></div><button class="modal-close" type="button" data-action="close-modal" aria-label="close"><i data-lucide="x"></i></button></div>`; }

function renderModifierModal() {
  const available = modifiers.filter((item) => !item.archived && activeProduct!.modifierIds.includes(item.id));
  const extra = available.filter((item) => selectedModifiers.has(item.id)).reduce((sum, item) => sum + item.price, 0);
  return `<div class="modal-layer"><section class="modal-card compact">${modalHead(activeProduct!.name, 'make it yours. add-ons are optional.')}
    <div class="selected-product"><div><img src="${esc(activeProduct!.image)}" alt=""></div><span>${esc(activeProduct!.description)}</span><strong>${money.format(menuAmount(currentPrice(activeProduct!)))}</strong></div>
    <div class="field-heading"><span>add-ons</span><small>choose any</small></div>
    ${available.length ? `<div class="modifier-grid">${available.map((item) => `<button class="modifier-option ${selectedModifiers.has(item.id) ? 'selected' : ''}" data-modifier="${item.id}"><span>${esc(item.name)}</span><strong>+${money.format(menuAmount(item.price))}</strong><i>✓</i></button>`).join('')}</div>` : '<div class="simple-empty">no add-ons are set for this drink.</div>'}
    <button class="modal-primary" data-action="add-to-cart"><span>add to order</span><strong>${money.format(menuAmount(currentPrice(activeProduct!) + extra))}</strong></button>
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
  return `<div class="modal-layer"><section class="modal-card payment-card">${modalHead('payment', `order ${nextOrderReference()} · ${money.format(amount.total)}`)}
    <div class="payment-options">${paymentMethods.map((method) => `<button class="payment-option ${paymentMethod === method.id ? 'selected' : ''}" data-payment="${method.id}" aria-pressed="${paymentMethod === method.id}"><i><span data-lucide="${method.icon}"></span></i><span>${method.label}</span><small>${method.note}</small></button>`).join('')}</div>
    <div id="payment-details">${renderPaymentDetails()}</div>
  </section></div>`;
}

function renderPaymentDetails() {
  const amount = totals();
  const received = Number(cashReceived) || 0;
  const change = Math.max(0, received - amount.total);
  return `${paymentMethod === 'cash' ? `<div class="cash-section"><label><span>cash received</span><div class="money-input"><b>₱</b><input id="cash-received" inputmode="decimal" value="${esc(cashReceived)}" placeholder="0.00"></div></label><div class="quick-cash">${quickCash(amount.total).map((value) => `<button data-cash="${value}">${money.format(value)}</button>`).join('')}</div><div class="change-row"><span>change</span><strong id="change-value">${money.format(change)}</strong></div></div>` : `<div class="payment-note">confirm the ${paymentLabel(paymentMethod)} payment before completing the sale.</div>`}<button class="modal-primary" data-action="complete-sale" ${paymentMethod === 'cash' && received < amount.total ? 'disabled' : ''}><span>complete sale</span><strong>${money.format(amount.total)}</strong></button>`;
}

function updatePaymentModal() {
  document.querySelectorAll<HTMLButtonElement>('[data-payment]').forEach((button) => {
    const selected = button.dataset.payment === paymentMethod;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  const details = document.querySelector<HTMLElement>('#payment-details');
  if (details) details.innerHTML = renderPaymentDetails();
}

function quickCash(total: number) { return [...new Set([Math.ceil(total / 50) * 50, Math.ceil(total / 100) * 100, 500, 1000])].filter((value) => value >= total).slice(0, 4); }

function renderReceiptModal(order: Order) {
  const change = order.cashReceived ? order.cashReceived - order.total : 0;
  return `<div class="modal-layer receipt-layer"><section class="modal-card receipt-card"><button class="modal-close receipt-close" data-action="new-order" aria-label="close receipt"><i data-lucide="x"></i></button>${brandMark()}<p>the sip you deserve.</p><div class="receipt-number">order ${orderReference(order)}</div>${isPendingOrder(order) ? '<div class="receipt-sync-note"><i data-lucide="wifi-off"></i><span>saved on this ipad · waiting to sync</span></div>' : ''}<div class="receipt-lines">${order.lines.map((line) => `<div><span>${line.quantity}× ${esc(line.product.name)}<small>${line.modifiers.map((item) => esc(item.name)).join(', ')}</small></span><strong>${money.format(lineUnitPrice(line) * line.quantity)}</strong></div>`).join('')}</div><div class="receipt-totals"><div><span>paid via ${paymentLabel(order.paymentMethod)}</span><strong>${money.format(order.total)}</strong></div>${order.paymentMethod === 'cash' ? `<div><span>change</span><strong>${money.format(change)}</strong></div>` : ''}</div><small class="receipt-time">${new Date(order.createdAt).toLocaleString('en-PH').toLowerCase()} · ${esc(order.deviceName || deviceIdentity.name)}</small><button class="modal-primary" data-action="new-order">start a new order</button></section></div>`;
}

function renderProductModal() {
  const item = editingProduct;
  const image = item?.image || '';
  return `<div class="modal-layer"><form class="modal-card editor-card" id="product-form">${modalHead(item ? 'edit product' : 'add product', 'changes only affect the pos menu.')}
    <input type="hidden" name="id" value="${esc(item?.id || '')}"><div class="two-fields"><label><span>product name</span><input name="name" value="${esc(item?.name || '')}" placeholder="e.g. strawberry cloud" required></label><label class="sku-field"><span>sku</span><input id="product-sku" name="sku" value="${esc(item?.sku || 'DT-')}" placeholder="e.g. DT-MAT-NEW" autocapitalize="characters" autocomplete="off" spellcheck="false" required><span class="sku-suggestions"><small>quick start</small><button type="button" data-sku-prefix="DT-MAT-" data-sku-target="product-sku">matcha</button><button type="button" data-sku-prefix="DT-COF-" data-sku-target="product-sku">coffee</button><button type="button" data-sku-prefix="DT-PAS-" data-sku-target="product-sku">pastry</button><button type="button" data-sku-prefix="DT-OTH-" data-sku-target="product-sku">other</button></span></label></div>
    <label><span>short description</span><input name="description" value="${esc(item?.description || '')}" placeholder="e.g. matcha with strawberry cream" required></label>
    <div class="two-fields"><label><span>category</span><input name="category" value="${esc(item?.category || 'matcha')}" placeholder="e.g. matcha" required></label><label><span>price</span><input name="price" type="number" min="0" step="1" value="${item ? currentPrice(item) : ''}" placeholder="0" required></label></div>
    <div class="inventory-editor"><div class="two-fields"><label><span>availability</span><select name="availability"><option value="available" ${!item?.soldOut ? 'selected' : ''}>available</option><option value="unavailable" ${item?.soldOut ? 'selected' : ''}>unavailable</option></select></label><label><span>stock tracking</span><select name="trackStock" data-stock-tracking><option value="false" ${!item?.trackStock ? 'selected' : ''}>do not track</option><option value="true" ${item?.trackStock ? 'selected' : ''}>track stock</option></select></label></div><label class="stock-quantity-field ${item?.trackStock ? '' : 'disabled'}"><span>stock on hand</span><input name="stockQuantity" type="number" min="0" step="1" value="${item?.stockQuantity ?? 0}" placeholder="0" ${item?.trackStock ? '' : 'disabled'}></label></div>
    <div class="product-image-field"><span class="product-image-label">product image</span><label class="image-upload" for="product-image-input">
      <input class="image-file-input" id="product-image-input" type="file" accept="image/*">
      <input id="product-image-value" type="hidden" name="image" value="${esc(image)}">
      <img class="image-upload-preview" src="" alt="new product preview" hidden>
      <span class="image-upload-placeholder"><i data-lucide="image-plus"></i></span>
      <span class="image-upload-copy"><strong>${image ? 'replace photo' : 'choose a photo'}</strong><small>tap to open photos, or drag an image here</small></span>
    </label></div>
    <div class="field-heading"><span>available add-ons</span><small>shown when this product is tapped</small></div><div class="checkbox-grid">${modifiers.filter((modifier) => !modifier.archived).map((modifier) => `<label><input type="checkbox" name="modifierIds" value="${modifier.id}" ${item?.modifierIds.includes(modifier.id) ? 'checked' : ''}><i>✓</i><span>${esc(modifier.name)}</span></label>`).join('')}</div>
    <div class="modal-split">${item ? '<button type="button" class="danger-button" data-action="archive-product"><i data-lucide="archive"></i><span>archive product</span></button>' : '<span></span>'}<button class="modal-primary fit" type="button" data-editor-save="product">save product</button></div>
  </form></div>`;
}

function renderAddonModal() {
  const item = editingModifier;
  return `<div class="modal-layer"><form class="modal-card compact" id="modifier-form">${modalHead(item ? 'edit add-on' : 'add an add-on', 'keep extras simple and quick to tap.')}<input type="hidden" name="id" value="${esc(item?.id || '')}"><label><span>add-on name</span><input name="name" value="${esc(item?.name || '')}" placeholder="e.g. oat milk" required></label><div class="two-fields"><label class="sku-field"><span>sku</span><input id="modifier-sku" name="sku" value="${esc(item?.sku || 'DT-ADD-')}" placeholder="e.g. DT-ADD-OAT" autocapitalize="characters" autocomplete="off" spellcheck="false" required><span class="sku-suggestions"><small>quick start</small><button type="button" data-sku-prefix="DT-ADD-" data-sku-target="modifier-sku">DT-ADD-</button></span></label><label><span>price</span><input name="price" type="number" min="0" step="1" value="${item?.price ?? ''}" placeholder="0" required></label></div><div class="modal-split">${item ? '<button type="button" class="danger-button" data-action="archive-modifier"><i data-lucide="archive"></i><span>archive add-on</span></button>' : '<span></span>'}<button class="modal-primary fit" type="button" data-editor-save="modifier">save add-on</button></div></form></div>`;
}

function renderPricePickerModal() {
  const available = priceLists.filter((item) => !item.archived);
  return `<div class="modal-layer"><section class="modal-card compact">${modalHead('choose pricing', 'switch the whole menu in one tap.')}<div class="price-picker-list">${available.map((list) => `<button class="price-picker-option ${list.id === settings.activePriceListId ? 'selected' : ''}" data-use-price-list="${list.id}"><span><i data-lucide="philippine-peso"></i></span><div><strong>${esc(list.name)}</strong><small>${priceListProductCount(list)} products</small></div>${list.id === settings.activePriceListId ? '<i data-lucide="check"></i>' : ''}</button>`).join('')}</div><button class="subtle-link centered" data-action="manage-price-lists">manage price lists</button></section></div>`;
}

function renderPriceListModal() {
  const source = editingPriceList || activePriceList();
  const availableProducts = products.filter((item) => !item.archived);
  return `<div class="modal-layer"><form class="modal-card price-editor" id="price-list-form">${modalHead(editingPriceList ? 'edit price list' : 'new price list', 'choose exactly what appears on this menu.')}<input type="hidden" name="id" value="${esc(editingPriceList?.id || '')}"><label><span>price list name</span><input name="name" value="${esc(editingPriceList?.name || '')}" placeholder="e.g. porsche & pilates" required autofocus></label><div class="field-heading"><span>menu items</span><small>turn off anything you do not want to sell on this price list</small></div><div class="price-editor-list">${availableProducts.map((product) => { const included = !source || priceListIncludes(source, product); return `<div class="price-editor-row ${included ? '' : 'excluded'}"><label class="price-include"><input name="includedProductIds" type="checkbox" value="${product.id}" ${included ? 'checked' : ''}><i>✓</i><span class="price-product"><img src="${esc(product.image)}" alt=""><span><strong>${esc(product.name)}</strong><small>${esc(product.sku)}</small></span></span></label><label class="price-input"><b>₱</b><input name="price:${product.id}" type="number" min="0" step="1" value="${source?.prices[product.id] ?? product.price}" placeholder="0" required></label></div>`; }).join('')}</div><label class="switch-row activate-list"><span><strong>use after saving</strong><small>switch the selling screen to this list</small></span><input type="checkbox" name="activate" ${!editingPriceList ? 'checked' : ''}><i></i></label><button class="modal-primary" type="button" data-editor-save="price-list"><span>save price list</span><i data-lucide="check"></i></button></form></div>`;
}

function renderArchiveDeleteModal() {
  const target = archiveDeleteTarget!;
  const kind = target.kind === 'priceList' ? 'price list' : target.kind === 'modifier' ? 'add-on' : 'product';
  return `<div class="modal-layer"><section class="modal-card compact delete-confirmation">${modalHead(`delete ${kind}?`, 'this cannot be undone.')}<div class="delete-confirmation-icon"><i data-lucide="trash-2"></i></div><h3>${esc(target.name)}</h3><p>this ${kind} will be permanently removed from the current system. completed orders that used it will stay in your sales history.</p><div class="modal-split"><button class="secondary-button" data-action="close-modal">keep archived</button><button class="danger-button solid" data-action="confirm-archive-delete"><i data-lucide="trash-2"></i><span>delete permanently</span></button></div></section></div>`;
}

function renderTeamPasswordModal() {
  const profile = teamPasswordTarget!;
  return `<div class="modal-layer"><form class="modal-card compact" id="team-password-form">${modalHead('reset password', `set a new temporary password for ${esc(profile.displayName || profile.email)}.`)}<input type="hidden" name="userId" value="${profile.id}"><label><span>new temporary password</span><input name="temporaryPassword" type="password" autocomplete="new-password" autocapitalize="none" minlength="8" placeholder="at least 8 characters" required autofocus></label><label><span>confirm password</span><input name="confirmPassword" type="password" autocomplete="new-password" autocapitalize="none" minlength="8" placeholder="type it again" required></label><p class="team-helper">share this password privately. the team member can change it after signing in.</p><button class="modal-primary" type="submit"><span>save new password</span><i data-lucide="key-round"></i></button></form></div>`;
}

function renderRequestActionModal() {
  const order = activeOrder!;
  const label = orderActionLabel(requestedOrderAction);
  return `<div class="modal-layer"><form class="modal-card compact action-request-modal" id="order-action-request-form">${modalHead(`request ${label}`, `send order ${orderReference(order)} to an owner for approval.`)}<input type="hidden" name="action" value="${requestedOrderAction}"><div class="request-order-summary"><span><i data-lucide="receipt-text"></i></span><div><small>order ${orderReference(order)}</small><strong>${money.format(order.total)}</strong></div></div><label><span>reason</span><textarea name="reason" minlength="3" maxlength="300" placeholder="e.g. customer was charged twice" required autofocus></textarea></label><p class="team-helper">the order stays completed until an owner approves this ${label}.</p><button class="modal-primary" type="submit"><span>send ${label} request</span><i data-lucide="bell"></i></button></form></div>`;
}

function renderReviewRequestModal() {
  const request = reviewRequestTarget!;
  const order = orders.find((item) => item.id === request.orderId);
  const approving = reviewDecision === 'approved';
  return `<div class="modal-layer"><form class="modal-card compact review-request-modal" id="review-request-form">${modalHead(`${approving ? 'approve' : 'decline'} ${orderActionLabel(request.action)}?`, `${request.requestedByName} requested this change.`)}<input type="hidden" name="requestId" value="${request.id}"><input type="hidden" name="decision" value="${reviewDecision}"><div class="review-request-summary"><div><small>${order ? `order ${orderReference(order)}` : 'order'}</small><strong>${order ? money.format(order.total) : ''}</strong></div><span class="approval-action">${orderActionLabel(request.action)}</span></div><blockquote>${esc(request.reason)}</blockquote><label><span>owner note <small>optional</small></span><textarea name="note" maxlength="300" placeholder="add context for the team member"></textarea></label><button class="modal-primary ${approving ? '' : 'decline-action'}" type="submit"><span>${approving ? `approve ${orderActionLabel(request.action)}` : 'decline request'}</span><i data-lucide="${approving ? 'check' : 'x'}"></i></button></form></div>`;
}

function renderOrderActionControls(order: Order, waitingToSync: boolean) {
  if (waitingToSync) return `<div class="pending-order-note"><i data-lucide="wifi-off"></i><span>this order is saved on this ipad and waiting to sync.</span></div>`;
  const requestHistory = requestsForOrder(order.id);
  const pendingRequest = requestHistory.find((request) => request.status === 'pending');
  const latestRequest = requestHistory[0];
  if (order.status !== 'completed') {
    if (!latestRequest) return '';
    return `<div class="request-result ${latestRequest.status}"><i data-lucide="${latestRequest.status === 'approved' ? 'check' : 'x'}"></i><span>${orderActionLabel(latestRequest.action)} request ${latestRequest.status}${latestRequest.reviewedByName ? ` by ${esc(latestRequest.reviewedByName)}` : ''}</span></div>`;
  }
  if (pendingRequest) {
    return `<div class="order-approval-pending"><div><i data-lucide="clock-3"></i><span><strong>${orderActionLabel(pendingRequest.action)} awaiting approval</strong><small>${esc(pendingRequest.reason)} · requested by ${esc(pendingRequest.requestedByName)}</small></span></div>${isOwner() ? `<div class="approval-actions"><button class="secondary-button" data-review-request="${pendingRequest.id}" data-review-decision="declined">decline</button><button class="primary-small" data-review-request="${pendingRequest.id}" data-review-decision="approved"><i data-lucide="check"></i><span>review & approve</span></button></div>` : '<p>an owner will see this request automatically.</p>'}</div>`;
  }
  const previous = latestRequest?.status === 'declined' ? `<div class="request-result declined"><i data-lucide="x"></i><span>last ${orderActionLabel(latestRequest.action)} request was declined${latestRequest.reviewedByName ? ` by ${esc(latestRequest.reviewedByName)}` : ''}${latestRequest.reviewNote ? ` · ${esc(latestRequest.reviewNote)}` : ''}</span></div>` : '';
  if (usingCloud() && navigator.onLine && currentProfile?.role === 'staff') {
    return `${previous}<div class="order-fix request-owner"><p>need to fix this sale? send the reason to an owner.</p><div><button data-request-action="refunded"><i data-lucide="receipt-text"></i><span>request refund</span></button><button data-request-action="voided"><i data-lucide="x"></i><span>request void</span></button></div></div>`;
  }
  if (usingCloud() && navigator.onLine && currentProfile?.role === 'owner') {
    return `${previous}<div class="order-fix owner-direct"><p>owner action · this change is applied immediately and recorded.</p><div><button data-order-status="refunded"><i data-lucide="receipt-text"></i><span>refund</span></button><button data-order-status="voided"><i data-lucide="x"></i><span>void</span></button></div></div>`;
  }
  return `${previous}<div class="order-fix offline-fallback"><p>offline emergency · enter the manager pin. this will sync when the ipad reconnects.</p><div><input id="order-pin" inputmode="numeric" type="password" placeholder="manager pin"><button data-order-status="refunded">refund</button><button data-order-status="voided">void</button></div></div>`;
}

function renderOrderModal(order: Order) {
  const pending = isPendingOrder(order);
  return `<div class="modal-layer"><section class="modal-card order-detail">${modalHead(`order ${orderReference(order)}`, `${shortDate.format(new Date(order.createdAt)).toLowerCase()} · ${time.format(new Date(order.createdAt)).toLowerCase()} · ${paymentLabel(order.paymentMethod)} · ${esc(order.deviceName || 'this ipad')}`)}<div class="order-detail-status"><span class="status-pill ${pending ? 'pending' : order.status}">${pending ? 'waiting to sync' : order.status}</span><strong>${money.format(order.total)}</strong></div><div class="detail-lines">${order.lines.map((line) => `<div><span><strong>${line.quantity}× ${esc(line.product.name)}</strong><small>${line.modifiers.map((item) => esc(item.name)).join(' · ') || 'no add-ons'}</small></span><strong>${money.format(lineUnitPrice(line) * line.quantity)}</strong></div>`).join('')}</div>${order.customerName || order.note ? `<div class="order-memo"><span>${esc(order.customerName || 'walk-in')}</span><p>${esc(order.note || 'no order note')}</p></div>` : ''}<div class="detail-totals"><div><span>subtotal</span><strong>${money.format(order.subtotal)}</strong></div>${order.discount ? `<div><span>${esc(order.discountLabel)}</span><strong>−${money.format(order.discount)}</strong></div>` : ''}${order.tax ? `<div><span>${esc(order.taxName)}</span><strong>${money.format(order.tax)}</strong></div>` : ''}<div><span>total</span><strong>${money.format(order.total)}</strong></div></div>${renderOrderActionControls(order, pending)}</section></div>`;
}

const interactiveSelector = '[data-view],[data-action],[data-product],[data-modifier],[data-quantity],[data-remove],[data-payment],[data-cash],[data-preset-discount],[data-range],[data-order],[data-catalog-tab],[data-sell-category],[data-stock-adjust],[data-availability],[data-edit-product],[data-edit-modifier],[data-order-status],[data-request-action],[data-review-request],[data-use-price-list],[data-edit-price-list],[data-duplicate-price-list],[data-archive-price-list],[data-restore-product],[data-restore-modifier],[data-restore-price-list],[data-delete-archive],[data-team-password],[data-team-active],[data-sku-prefix]';
const catalogTouchSelector = '[data-action="new-product"],[data-action="new-modifier"],[data-action="new-price-list"],[data-catalog-tab],[data-stock-adjust],[data-availability],[data-edit-product],[data-edit-modifier],[data-use-price-list],[data-edit-price-list],[data-duplicate-price-list],[data-archive-price-list],[data-restore-product],[data-restore-modifier],[data-restore-price-list],[data-delete-archive]';

app.addEventListener('touchend', (event) => {
  if (!(event.target instanceof Element)) return;
  const editorButton = event.target.closest<HTMLButtonElement>('[data-editor-save]');
  if (editorButton) {
    event.preventDefault();
    void saveEditorFromButton(editorButton);
    return;
  }
  const target = event.target.closest<HTMLElement>(catalogTouchSelector);
  if (!target) return;
  event.preventDefault();
  target.click();
}, { passive: false });

app.addEventListener('click', async (event) => {
  if (!(event.target instanceof Element)) return;
  const editorButton = event.target.closest<HTMLButtonElement>('[data-editor-save]');
  if (editorButton) {
    event.preventDefault();
    await saveEditorFromButton(editorButton);
    return;
  }
  const target = event.target.closest<HTMLElement>(interactiveSelector);
  if (!target) return;

  if (target.dataset.view) { const requested = target.dataset.view as View; if (!canOpenView(requested)) { toast('owner access required'); return; } view = requested; modal = ''; render(); return; }
  if (target.dataset.sellCategory) { sellCategory = target.dataset.sellCategory; render(); return; }
  if (target.dataset.skuPrefix && target.dataset.skuTarget) { const input = document.querySelector<HTMLInputElement>(`#${target.dataset.skuTarget}`); if (input) { input.value = target.dataset.skuPrefix; input.focus(); input.setSelectionRange(input.value.length, input.value.length); } return; }
  if (target.dataset.product) { activeProduct = products.find((item) => item.id === target.dataset.product)!; selectedModifiers.clear(); modal = 'modifiers'; render(); return; }
  if (target.dataset.modifier) {
    selectedModifiers.has(target.dataset.modifier) ? selectedModifiers.delete(target.dataset.modifier) : selectedModifiers.add(target.dataset.modifier);
    target.classList.toggle('selected', selectedModifiers.has(target.dataset.modifier));
    const selected = modifiers.filter((item) => selectedModifiers.has(item.id));
    const total = menuUnitPrice(activeProduct!, selected);
    const totalElement = document.querySelector<HTMLElement>('[data-action="add-to-cart"] strong');
    if (totalElement) totalElement.textContent = money.format(total);
    return;
  }
  if (target.dataset.quantity) { const index = Number(target.dataset.quantity); cart[index].quantity += Number(target.dataset.delta); if (cart[index].quantity < 1) cart.splice(index, 1); render(); return; }
  if (target.dataset.remove) { cart.splice(Number(target.dataset.remove), 1); render(); return; }
  if (target.dataset.payment) { paymentMethod = target.dataset.payment as PaymentMethod; cashReceived = ''; updatePaymentModal(); if (paymentMethod === 'cash') focusCash(); return; }
  if (target.dataset.cash) {
    cashReceived = target.dataset.cash;
    const input = document.querySelector<HTMLInputElement>('#cash-received');
    if (input) input.value = cashReceived;
    const change = Math.max(0, (Number(cashReceived) || 0) - totals().total);
    const value = document.querySelector('#change-value'); if (value) value.textContent = money.format(change);
    const button = document.querySelector<HTMLButtonElement>('[data-action="complete-sale"]'); if (button) button.disabled = (Number(cashReceived) || 0) < totals().total;
    focusCash(); return;
  }
  if (target.dataset.presetDiscount) { discount = { type: 'percent', value: Number(target.dataset.presetDiscount), label: `${target.dataset.presetDiscount}% off` }; modal = ''; render(); return; }
  if (target.dataset.order) { activeOrder = orders.find((item) => item.id === target.dataset.order)!; modal = 'order'; render(); return; }
  if (target.dataset.catalogTab) { catalogTab = target.dataset.catalogTab as 'products' | 'addons' | 'prices' | 'archive'; render(); return; }
  if (target.dataset.stockAdjust) { await adjustProductStock(target.dataset.stockAdjust, Number(target.dataset.delta), 'manual'); await refreshData(); render(); toast('stock updated'); return; }
  if (target.dataset.availability) {
    const item = products.find((product) => product.id === target.dataset.availability)!;
    if (item.trackStock && (item.stockQuantity || 0) <= 0 && productUnavailable(item)) { toast('add stock before making this product available'); return; }
    item.soldOut = !item.soldOut; await save('products', item); await refreshData(); render(); toast(item.soldOut ? 'product is unavailable' : 'product is available'); return;
  }
  if (target.dataset.editProduct) { editingProduct = products.find((item) => item.id === target.dataset.editProduct)!; modal = 'product'; render(); return; }
  if (target.dataset.editModifier) { editingModifier = modifiers.find((item) => item.id === target.dataset.editModifier)!; modal = 'modifier'; render(); return; }
  if (target.dataset.orderStatus) { await changeOrderStatus(target.dataset.orderStatus as OrderStatus); return; }
  if (target.dataset.requestAction) { requestedOrderAction = target.dataset.requestAction as OrderAction; modal = 'request-action'; render(); return; }
  if (target.dataset.reviewRequest && target.dataset.reviewDecision) {
    if (!isOwner()) { toast('owner access required'); return; }
    reviewRequestTarget = orderActionRequests.find((request) => request.id === target.dataset.reviewRequest) || null;
    reviewDecision = target.dataset.reviewDecision as 'approved' | 'declined';
    if (reviewRequestTarget) { modal = 'review-request'; render(); }
    return;
  }
  if (target.dataset.usePriceList) { await usePriceList(target.dataset.usePriceList); return; }
  if (target.dataset.editPriceList) { editingPriceList = priceLists.find((item) => item.id === target.dataset.editPriceList)!; modal = 'price-list'; render(); return; }
  if (target.dataset.duplicatePriceList) { await duplicatePriceList(target.dataset.duplicatePriceList); return; }
  if (target.dataset.archivePriceList) { await archivePriceList(target.dataset.archivePriceList); return; }
  if (target.dataset.restoreProduct) { const item = products.find((product) => product.id === target.dataset.restoreProduct); if (item) { item.archived = false; await save('products', item); await refreshData(); render(); toast('product restored'); } return; }
  if (target.dataset.restoreModifier) { const item = modifiers.find((modifier) => modifier.id === target.dataset.restoreModifier); if (item) { item.archived = false; await save('modifiers', item); await refreshData(); render(); toast('add-on restored'); } return; }
  if (target.dataset.restorePriceList) { const item = priceLists.find((list) => list.id === target.dataset.restorePriceList); if (item) { item.archived = false; await save('priceLists', item); await refreshData(); render(); toast('price list restored'); } return; }
  if (target.dataset.deleteArchive && target.dataset.archiveKind) {
    const kind = target.dataset.archiveKind as ArchiveKind;
    const item = kind === 'product' ? products.find((product) => product.id === target.dataset.deleteArchive) : kind === 'modifier' ? modifiers.find((modifier) => modifier.id === target.dataset.deleteArchive) : priceLists.find((list) => list.id === target.dataset.deleteArchive);
    if (item) { archiveDeleteTarget = { kind, id: item.id, name: item.name }; modal = 'delete-archive'; render(); }
    return;
  }
  if (target.dataset.teamPassword) {
    teamPasswordTarget = businessProfiles.find((profile) => profile.id === target.dataset.teamPassword) || null;
    if (teamPasswordTarget) { modal = 'team-password'; render(); }
    return;
  }
  if (target.dataset.teamActive) {
    const active = target.dataset.active === 'true';
    const button = target as HTMLButtonElement;
    button.disabled = true;
    try {
      await updateTeamMemberActive(target.dataset.teamActive, active);
      businessProfiles = await getBusinessProfiles();
      render(); toast(active ? 'account access restored' : 'account access revoked');
    } catch (error) { button.disabled = false; toast(readableError(error, 'account access could not be updated')); }
    return;
  }

  switch (target.dataset.action) {
    case 'close-modal': modal = ''; archiveDeleteTarget = null; teamPasswordTarget = null; reviewRequestTarget = null; render(); break;
    case 'open-account': modal = 'account'; render(); break;
    case 'open-approvals': if (isOwner()) { view = 'approvals'; modal = ''; render(); } else toast('owner access required'); break;
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
    case 'confirm-archive-delete': {
      const button = target as HTMLButtonElement;
      button.disabled = true;
      try { await permanentlyDeleteArchivedItem(); }
      catch (error) { button.disabled = false; toast(readableError(error, 'item could not be deleted')); }
      break;
    }
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
  if (input.hasAttribute('data-stock-tracking')) {
    const field = document.querySelector<HTMLElement>('.stock-quantity-field');
    const quantity = field?.querySelector<HTMLInputElement>('input');
    const tracking = input.value === 'true';
    field?.classList.toggle('disabled', !tracking);
    if (quantity) quantity.disabled = !tracking;
  }
  if (input.getAttribute('name') === 'includedProductIds') input.closest('.price-editor-row')?.classList.toggle('excluded', !(input as HTMLInputElement).checked);
  if (input.dataset.teamRole) {
    const previous = businessProfiles.find((profile) => profile.id === input.dataset.teamRole)?.role;
    input.disabled = true;
    try {
      await updateTeamMemberRole(input.dataset.teamRole, input.value as UserRole);
      businessProfiles = await getBusinessProfiles();
      render(); toast('account access updated');
    } catch (error) {
      if (previous) input.value = previous;
      input.disabled = false;
      toast(readableError(error, 'account access could not be updated'));
    }
    return;
  }
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
  if (form.id === 'order-action-request-form') {
    if (!activeOrder) return;
    const reason = String(data.get('reason') || '').trim();
    if (reason.length < 3) { toast('add a short reason for the owner'); return; }
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      await requestOrderAction(activeOrder.id, data.get('action') as OrderAction, reason);
      orderActionRequests = await getOrderActionRequests();
      modal = 'order'; render(); toast('request sent to the owners');
    } catch (error) { if (button) button.disabled = false; toast(readableError(error, 'request could not be sent')); }
    return;
  }
  if (form.id === 'review-request-form') {
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      const decision = data.get('decision') as 'approved' | 'declined';
      await reviewOrderAction(String(data.get('requestId') || ''), decision, String(data.get('note') || ''));
      await syncFromCloud();
      await refreshData();
      reviewRequestTarget = null; modal = ''; render(); toast(decision === 'approved' ? 'request approved and order updated' : 'request declined');
    } catch (error) { if (button) button.disabled = false; toast(readableError(error, 'request could not be reviewed')); }
    return;
  }
  if (form.id === 'team-password-form') {
    const password = String(data.get('temporaryPassword') || '');
    const confirmation = String(data.get('confirmPassword') || '');
    if (password.length < 8) { toast('password must be at least 8 characters'); return; }
    if (password !== confirmation) { toast('passwords do not match'); return; }
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      await resetTeamMemberPassword(String(data.get('userId') || ''), password);
      teamPasswordTarget = null; modal = ''; render(); toast('temporary password updated');
    } catch (error) { if (button) button.disabled = false; toast(readableError(error, 'password could not be updated')); }
    return;
  }
  if (form.id === 'invite-staff-form') {
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      await createTeamAccount(String(data.get('email') || ''), String(data.get('displayName') || ''), String(data.get('temporaryPassword') || ''), data.get('role') as UserRole);
      businessProfiles = await getBusinessProfiles();
      render(); toast('account created');
    } catch (error) { if (button) button.disabled = false; toast(readableError(error, 'account could not be created')); }
    return;
  }
  if (form.id === 'device-settings-form') {
    deviceIdentity = await updateDeviceIdentity(String(data.get('deviceName') || ''), String(data.get('devicePrefix') || ''));
    render(); toast('ipad details saved'); return;
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
  if (form.id === 'product-form' || form.id === 'modifier-form' || form.id === 'price-list-form') {
    const button = form.querySelector<HTMLButtonElement>('[data-editor-save]');
    if (button) await saveEditorFromButton(button);
    return;
  }
  if (form.id === 'business-settings') {
    settings.activePriceListId = String(data.get('activePriceListId'));
    settings.taxEnabled = data.get('taxEnabled') === 'on';
    if (settings.taxEnabled) { settings.taxName = String(data.get('taxName') || 'tax'); settings.taxRate = Number(data.get('taxRate')) || 0; settings.taxInclusive = data.get('taxInclusive') === 'true'; }
    await save('settings', settings); await refreshData(); render(); toast('settings saved'); return;
  }
  if (form.id === 'security-settings') { try { await updateManagerPin(String(data.get('managerPin'))); await refreshData(); render(); toast('manager pin updated · offline fallback ready'); } catch (error) { toast(error instanceof Error ? error.message.toLowerCase() : 'pin could not be updated'); } }
});

function readableError(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message.toLowerCase();
  return fallback;
}

async function saveEditorFromButton(button: HTMLButtonElement) {
  const form = button.form;
  if (!form || button.disabled) return;
  form.querySelector('.form-save-error')?.remove();
  if (!form.checkValidity()) {
    const alert = document.createElement('p');
    alert.className = 'form-save-error';
    alert.setAttribute('role', 'alert');
    alert.textContent = 'complete the highlighted fields before saving';
    button.insertAdjacentElement('beforebegin', alert);
    form.reportValidity();
    return;
  }
  const data = new FormData(form);
  if (button.dataset.editorSave === 'product') return runEditorSave(form, button, () => saveProduct(data), 'product could not be saved');
  if (button.dataset.editorSave === 'modifier') return runEditorSave(form, button, () => saveModifier(data), 'add-on could not be saved');
  return runEditorSave(form, button, () => savePriceList(data), 'price list could not be saved');
}

async function runEditorSave(form: HTMLFormElement, button: HTMLButtonElement, operation: () => Promise<void>, fallback: string) {
  const originalMarkup = button?.innerHTML || '';
  form.querySelector('.form-save-error')?.remove();
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = 'saving…';
  try {
    await operation();
  } catch (error) {
    console.error(fallback, error);
    if (button.isConnected) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.innerHTML = originalMarkup;
      hydrateIcons();
      const message = readableError(error, fallback);
      const alert = document.createElement('p');
      alert.className = 'form-save-error';
      alert.setAttribute('role', 'alert');
      alert.textContent = message;
      button.insertAdjacentElement('beforebegin', alert);
      toast(message);
    }
  }
}

function addToCart() {
  if (!activeProduct) return;
  const selected = modifiers.filter((item) => selectedModifiers.has(item.id));
  const signature = `${activeProduct.id}:${selected.map((item) => item.id).sort().join(',')}`;
  const existing = cart.find((line) => line.id === signature);
  if (existing) existing.quantity += 1;
  else cart.push({ id: signature, product: clone(activeProduct), modifiers: clone(selected), unitPrice: menuUnitPrice(activeProduct, selected), quantity: 1 });
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
  const order: Order = { id: uid(), number: settings.nextOrderNumber, createdAt: new Date().toISOString(), status: 'completed', paymentMethod, priceListId: selectedPriceList?.id, priceListName: selectedPriceList?.name, customerName: customerName.trim(), note: orderNote.trim(), lines: clone(cart), subtotal: amount.subtotal, discount: amount.discount, discountLabel: discount?.label || '', tax: amount.tax, taxName: settings.taxEnabled ? settings.taxName : '', total: amount.total, createdBy: currentProfile?.id, createdByName: currentProfile?.displayName, deviceId: deviceIdentity.deviceId, deviceName: deviceIdentity.name, ...(paymentMethod === 'cash' ? { cashReceived: Number(cashReceived) } : {}) };
  const savedOrder = await createOrder(order);
  await Promise.all(order.lines.map((line) => adjustProductStock(line.product.id, -line.quantity, 'sale', order.id)));
  latestOrder = savedOrder; cart = []; discount = null; customerName = ''; orderNote = ''; cashReceived = '';
  if (usingCloud() && navigator.onLine) { try { await syncFromCloud(); } catch { /* queued changes remain safely on this ipad */ } }
  await refreshData(); modal = 'receipt'; render();
}

async function saveProduct(data: FormData) {
  const existing = products.find((item) => item.id === data.get('id'));
  const enteredPrice = Number(data.get('price'));
  const trackStock = data.get('trackStock') === 'true';
  const stockQuantity = trackStock ? Math.max(0, Number(data.get('stockQuantity')) || 0) : existing?.stockQuantity || 0;
  const soldOut = data.get('availability') === 'unavailable' || (trackStock && stockQuantity <= 0);
  const item: Product = { id: existing?.id || uid(), sku: String(data.get('sku')).trim(), name: String(data.get('name')).trim(), description: String(data.get('description')).trim(), category: String(data.get('category')).trim(), price: enteredPrice, standardPrice: existing?.standardPrice || enteredPrice, image: String(data.get('image') || '/assets/DT-LOGO-001.png'), modifierIds: data.getAll('modifierIds').map(String), soldOut, trackStock, stockQuantity, archived: false, createdAt: existing?.createdAt || new Date().toISOString() };
  await save('products', item);
  await Promise.all(priceLists.filter((priceList) => !priceList.archived).map(async (list) => {
    if (list.id === settings.activePriceListId || list.prices[item.id] === undefined) list.prices[item.id] = enteredPrice;
    if (list.id === settings.activePriceListId && list.productIds && !list.productIds.includes(item.id)) list.productIds.push(item.id);
    await save('priceLists', list);
  }));
  await refreshData(); modal = ''; render(); toast(existing ? 'product updated' : 'product added');
}

async function savePriceList(data: FormData) {
  const existing = priceLists.find((item) => item.id === data.get('id'));
  const prices = Object.fromEntries(products.filter((item) => !item.archived).map((product) => [product.id, Number(data.get(`price:${product.id}`)) || 0]));
  const productIds = data.getAll('includedProductIds').map(String);
  if (!productIds.length) throw new Error('include at least one product in this price list');
  const item: PriceList = { id: existing?.id || uid(), name: String(data.get('name')).trim(), prices, productIds, archived: false, createdAt: existing?.createdAt || new Date().toISOString() };
  await save('priceLists', item);
  if (data.get('activate') === 'on') { settings.activePriceListId = item.id; await save('settings', settings); }
  await refreshData(); modal = ''; catalogTab = 'prices'; view = 'catalog'; render(); toast(existing ? 'price list updated' : 'price list added');
}

async function usePriceList(id: string) { settings.activePriceListId = id; await save('settings', settings); await refreshData(); modal = ''; render(); toast(`${activePriceList()?.name} is now active`); }
async function duplicatePriceList(id: string) { const source = priceLists.find((item) => item.id === id); if (!source) return; const copy: PriceList = { ...clone(source), id: uid(), name: `${source.name} copy`, createdAt: new Date().toISOString() }; await save('priceLists', copy); await refreshData(); editingPriceList = priceLists.find((item) => item.id === copy.id)!; modal = 'price-list'; render(); }
async function archivePriceList(id: string) { const item = priceLists.find((list) => list.id === id); if (!item || item.id === settings.activePriceListId || priceLists.filter((list) => !list.archived).length < 2) return; item.archived = true; await save('priceLists', item); await refreshData(); render(); toast('price list archived'); }

async function saveModifier(data: FormData) {
  const existing = modifiers.find((item) => item.id === data.get('id'));
  const item: Modifier = { id: existing?.id || uid(), sku: String(data.get('sku')).trim(), name: String(data.get('name')).trim(), price: Number(data.get('price')), archived: false, createdAt: existing?.createdAt || new Date().toISOString() };
  await save('modifiers', item); await refreshData(); modal = ''; render(); toast(existing ? 'add-on updated' : 'add-on added');
}

async function archiveProduct() { if (!editingProduct) return; editingProduct.archived = true; await save('products', editingProduct); await refreshData(); modal = ''; render(); toast('product archived'); }
async function archiveModifier() { if (!editingModifier) return; editingModifier.archived = true; await save('modifiers', editingModifier); for (const product of products.filter((item) => item.modifierIds.includes(editingModifier!.id))) { product.modifierIds = product.modifierIds.filter((id) => id !== editingModifier!.id); await save('products', product); } await refreshData(); modal = ''; render(); toast('add-on archived'); }

async function permanentlyDeleteArchivedItem() {
  const target = archiveDeleteTarget;
  if (!target || !isOwner()) return;
  if (target.kind === 'product') {
    await Promise.all(priceLists.map(async (list) => {
      if (list.prices[target.id] === undefined && !list.productIds?.includes(target.id)) return;
      delete list.prices[target.id];
      if (list.productIds) list.productIds = list.productIds.filter((id) => id !== target.id);
      await save('priceLists', list);
    }));
    await removeCatalogItem('products', target.id);
  } else if (target.kind === 'modifier') {
    await Promise.all(products.filter((product) => product.modifierIds.includes(target.id)).map(async (product) => {
      product.modifierIds = product.modifierIds.filter((id) => id !== target.id);
      await save('products', product);
    }));
    await removeCatalogItem('modifiers', target.id);
  } else {
    if (target.id === settings.activePriceListId) throw new Error('the active price list cannot be deleted');
    await removeCatalogItem('priceLists', target.id);
  }
  archiveDeleteTarget = null;
  modal = '';
  await refreshData();
  render();
  toast('item permanently deleted');
}

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
  const rows = [['order number','receipt reference','device','date','status','sync','customer','payment','items','subtotal','discount','tax','total'], ...orders.slice().sort((a,b) => a.number-b.number).map((order) => [order.number, orderReference(order), order.deviceName || '', order.createdAt, order.status, isPendingOrder(order) ? 'pending' : 'synced', order.customerName, order.paymentMethod, order.lines.reduce((sum,line)=>sum+line.quantity,0), order.subtotal, order.discount, order.tax, order.total])];
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
  const orderRows: (string | number)[][] = [['order', 'receipt reference', 'device', 'date', 'status', 'sync', 'customer', 'payment', 'price list', 'subtotal', 'discount', 'tax', 'total'], ...sorted.map((order) => [order.number, orderReference(order), order.deviceName || '', new Date(order.createdAt).toLocaleString('en-PH'), order.status, isPendingOrder(order) ? 'pending' : 'synced', order.customerName || 'walk-in', order.paymentMethod, order.priceListName || '', order.subtotal, order.discount, order.tax, order.total])];
  const itemRows: (string | number)[][] = [['order', 'receipt reference', 'sku', 'product', 'add-ons', 'quantity', 'unit price', 'line total']];
  sorted.forEach((order) => order.lines.forEach((line) => {
    const price = lineUnitPrice(line);
    itemRows.push([order.number, orderReference(order), line.product.sku, line.product.name, line.modifiers.map((item) => item.name).join(', '), line.quantity, price, price * line.quantity]);
  }));
  const approvalRows: (string | number)[][] = [['request id', 'order', 'action', 'reason', 'status', 'requested by', 'requested at', 'reviewed by', 'reviewed at', 'owner note'], ...orderActionRequests.map((request) => {
    const order = orders.find((item) => item.id === request.orderId);
    return [request.id, order ? orderReference(order) : request.orderId, orderActionLabel(request.action), request.reason, request.status, request.requestedByName, request.requestedAt, request.reviewedByName || '', request.reviewedAt || '', request.reviewNote || ''];
  })];
  const workbook = createXlsx([['summary', summaryRows], ['orders', orderRows], ['order items', itemRows], ['approval requests', approvalRows]]);
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

async function refreshData() {
  const [nextProducts, nextModifiers, nextPriceLists, nextOrders, nextSettings, pending, device, nextRequests] = await Promise.all([getProducts(), getModifiers(), getPriceLists(), getOrders(), getSettings(), getPendingSyncState(), getDeviceIdentity(), getOrderActionRequests().catch(() => orderActionRequests)]);
  products = nextProducts; modifiers = nextModifiers; priceLists = nextPriceLists; orders = nextOrders; settings = nextSettings;
  pendingSyncCount = pending.count; pendingOrderIds = new Set(pending.orderIds); deviceIdentity = device; orderActionRequests = nextRequests;
}

async function retry<T>(operation: () => Promise<T>, attempts = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await new Promise((resolve) => window.setTimeout(resolve, 450));
    }
  }
  throw lastError;
}

async function activateCloudSession() {
  const profile = await retry(getCurrentProfile);
  if (!profile || !profile.active) throw new Error('this account does not have active doubletime access');
  currentProfile = profile;
  connectCloud(profile);
  await cacheOfflineAccess(profile);
  if (navigator.onLine) {
    syncPhase = 'syncing';
    try { await retry(syncFromCloud); }
    catch (error) { console.warn('cloud sync will retry when the connection settles', error); }
    finally { syncPhase = 'online'; }
  }
  await refreshData();
  businessProfiles = profile.role === 'owner' && navigator.onLine ? await getBusinessProfiles().catch(() => []) : [];
  stopBusinessWatcher?.();
  stopBusinessWatcher = watchBusinessChanges(async () => {
    if (!navigator.onLine) return;
    try { syncPhase = 'syncing'; render(); await syncFromCloud(); await refreshData(); syncPhase = 'online'; render(); }
    catch { syncPhase = navigator.onLine ? 'online' : 'offline'; render(); }
  });
}

async function activateOfflineSession() {
  const access = await getOfflineAccess();
  if (!access) return false;
  currentProfile = access.profile;
  connectCloud(access.profile);
  syncPhase = 'offline';
  await refreshData();
  return true;
}

function renderOfflineAccessNeeded() {
  app.innerHTML = `<div class="auth-screen"><section class="auth-card">${brandMark()}<p class="eyebrow">offline access</p><h1>connect this ipad once</h1><p class="auth-intro">this ipad needs one successful online verification before it can launch offline for the next ${OFFLINE_ACCESS_DAYS} days.</p><div class="auth-sent setup"><i data-lucide="wifi-off"></i><div><strong>your saved records are still here</strong><span>reconnect to verify the account, then offline launch will be ready.</span></div></div></section></div>`;
  hydrateIcons();
}

async function reconnectAndSync() {
  syncPhase = 'syncing'; render();
  try {
    const profile = await retry(getCurrentProfile);
    if (!profile || !profile.active) {
      await clearOfflineAccess();
      currentProfile = null; connectCloud(null); renderSignIn(); return;
    }
    currentProfile = profile; connectCloud(profile); await cacheOfflineAccess(profile);
    await syncFromCloud(); await refreshData();
    businessProfiles = profile.role === 'owner' ? await getBusinessProfiles().catch(() => []) : [];
    syncPhase = 'online'; render();
  } catch (error) {
    syncPhase = navigator.onLine ? 'online' : 'offline';
    await refreshData(); render();
    toast(readableError(error, 'sync will retry when the connection settles'));
  }
}

async function handleSignOut() {
  stopBusinessWatcher?.(); stopBusinessWatcher = null;
  await clearOfflineAccess();
  try { await signOut(); } catch { /* the local session is cleared below */ }
  currentProfile = null; businessProfiles = []; orderActionRequests = []; connectCloud(null); modal = ''; view = 'sell'; signInSentTo = '';
  renderSignIn();
}

function startAuthWatcher() {
  if (authWatcherStarted || !isCloudConfigured) return;
  authWatcherStarted = true;
  watchAuth((event, session) => {
    if (event === 'SIGNED_OUT' && navigator.onLine) { void clearOfflineAccess(); currentProfile = null; connectCloud(null); renderSignIn(); }
    if (event === 'SIGNED_IN' && session && !currentProfile) {
      setTimeout(async () => {
        try { await activateCloudSession(); render(); }
        catch (error) { app.innerHTML = `<div class="fatal-error"><h1>access unavailable</h1><p>${esc(error instanceof Error ? error.message : 'this account could not be loaded')}</p></div>`; }
      }, 0);
    }
  });
}

window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferredInstallPrompt = event; if (view === 'settings') render(); });
window.addEventListener('online', async () => { if (currentProfile) await reconnectAndSync(); else await start(); });
window.addEventListener('offline', () => { syncPhase = 'offline'; render(); });
if ('serviceWorker' in navigator) window.addEventListener('load', () => {
  window.setTimeout(() => navigator.serviceWorker.register('/pos-sw.js', { scope: __POS_BASE__, updateViaCache: 'none' }).catch(() => undefined), 1200);
});

async function start() {
  app.innerHTML = `<div class="loading-screen">${brandMark()}<p>getting the good cups ready…</p></div>`;
  try {
    await initializeStore();
    if ('storage' in navigator && typeof navigator.storage.persist === 'function') void navigator.storage.persist().catch(() => false);
    if (isCloudConfigured) {
      if (!navigator.onLine) {
        if (!await activateOfflineSession()) { renderOfflineAccessNeeded(); startAuthWatcher(); return; }
        render(); startAuthWatcher(); return;
      }
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
