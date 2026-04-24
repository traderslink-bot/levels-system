import "dotenv/config";

import {
  createFinnhubClientFromEnv,
} from "../lib/stock-context/finnhub-client.js";
import { formatFinnhubThreadPreview } from "../lib/stock-context/finnhub-thread-preview.js";

async function main(): Promise<void> {
  const symbols = process.argv.slice(2)
    .map((value) => value.trim().toUpperCase())
    .filter((value) => value.length > 0);
  const client = createFinnhubClientFromEnv();

  if (!client) {
    throw new Error(
      "FINNHUB_API_KEY is not set. Add FINNHUB_API_KEY to .env before running the Finnhub thread preview test.",
    );
  }

  const requestedSymbols = symbols.length > 0 ? symbols : ["AAPL"];

  for (const [index, symbol] of requestedSymbols.entries()) {
    const preview = await client.getThreadPreview(symbol);
    if (index > 0) {
      console.log("\n" + "=".repeat(80) + "\n");
    }
    console.log(formatFinnhubThreadPreview(preview));
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
