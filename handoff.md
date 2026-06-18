# 2026-05-10

## Current Live Job

Nasdaq 5-year deep daily/4h backfill is running.

- Script: `npm run nasdaq:deep:backfill`
- Source file: `src/scripts/run-nasdaq-deep-daily-4h-backfill.ts`
- Live artifact folder: `artifacts/nasdaq-marketcap-universe/2026-05-10/nasdaq-deep-daily-4h-live-2026-05-10_12-46-16`
- Results file: `artifacts/nasdaq-marketcap-universe/2026-05-10/nasdaq-deep-daily-4h-live-2026-05-10_12-46-16/nasdaq-deep-daily-4h-backfill-results.jsonl`
- Plan file: `artifacts/nasdaq-marketcap-universe/2026-05-10/nasdaq-deep-daily-4h-live-2026-05-10_12-46-16/nasdaq-deep-daily-4h-backfill-plan.json`

## Job Configuration

- Universe: `data/nasdaq-universe/nasdaq-current-universe.json`
- Warehouse: `data/candles`
- Timeframes: `daily`, `4h`
- Lookbacks: `daily=1300`, `4h=6500`
- Completion thresholds: `daily>=1000`, `4h>=2500`
- Throttle: `10500ms`
- IBKR timeout: `600000ms`
- Order: all under-$500M Nasdaq first, then all remaining Nasdaq `$500M+` symbols.

## Plan Totals

- Total Nasdaq symbols: `2979`
- Under-$500M symbols: `1663`
- `$500M+` symbols: `1316`
- Total requests planned: `5958`
- Dry/build validation: `npm run build` passed before live launch.

## Last User-Facing Progress

Last reported progress:

- Completed symbols: `94`
- Fully fetched cleanly: `89`
- Completed with issues: `5`
- Touched/in-progress symbols: `95`
- Under-$500M remaining: `1569`
- Over-$500M completed: `0`
- Total remaining: `2885`
- Result rows: `189`
- Request statuses: `183 fetched`, `6 failed`
- Latest row at that check: `ALBT daily` fetched, `candleCount=1255`

## Progress Check Command

Run from repo root:

```powershell
node -e "const fs=require('fs'); const dir='artifacts/nasdaq-marketcap-universe/2026-05-10/nasdaq-deep-daily-4h-live-2026-05-10_12-46-16'; const plan=JSON.parse(fs.readFileSync(dir+'/nasdaq-deep-daily-4h-backfill-plan.json','utf8')); const p=dir+'/nasdaq-deep-daily-4h-backfill-results.jsonl'; const rows=fs.existsSync(p)?fs.readFileSync(p,'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse):[]; const tasks=new Map(plan.selectedTasks.map(t=>[t.symbol,t])); const bySym=new Map(); const byStatus={}; for(const r of rows){byStatus[r.status]=(byStatus[r.status]||0)+1; const v=bySym.get(r.symbol)||{segment:r.segment,statuses:{}}; v.statuses[r.timeframe]=r.status; bySym.set(r.symbol,v);} const completed=[...bySym.entries()].filter(([s,v])=>{const task=tasks.get(s); return task && task.fetchTimeframes.every(tf=>v.statuses[tf]);}); const fullyFetched=completed.filter(([s,v])=>Object.values(v.statuses).every(x=>x==='fetched')); const issue=completed.filter(([s,v])=>Object.values(v.statuses).some(x=>x!=='fetched')); const underCompleted=completed.filter(([s,v])=>v.segment==='under500').length; const overCompleted=completed.filter(([s,v])=>v.segment==='over500').length; const last=rows.at(-1); console.log(JSON.stringify({symbolsCompleted:completed.length,fullyFetchedSymbols:fullyFetched.length,issueCompletedSymbols:issue.length,symbolsTouched:bySym.size,resultRows:rows.length,under500Completed:underCompleted,under500Remaining:plan.totals.under500Symbols-underCompleted,over500Completed:overCompleted,totalRemaining:plan.totals.symbols-completed.length,byStatus,last,lastAgeMinutes:last?((Date.now()-last.timestamp)/60000).toFixed(1):null},null,2));"
```

Check whether the process is alive:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*run-nasdaq-deep-daily-4h-backfill.ts*' } | Select-Object ProcessId,Name,CommandLine
```

Tail logs:

```powershell
Get-Content artifacts\nasdaq-marketcap-universe\2026-05-10\nasdaq-deep-daily-4h-live-2026-05-10_12-46-16\stdout.log -Tail 40
Get-Content artifacts\nasdaq-marketcap-universe\2026-05-10\nasdaq-deep-daily-4h-live-2026-05-10_12-46-16\stderr.log -Tail 40
```

## Important Context

- The script was added specifically for deep history because existing Nasdaq backfill scripts use short coverage thresholds and would skip already-covered short-window symbols.
- If IBKR disconnects, stop the stale process and restart the same command. The script rescans the warehouse first, so completed symbol/timeframe pairs should be skipped once they meet the deep thresholds.
- IBKR Gateway had many client tabs after diagnostics. No active API TCP connection was seen when checked except live jobs; stale tabs can be cleared by restarting IB Gateway after jobs are done.
- Estimated storage for all Nasdaq + NYSE, 5 years daily + 4h: about `14 GB` raw JSONL, budget `18-22 GB` with filesystem overhead.
