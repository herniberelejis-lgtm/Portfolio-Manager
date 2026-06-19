import { syncPrices } from '@/lib/market/priceSyncJob';

export async function POST() {
  const result = await syncPrices();
  return Response.json(result);
}
