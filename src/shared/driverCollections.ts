export interface DriverCollectionsReport {
  startDate: string;
  endDate: string;
  driverId: number;
  totalPence: number;
  stores: Array<{ storeId: number | null; storeName: string; amountPence: number; receipts: number }>;
}
