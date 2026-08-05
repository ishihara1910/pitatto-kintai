export interface FLRatio {
  food: number; foodTarget: number;
  drink: number; drinkTarget: number;
  labor: number; laborTarget: number;
  total: number; totalTarget: number;
}

export interface DailyData {
  sales: number;
  deltaPrev: string;
  guests: number;
  lunch: number;
  dinner: number;
}

export interface StoreSummary {
  id: string;
  name: string;
  sales: number;
  guests: number;
  occupancy: number;
  avgSpend: number;
  delta: string;
  up: boolean;
  posConnected: boolean;
  daily?: DailyData;
  fl?: FLRatio;
}

export const STORES: StoreSummary[] = [
  {
    id: "shibuya", name: "DishBoard 渋谷店",
    sales: 1200000, guests: 680, occupancy: 82, avgSpend: 1764,
    delta: "+8.2%", up: true, posConnected: true,
    daily: { sales: 42000, deltaPrev: "+5.4%", guests: 24, lunch: 18000, dinner: 24000 },
    fl: { food: 28, foodTarget: 32, drink: 20, drinkTarget: 23, labor: 27, laborTarget: 23, total: 48, totalTarget: 55 },
  },
  {
    id: "shinjuku", name: "DishBoard 新宿店",
    sales: 980000, guests: 541, occupancy: 74, avgSpend: 1812,
    delta: "+3.1%", up: true, posConnected: false,
  },
];

export const TOTAL = {
  sales: STORES.reduce((s, x) => s + x.sales, 0),
  guests: STORES.reduce((s, x) => s + x.guests, 0),
  occupancy: Math.round(STORES.reduce((s, x) => s + x.occupancy, 0) / STORES.length),
  avgSpend: Math.round(STORES.reduce((s, x) => s + x.sales, 0) / STORES.reduce((s, x) => s + x.guests, 0)),
  delta: "+6.1%",
};

export function getStore(id: string) {
  return STORES.find((s) => s.id === id);
}
