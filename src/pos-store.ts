import { isCloudConfigured, supabase } from './pos-auth';
import type { DeviceIdentity, Modifier, OfflineAccess, Order, OrderAction, OrderActionRequest, OrderStatus, PosProfile, PriceList, Product, Settings } from './pos-types';

const DB_NAME = 'doubletime-pos';
const DB_VERSION = 4;
const entityStores = ['products', 'modifiers', 'orders', 'settings', 'priceLists'] as const;
const stores = [...entityStores, 'outbox', 'metadata'] as const;
type EntityStore = (typeof entityStores)[number];
type StoreName = (typeof stores)[number];
type CloudOperation = 'upsert' | 'delete' | 'create-order' | 'inventory-adjustment' | 'change-order-status';
type OutboxRecord = { id: string; storeName: EntityStore; operation: CloudOperation; value: unknown; queuedAt: string };
type InventoryAdjustment = { id: string; productId: string; delta: number; reason: 'sale' | 'manual'; referenceId?: string; createdAt: string };
type QueuedOrderStatus = { id: string; status: OrderAction; pin: string };
type CatalogStore = Exclude<EntityStore, 'orders' | 'settings'>;
export type PendingSyncState = { count: number; orderIds: string[] };

export const OFFLINE_ACCESS_DAYS = 7;
const OFFLINE_ACCESS_MS = OFFLINE_ACCESS_DAYS * 24 * 60 * 60 * 1000;

const now = new Date().toISOString();
const seedProducts: Product[] = [
  { id: 'classic', sku: 'DT-MAT-CLS', name: 'classic matcha', description: 'smooth, sweet, and umami', category: 'matcha', price: 140, standardPrice: 190, image: '/assets/cocoloco-front-view-pos.webp', modifierIds: ['oat','strawberry','mango','strawberry-mango','sweetener'], soldOut: false, archived: false, createdAt: now },
  { id: 'stay-salty', sku: 'DT-MAT-SLT', name: 'stay salty', description: 'matcha with sea salt cream', category: 'matcha', price: 160, standardPrice: 210, image: '/assets/DT-MAT-SLT-pos.webp', modifierIds: ['oat','sweetener'], soldOut: false, archived: false, createdAt: now },
  { id: 'coco-loco', sku: 'DT-MAT-COC', name: 'coco loco', description: 'matcha with coconut milk', category: 'matcha', price: 170, standardPrice: 220, image: '/assets/cocoloco-front-view-pos.webp', modifierIds: ['oat','sweetener'], soldOut: false, archived: false, createdAt: now },
  { id: 'berry-cute', sku: 'DT-MAT-BRY', name: 'berry cute', description: 'strawberry matcha', category: 'matcha', price: 170, standardPrice: 220, image: '/assets/22-pos.webp', modifierIds: ['oat','mango','sweetener'], soldOut: false, archived: false, createdAt: now },
  { id: 'golden-hour', sku: 'DT-MAT-GLD', name: 'golden hour', description: 'mango matcha', category: 'matcha', price: 170, standardPrice: 220, image: '/assets/21-pos.webp', modifierIds: ['oat','strawberry','sweetener'], soldOut: false, archived: false, createdAt: now },
];
const seedModifiers: Modifier[] = [
  { id: 'oat', sku: 'DT-ADD-OAT', name: 'oat milk', price: 25, archived: false, createdAt: now },
  { id: 'strawberry', sku: 'DT-ADD-STR', name: 'strawberry', price: 25, archived: false, createdAt: now },
  { id: 'mango', sku: 'DT-ADD-MGO', name: 'mango', price: 25, archived: false, createdAt: now },
  { id: 'strawberry-mango', sku: 'DT-ADD-STM', name: 'strawberry mango', price: 25, archived: false, createdAt: now },
  { id: 'sweetener', sku: 'DT-ADD-SWT', name: 'sweetener', price: 15, archived: false, createdAt: now },
];
const seedSettings: Settings = { id: 'main', activePriceListId: 'tasting', taxEnabled: false, taxName: 'tax', taxRate: 0, taxInclusive: true, nextOrderNumber: 1, managerPin: '2026' };

let database: Promise<IDBDatabase> | null = null;
let cloudProfile: PosProfile | null = null;

function openDatabase() {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      for (const name of stores) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
  return database;
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function allLocal<T>(storeName: StoreName) {
  const db = await openDatabase();
  return requestResult<T[]>(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
}

async function oneLocal<T>(storeName: StoreName, id: string) {
  const db = await openDatabase();
  return requestResult<T | undefined>(db.transaction(storeName, 'readonly').objectStore(storeName).get(id));
}

async function putLocal<T>(storeName: StoreName, value: T) {
  const db = await openDatabase();
  await requestResult(db.transaction(storeName, 'readwrite').objectStore(storeName).put(value));
}

async function deleteLocal(storeName: StoreName, id: string) {
  const db = await openDatabase();
  await requestResult(db.transaction(storeName, 'readwrite').objectStore(storeName).delete(id));
}

async function replaceLocal<T>(storeName: EntityStore, values: T[]) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const objectStore = transaction.objectStore(storeName);
    objectStore.clear();
    values.forEach((value) => objectStore.put(value));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

const cloudActive = () => Boolean(isCloudConfigured && supabase && cloudProfile);
const tableName = (storeName: EntityStore) => ({ products: 'products', modifiers: 'modifiers', priceLists: 'price_lists', orders: 'orders', settings: 'business_settings' })[storeName];
const optimizedSeedImages: Array<[string, string]> = [
  ['/assets/cocoloco-front-view.webp', '/assets/cocoloco-front-view-pos.webp'],
  ['/assets/21.webp', '/assets/21-pos.webp'],
  ['/assets/22.webp', '/assets/22-pos.webp'],
];
const optimizeProductImage = (product: Product): Product => {
  const replacement = optimizedSeedImages.find(([source]) => product.image === source || product.image?.endsWith(source))?.[1];
  return replacement && replacement !== product.image ? { ...product, image: replacement } : product;
};
const compactOrder = (order: Order): Order => ({
  ...order,
  lines: (order.lines || []).map((line) => ({
    ...line,
    product: { ...line.product, image: '' },
  })),
});
const isOfflineFailure = (error: unknown) => !navigator.onLine || error instanceof TypeError || /network|fetch|offline/i.test(error instanceof Error ? error.message : String(error));
const cloudWriteTimeout = <T>(operation: PromiseLike<T>, milliseconds = 10000) => new Promise<T>((resolve, reject) => {
  const timeout = window.setTimeout(() => reject(new TypeError('cloud sync timed out')), milliseconds);
  Promise.resolve(operation).then(
    (value) => { window.clearTimeout(timeout); resolve(value); },
    (error) => { window.clearTimeout(timeout); reject(error); },
  );
});

const pinIterations = 160000;
const bytesToBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const base64ToBytes = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

async function deriveOfflinePin(pin: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const saltBuffer = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer;
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBuffer, iterations }, key, 256);
  return new Uint8Array(bits);
}

async function createOfflinePinVerifier(pin: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: bytesToBase64(salt), hash: bytesToBase64(await deriveOfflinePin(pin, salt, pinIterations)), iterations: pinIterations };
}

async function verifyOfflinePin(pin: string, verifier: NonNullable<Settings['offlinePinVerifier']>) {
  const expected = base64ToBytes(verifier.hash);
  const actual = await deriveOfflinePin(pin, base64ToBytes(verifier.salt), verifier.iterations);
  if (expected.length !== actual.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected[index] ^ actual[index];
  return mismatch === 0;
}

function generatedDevicePrefix(deviceId: string) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = 0;
  for (const character of deviceId) value = (value * 31 + character.charCodeAt(0)) >>> 0;
  return `${alphabet[value % alphabet.length]}${alphabet[Math.floor(value / alphabet.length) % alphabet.length]}`;
}

function normalizeDevicePrefix(value: string, fallback: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || fallback;
}

export function connectCloud(profile: PosProfile | null) { cloudProfile = profile; }
export function usingCloud() { return cloudActive(); }

export async function cacheOfflineAccess(profile: PosProfile) {
  const record: OfflineAccess = { id: 'offline-access', profile, verifiedAt: new Date().toISOString() };
  await putLocal('metadata', record);
  return record;
}

export async function getOfflineAccess() {
  const record = await oneLocal<OfflineAccess>('metadata', 'offline-access');
  if (!record || !record.profile.active) return null;
  return Date.now() - new Date(record.verifiedAt).getTime() <= OFFLINE_ACCESS_MS ? record : null;
}

export async function clearOfflineAccess() { await deleteLocal('metadata', 'offline-access'); }

export async function getDeviceIdentity() {
  const existing = await oneLocal<DeviceIdentity>('metadata', 'device');
  if (existing) return existing;
  const fallbackId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const deviceId = globalThis.crypto?.randomUUID?.() || fallbackId;
  const prefix = generatedDevicePrefix(deviceId);
  const identity: DeviceIdentity = { id: 'device', deviceId, name: `ipad ${prefix.toLowerCase()}`, prefix, nextLocalOrderNumber: 1 };
  await putLocal('metadata', identity);
  return identity;
}

export async function updateDeviceIdentity(name: string, prefix: string) {
  const identity = await getDeviceIdentity();
  identity.name = name.trim() || identity.name;
  identity.prefix = normalizeDevicePrefix(prefix, identity.prefix);
  await putLocal('metadata', identity);
  return identity;
}

async function reserveLocalReceiptCode() {
  const identity = await getDeviceIdentity();
  const number = identity.nextLocalOrderNumber;
  identity.nextLocalOrderNumber += 1;
  await putLocal('metadata', identity);
  return `${identity.prefix}-${String(number).padStart(3, '0')}`;
}

async function queue(storeName: EntityStore, operation: CloudOperation, value: unknown) {
  const fallbackId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const id = `${operation}:${storeName}:${(value as { id?: string }).id || globalThis.crypto?.randomUUID?.() || fallbackId}`;
  await putLocal<OutboxRecord>('outbox', { id, storeName, operation, value, queuedAt: new Date().toISOString() });
}

async function uploadProductImage(product: Product) {
  if (!supabase || !cloudProfile || !product.image.startsWith('data:image/')) return product;
  const response = await fetch(product.image);
  const blob = await response.blob();
  const safeId = product.id.replace(/[^a-z0-9-_]/gi, '-');
  const extension = blob.type.includes('png') ? 'png' : blob.type.includes('jpeg') ? 'jpg' : 'webp';
  const path = `${cloudProfile.businessId}/${safeId}-${Date.now()}.${extension}`;
  const { error } = await supabase.storage.from('product-images').upload(path, blob, { contentType: blob.type || 'image/webp', upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from('product-images').getPublicUrl(path);
  return { ...product, image: data.publicUrl };
}

async function upsertCloud(storeName: EntityStore, originalValue: unknown) {
  if (!supabase || !cloudProfile) return originalValue;
  let value = originalValue as { id: string };
  if (storeName === 'products') {
    value = await uploadProductImage(optimizeProductImage(value as Product));
    await putLocal('products', value);
  }
  if (storeName === 'settings') {
    const settings = value as unknown as Settings;
    const payload = { ...settings, managerPin: '' };
    const { error } = await supabase.from('business_settings').update({ payload, updated_at: new Date().toISOString() }).eq('business_id', cloudProfile.businessId);
    if (error) throw error;
    return payload;
  }
  if (storeName === 'orders') {
    const order = compactOrder(value as unknown as Order);
    await putLocal('orders', order);
    const { error } = await supabase.from('orders').upsert({
      business_id: cloudProfile.businessId,
      id: order.id,
      number: order.number,
      created_at: order.createdAt,
      status: order.status,
      payment_method: order.paymentMethod,
      total: order.total,
      payload: order,
      created_by: order.createdBy || cloudProfile.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'business_id,id' });
    if (error) throw error;
    return value;
  }
  const { error } = await supabase.from(tableName(storeName)).upsert({
    business_id: cloudProfile.businessId,
    id: value.id,
    payload: value,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'business_id,id' });
  if (error) throw error;
  return value;
}

export async function save<T>(storeName: EntityStore, value: T) {
  await putLocal(storeName, value);
  if (!cloudActive()) return value;
  if (!navigator.onLine) { await queue(storeName, 'upsert', value); return value; }
  try { return await cloudWriteTimeout(upsertCloud(storeName, value)); }
  catch (error) {
    if (isOfflineFailure(error)) { await queue(storeName, 'upsert', value); return value; }
    throw error;
  }
}

async function clearQueuedEntityChanges(storeName: CatalogStore, id: string) {
  const records = await allLocal<OutboxRecord>('outbox');
  const matching = records.filter((record) => {
    if (record.storeName !== storeName) return false;
    if (record.operation === 'inventory-adjustment') return storeName === 'products' && (record.value as InventoryAdjustment).productId === id;
    return (record.value as { id?: string })?.id === id;
  });
  await Promise.all(matching.map((record) => deleteLocal('outbox', record.id)));
}

async function deleteCloudCatalogItem(storeName: CatalogStore, id: string) {
  if (!supabase || !cloudProfile) return;
  const table = tableName(storeName);
  const { data, error } = await supabase
    .from(table)
    .delete()
    .eq('business_id', cloudProfile.businessId)
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (data?.length) return;
  const { data: remaining, error: readError } = await supabase
    .from(table)
    .select('id')
    .eq('business_id', cloudProfile.businessId)
    .eq('id', id);
  if (readError) throw readError;
  if (remaining?.length) throw new Error('supabase catalog deletion policy needs updating');
}

export async function removeCatalogItem(storeName: CatalogStore, id: string) {
  await deleteLocal(storeName, id);
  await clearQueuedEntityChanges(storeName, id);
  if (!cloudActive()) return;
  const value = { id };
  if (!navigator.onLine) { await queue(storeName, 'delete', value); return; }
  try { await cloudWriteTimeout(deleteCloudCatalogItem(storeName, id)); }
  catch (error) {
    await queue(storeName, 'delete', value);
    console.warn('catalog deletion is waiting to sync', error);
  }
}

async function createCloudOrder(order: Order) {
  if (!supabase) throw new Error('supabase is not connected');
  const compact = compactOrder(order);
  const { data, error } = await supabase.rpc('create_pos_order', { p_order: compact });
  if (error) throw error;
  const saved = compactOrder(data as Order);
  await putLocal('orders', saved);
  return saved;
}

async function applyCloudInventoryAdjustment(adjustment: InventoryAdjustment) {
  if (!supabase) throw new Error('supabase is not connected');
  const { data, error } = await supabase.rpc('adjust_pos_inventory', { p_adjustment: adjustment });
  if (error) throw error;
  const product = data as Product;
  await putLocal('products', product);
  return product;
}

export async function adjustProductStock(productId: string, delta: number, reason: InventoryAdjustment['reason'], referenceId?: string) {
  const product = await oneLocal<Product>('products', productId);
  if (!product?.trackStock || !delta) return product;
  product.stockQuantity = Math.max(0, (product.stockQuantity || 0) + delta);
  product.soldOut = product.stockQuantity <= 0;
  await putLocal('products', product);
  const fallbackId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const adjustment: InventoryAdjustment = { id: globalThis.crypto?.randomUUID?.() || fallbackId, productId, delta, reason, referenceId, createdAt: new Date().toISOString() };
  if (!cloudActive()) return product;
  if (!navigator.onLine) { await queue('products', 'inventory-adjustment', adjustment); return product; }
  try { return await cloudWriteTimeout(applyCloudInventoryAdjustment(adjustment)); }
  catch (error) {
    await queue('products', 'inventory-adjustment', adjustment);
    console.warn('inventory adjustment is waiting to sync', error);
    return product;
  }
}

export async function createOrder(order: Order) {
  const compact = compactOrder(order);
  if (cloudActive() && navigator.onLine) {
    try { return await createCloudOrder(compact); }
    catch (error) { if (!isOfflineFailure(error)) throw error; }
  }
  const localSettings = await getSettings();
  const provisional = { ...compact, number: localSettings.nextOrderNumber, localReceiptCode: compact.localReceiptCode || await reserveLocalReceiptCode(), syncStatus: 'pending' } as Order;
  await putLocal('orders', provisional);
  localSettings.nextOrderNumber += 1;
  await putLocal('settings', localSettings);
  if (cloudActive()) await queue('orders', 'create-order', provisional);
  return provisional;
}

function mapOrderActionRequest(row: Record<string, unknown>): OrderActionRequest {
  return {
    id: String(row.id),
    businessId: String(row.business_id),
    orderId: String(row.order_id),
    action: row.action as OrderAction,
    reason: String(row.reason || ''),
    status: row.status as OrderActionRequest['status'],
    requestedBy: String(row.requested_by),
    requestedByName: String(row.requested_by_name || 'team member'),
    requestedAt: String(row.requested_at),
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : undefined,
    reviewedByName: row.reviewed_by_name ? String(row.reviewed_by_name) : undefined,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : undefined,
    reviewNote: row.review_note ? String(row.review_note) : undefined,
  };
}

export async function getOrderActionRequests() {
  if (!cloudActive() || !supabase || !navigator.onLine) return [] as OrderActionRequest[];
  const { data, error } = await supabase
    .from('order_action_requests')
    .select('id, business_id, order_id, action, reason, status, requested_by, requested_by_name, requested_at, reviewed_by, reviewed_by_name, reviewed_at, review_note')
    .order('requested_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => mapOrderActionRequest(row as Record<string, unknown>));
}

export async function requestOrderAction(orderId: string, action: OrderAction, reason: string) {
  if (!cloudActive() || !supabase || !navigator.onLine) throw new Error('connect to send this request to an owner');
  const { data, error } = await supabase.rpc('request_pos_order_action', { p_order_id: orderId, p_action: action, p_reason: reason.trim() });
  if (error) throw error;
  return mapOrderActionRequest(data as Record<string, unknown>);
}

export async function reviewOrderAction(requestId: string, decision: 'approved' | 'declined', note: string) {
  if (!cloudActive() || !supabase || !navigator.onLine) throw new Error('connect to review this request');
  const { data, error } = await supabase.rpc('review_pos_order_action', { p_request_id: requestId, p_decision: decision, p_note: note.trim() });
  if (error) throw error;
  return mapOrderActionRequest(data as Record<string, unknown>);
}

async function applyCloudOrderStatus(change: QueuedOrderStatus) {
  if (!supabase) throw new Error('supabase is not connected');
  const { data, error } = await supabase.rpc('change_pos_order_status', { p_order_id: change.id, p_status: change.status, p_pin: change.pin });
  if (error) throw error;
  const order = data as Order;
  await putLocal('orders', order);
  return order;
}

export async function changeOrderStatus(id: string, status: OrderStatus, pin: string) {
  if (status !== 'voided' && status !== 'refunded') throw new Error('invalid order status');
  if (cloudActive() && navigator.onLine) {
    return applyCloudOrderStatus({ id, status, pin });
  }
  const settings = await getSettings();
  if (cloudActive()) {
    if (!settings.offlinePinVerifier) throw new Error('offline manager pin is not ready. an owner must reconnect and save the manager pin once');
    if (!await verifyOfflinePin(pin, settings.offlinePinVerifier)) throw new Error('manager pin is incorrect');
  } else if (pin !== settings.managerPin) throw new Error('manager pin is incorrect');
  const order = await oneLocal<Order>('orders', id);
  if (!order) throw new Error('order not found');
  order.status = status;
  await putLocal('orders', order);
  if (cloudActive()) await queue('orders', 'change-order-status', { id, status, pin } satisfies QueuedOrderStatus);
  return order;
}

export async function updateManagerPin(pin: string) {
  if (cloudActive() && supabase) {
    if (!navigator.onLine) throw new Error('connect to update the manager pin');
    const offlinePinVerifier = await createOfflinePinVerifier(pin);
    const { error } = await supabase.rpc('set_manager_pin', { p_pin: pin, p_offline_verifier: offlinePinVerifier });
    if (error) throw error;
    const settings = await getSettings();
    settings.managerPin = '';
    settings.offlinePinVerifier = offlinePinVerifier;
    await putLocal('settings', settings);
    return;
  }
  const settings = await getSettings();
  settings.managerPin = pin;
  await putLocal('settings', settings);
}

export async function flushOutbox() {
  if (!cloudActive() || !navigator.onLine) return 0;
  const records = (await allLocal<OutboxRecord>('outbox')).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  let synced = 0;
  for (const record of records) {
    try {
      if (record.operation === 'create-order') await createCloudOrder(record.value as Order);
      else if (record.operation === 'inventory-adjustment') await applyCloudInventoryAdjustment(record.value as InventoryAdjustment);
      else if (record.operation === 'change-order-status') await applyCloudOrderStatus(record.value as QueuedOrderStatus);
      else if (record.operation === 'delete') await deleteCloudCatalogItem(record.storeName as CatalogStore, (record.value as { id: string }).id);
      else await upsertCloud(record.storeName, record.value);
      await deleteLocal('outbox', record.id);
      synced += 1;
    } catch (error) {
      if (isOfflineFailure(error)) break;
      if (record.operation === 'delete') { console.warn('catalog deletion is waiting for server permission', error); continue; }
      throw error;
    }
  }
  return synced;
}

export async function getPendingSyncState(): Promise<PendingSyncState> {
  const records = await allLocal<OutboxRecord>('outbox');
  return {
    count: records.length,
    orderIds: records.filter((record) => record.operation === 'create-order' || record.operation === 'change-order-status').map((record) => (record.value as { id: string }).id),
  };
}

export async function syncFromCloud() {
  if (!supabase || !cloudProfile) return;
  await flushOutbox();
  const [productResult, modifierResult, priceResult, orderResult, settingsResult] = await Promise.all([
    supabase.from('products').select('payload').order('updated_at'),
    supabase.from('modifiers').select('payload').order('updated_at'),
    supabase.from('price_lists').select('payload').order('updated_at'),
    supabase.from('orders').select('payload').order('created_at'),
    supabase.from('business_settings').select('payload, next_order_number').eq('business_id', cloudProfile.businessId).single(),
  ]);
  const error = productResult.error || modifierResult.error || priceResult.error || orderResult.error || settingsResult.error;
  if (error) throw error;
  const cloudSettings = { ...(settingsResult.data.payload as unknown as Settings), nextOrderNumber: settingsResult.data.next_order_number, managerPin: '' };
  await Promise.all([
    replaceLocal('products', (productResult.data || []).map((row) => optimizeProductImage(row.payload as unknown as Product))),
    replaceLocal('modifiers', (modifierResult.data || []).map((row) => row.payload as unknown as Modifier)),
    replaceLocal('priceLists', (priceResult.data || []).map((row) => row.payload as unknown as PriceList)),
    replaceLocal('orders', (orderResult.data || []).map((row) => compactOrder(row.payload as unknown as Order))),
    replaceLocal('settings', [cloudSettings]),
  ]);
}

export async function getProducts() { return (await allLocal<Product>('products')).map(optimizeProductImage); }
export async function getModifiers() { return allLocal<Modifier>('modifiers'); }
export async function getOrders() { return (await allLocal<Order>('orders')).map(compactOrder); }
export async function getPriceLists() { return allLocal<PriceList>('priceLists'); }
export async function getSettings() { return (await oneLocal<Settings>('settings', 'main'))!; }

export async function initializeStore() {
  await openDatabase();
  await getDeviceIdentity();
  if ((await getProducts()).length === 0) await Promise.all(seedProducts.map((item) => putLocal('products', item)));
  if ((await getModifiers()).length === 0) await Promise.all(seedModifiers.map((item) => putLocal('modifiers', item)));
  const savedProducts = await getProducts();
  if ((await getPriceLists()).length === 0) {
    const tasting: PriceList = { id: 'tasting', name: 'the tasting run', prices: Object.fromEntries(savedProducts.map((item) => [item.id, item.price])), archived: false, createdAt: now };
    const standard: PriceList = { id: 'standard', name: 'standard pricing', prices: Object.fromEntries(savedProducts.map((item) => [item.id, item.standardPrice])), archived: false, createdAt: now };
    await Promise.all([putLocal('priceLists', tasting), putLocal('priceLists', standard)]);
  }
  const currentSettings = await oneLocal<Settings & { priceMode?: 'tasting' | 'standard' }>('settings', 'main');
  if (!currentSettings) await putLocal('settings', seedSettings);
  else if (!currentSettings.activePriceListId) {
    currentSettings.activePriceListId = currentSettings.priceMode === 'standard' ? 'standard' : 'tasting';
    await putLocal('settings', currentSettings);
  }
}

export async function exportBackup() {
  return { version: 3, exportedAt: new Date().toISOString(), products: await getProducts(), modifiers: await getModifiers(), priceLists: await getPriceLists(), orders: await getOrders(), settings: await getSettings(), approvalRequests: await getOrderActionRequests().catch(() => []) };
}

export async function importBackup(data: unknown) {
  const backup = data as { products?: Product[]; modifiers?: Modifier[]; priceLists?: PriceList[]; orders?: Order[]; settings?: Settings };
  if (!Array.isArray(backup.products) || !Array.isArray(backup.orders) || !backup.settings) throw new Error('invalid backup');
  await Promise.all(backup.products.map((item) => save('products', item)));
  await Promise.all((backup.modifiers || []).map((item) => save('modifiers', item)));
  await Promise.all((backup.priceLists || []).map((item) => save('priceLists', item)));
  await Promise.all(backup.orders.map((item) => save('orders', item)));
  await save('settings', backup.settings);
}
