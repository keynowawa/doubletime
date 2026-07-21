import { isCloudConfigured, supabase } from './pos-auth';
import type { Modifier, Order, OrderStatus, PosProfile, PriceList, Product, Settings } from './pos-types';

const DB_NAME = 'doubletime-pos';
const DB_VERSION = 3;
const entityStores = ['products', 'modifiers', 'orders', 'settings', 'priceLists'] as const;
const stores = [...entityStores, 'outbox'] as const;
type EntityStore = (typeof entityStores)[number];
type StoreName = (typeof stores)[number];
type CloudOperation = 'upsert' | 'create-order';
type OutboxRecord = { id: string; storeName: EntityStore; operation: CloudOperation; value: unknown; queuedAt: string };

const now = new Date().toISOString();
const seedProducts: Product[] = [
  { id: 'classic', sku: 'DT-MAT-CLS', name: 'classic matcha', description: 'smooth, sweet, and umami', category: 'matcha', price: 140, standardPrice: 190, image: '/assets/cocoloco-front-view.webp', modifierIds: ['oat','strawberry','mango','strawberry-mango','sweetener'], soldOut: false, archived: false, createdAt: now },
  { id: 'stay-salty', sku: 'DT-MAT-SLT', name: 'stay salty', description: 'matcha with sea salt cream', category: 'matcha', price: 160, standardPrice: 210, image: '/assets/DT-MAT-SLT-pos.webp', modifierIds: ['oat','sweetener'], soldOut: false, archived: false, createdAt: now },
  { id: 'coco-loco', sku: 'DT-MAT-COC', name: 'coco loco', description: 'matcha with coconut milk', category: 'matcha', price: 170, standardPrice: 220, image: '/assets/cocoloco-front-view.webp', modifierIds: ['oat','sweetener'], soldOut: false, archived: false, createdAt: now },
  { id: 'berry-cute', sku: 'DT-MAT-BRY', name: 'berry cute', description: 'strawberry matcha', category: 'matcha', price: 170, standardPrice: 220, image: '/assets/22.webp', modifierIds: ['oat','mango','sweetener'], soldOut: false, archived: false, createdAt: now },
  { id: 'golden-hour', sku: 'DT-MAT-GLD', name: 'golden hour', description: 'mango matcha', category: 'matcha', price: 170, standardPrice: 220, image: '/assets/21.webp', modifierIds: ['oat','strawberry','sweetener'], soldOut: false, archived: false, createdAt: now },
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
const isOfflineFailure = (error: unknown) => !navigator.onLine || error instanceof TypeError || /network|fetch|offline/i.test(error instanceof Error ? error.message : String(error));
const cloudWriteTimeout = <T>(operation: PromiseLike<T>, milliseconds = 10000) => new Promise<T>((resolve, reject) => {
  const timeout = window.setTimeout(() => reject(new TypeError('cloud sync timed out')), milliseconds);
  Promise.resolve(operation).then(
    (value) => { window.clearTimeout(timeout); resolve(value); },
    (error) => { window.clearTimeout(timeout); reject(error); },
  );
});

export function connectCloud(profile: PosProfile | null) { cloudProfile = profile; }
export function usingCloud() { return cloudActive(); }

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
    value = await uploadProductImage(value as Product);
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
    const order = value as unknown as Order;
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

async function createCloudOrder(order: Order) {
  if (!supabase) throw new Error('supabase is not connected');
  const { data, error } = await supabase.rpc('create_pos_order', { p_order: order });
  if (error) throw error;
  const saved = data as Order;
  await putLocal('orders', saved);
  return saved;
}

export async function createOrder(order: Order) {
  if (cloudActive() && navigator.onLine) {
    try { return await createCloudOrder(order); }
    catch (error) { if (!isOfflineFailure(error)) throw error; }
  }
  const localSettings = await getSettings();
  const provisional = { ...order, number: localSettings.nextOrderNumber, syncStatus: 'pending' } as Order;
  await putLocal('orders', provisional);
  localSettings.nextOrderNumber += 1;
  await putLocal('settings', localSettings);
  if (cloudActive()) await queue('orders', 'create-order', provisional);
  return provisional;
}

export async function changeOrderStatus(id: string, status: OrderStatus, pin: string) {
  if (cloudActive() && supabase) {
    const { data, error } = await supabase.rpc('change_pos_order_status', { p_order_id: id, p_status: status, p_pin: pin });
    if (error) throw error;
    const order = data as Order;
    await putLocal('orders', order);
    return order;
  }
  const settings = await getSettings();
  if (pin !== settings.managerPin) throw new Error('manager pin is incorrect');
  const order = await oneLocal<Order>('orders', id);
  if (!order) throw new Error('order not found');
  order.status = status;
  await putLocal('orders', order);
  return order;
}

export async function updateManagerPin(pin: string) {
  if (cloudActive() && supabase) {
    const { error } = await supabase.rpc('set_manager_pin', { p_pin: pin });
    if (error) throw error;
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
      else await upsertCloud(record.storeName, record.value);
      await deleteLocal('outbox', record.id);
      synced += 1;
    } catch (error) {
      if (isOfflineFailure(error)) break;
      throw error;
    }
  }
  return synced;
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
    replaceLocal('products', (productResult.data || []).map((row) => row.payload as unknown as Product)),
    replaceLocal('modifiers', (modifierResult.data || []).map((row) => row.payload as unknown as Modifier)),
    replaceLocal('priceLists', (priceResult.data || []).map((row) => row.payload as unknown as PriceList)),
    replaceLocal('orders', (orderResult.data || []).map((row) => row.payload as unknown as Order)),
    replaceLocal('settings', [cloudSettings]),
  ]);
}

export async function getProducts() { return allLocal<Product>('products'); }
export async function getModifiers() { return allLocal<Modifier>('modifiers'); }
export async function getOrders() { return allLocal<Order>('orders'); }
export async function getPriceLists() { return allLocal<PriceList>('priceLists'); }
export async function getSettings() { return (await oneLocal<Settings>('settings', 'main'))!; }

export async function initializeStore() {
  await openDatabase();
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
  return { version: 2, exportedAt: new Date().toISOString(), products: await getProducts(), modifiers: await getModifiers(), priceLists: await getPriceLists(), orders: await getOrders(), settings: await getSettings() };
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
