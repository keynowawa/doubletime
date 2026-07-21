export type Product = {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  price: number;
  standardPrice: number;
  image: string;
  modifierIds: string[];
  soldOut: boolean;
  archived: boolean;
  createdAt: string;
};

export type Modifier = {
  id: string;
  sku: string;
  name: string;
  price: number;
  archived: boolean;
  createdAt: string;
};

export type PriceList = {
  id: string;
  name: string;
  prices: Record<string, number>;
  archived: boolean;
  createdAt: string;
};

export type PaymentMethod = 'cash' | 'gcash' | 'maya' | 'qrph' | 'card' | 'bank';

export type Discount = {
  type: 'percent' | 'fixed';
  value: number;
  label: string;
};

export type CartLine = {
  id: string;
  product: Product;
  modifiers: Modifier[];
  unitPrice: number;
  quantity: number;
};

export type OrderStatus = 'completed' | 'voided' | 'refunded';

export type Order = {
  id: string;
  number: number;
  createdAt: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  priceListId?: string;
  priceListName?: string;
  customerName: string;
  note: string;
  lines: CartLine[];
  subtotal: number;
  discount: number;
  discountLabel: string;
  tax: number;
  taxName: string;
  total: number;
  cashReceived?: number;
  createdBy?: string;
  createdByName?: string;
};

export type Settings = {
  id: 'main';
  activePriceListId: string;
  taxEnabled: boolean;
  taxName: string;
  taxRate: number;
  taxInclusive: boolean;
  nextOrderNumber: number;
  managerPin: string;
};

export type UserRole = 'owner' | 'staff';

export type PosProfile = {
  id: string;
  businessId: string;
  email: string;
  displayName: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
};
