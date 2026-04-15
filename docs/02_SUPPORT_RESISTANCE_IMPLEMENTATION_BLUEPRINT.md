# Support and Resistance Implementation Blueprint

## Recommended module structure

```text
src/
  lib/
    market-data/
      candle-types.ts
      candle-normalizer.ts
      candle-fetch-service.ts

    levels/
      level-types.ts
      level-config.ts
      swing-detector.ts
      raw-level-candidate-builder.ts
      special-level-builder.ts
      level-clusterer.ts
      level-scorer.ts
      level-ranker.ts
      level-engine.ts

  scripts/
    run-manual-level-test.ts
```
