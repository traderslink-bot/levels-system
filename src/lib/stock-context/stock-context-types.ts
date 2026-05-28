import type { FinnhubThreadPreview } from "./finnhub-client.js";
import type { YahooStockContext } from "./yahoo-client.js";

export type StockContextPreview = FinnhubThreadPreview & {
  yahoo?: YahooStockContext | null;
};

export type StockContextProvider = {
  getThreadPreview(symbolInput: string): Promise<StockContextPreview>;
};
