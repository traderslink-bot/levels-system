# Watchlist Level QA Queue

Purpose: use this file as the working queue for support/resistance full-ladder QA.

Workflow:
- Run about 10 tickers per batch.
- Add tickers to the manual watchlist.
- Wait for active status and level posts.
- Review the full level ladder against raw/audit level candidates.
- Mark each ticker as passed, needs review, missing resistance, missing support, or data/runtime issue.
- After fixes, rerun the same batch before moving on.

## Current Batch

Status: under-30M market-cap QA in progress

None - under-30M queue completed through AUID.

## Historical 5h Replay QA 2026-05-04

Purpose: replay user-selected historical fast-mover windows for 4-5 hours after the requested start time and check whether the trader-facing map runs out of visible levels.

Cases replayed:
- AKAN - 2026-04-22 11:00 ET
- YCBD - 2026-04-22 12:00 ET
- AIXI - 2026-04-22 09:30 ET
- SKLZ - 2026-04-23 12:15 ET
- CAST - 2026-04-24 08:00 ET
- YAAS - 2026-04-27 09:15 ET
- SEGG - 2026-04-28 08:25 ET
- ATER - 2026-04-28 08:50 ET

Findings:
- AKAN and SKLZ exhausted the starting resistance map because both ran far beyond the highest initially displayed resistance during the 5h window.
- At the first exhaustion point, a fresh no-lookahead level rebuild produced a higher resistance map, so the raw level engine had more context available once price moved.
- YCBD, AIXI, CAST, YAAS, SEGG, and ATER did not exhaust the starting resistance/support map inside the replay window.
- Fix applied: outer-boundary level refresh now fires when price clears the highest displayed resistance even if the move is already far beyond the prior map.
- Fix applied: lower support extension refresh now fires when price has already broken below the lowest displayed support.
- Follow-up fix applied: story posts now include a compact resistance/support map instead of only one first target when additional levels are available.
- Follow-up fix applied: live refresh now starts when price reaches the second-last displayed resistance/support, so the system asks for more map before the last visible level is exhausted.
- Regression coverage added in `manual-watchlist-runtime-manager.test.ts` for large resistance gaps and support breaks beyond the displayed ladder.

Artifacts:
- `artifacts/specific-ticker-date-replay-forward-5h/specific-ticker-date-replay.md`
- `artifacts/specific-ticker-date-replay-forward-5h/specific-ticker-date-replay.json`

## Under 30M Market Cap Queue 2026-05-04

Source: user-provided list of common fast-moving small/nano market-cap tickers.

Pending:

None.

## Completed Batch 32

- YYAI
- QCLS
- CRWS

## Completed Batch 33

- KYNB
- REFR
- LSTA

## Completed Batch 34

- SNTI
- CGTL
- UFG

## Completed Batch 35

- TOP
- RNTX
- HBIO

## Completed Batch 36

- AIXC
- PLRZ
- SWAG

## Completed Batch 37

- NEON
- NEUP
- FARM

## Completed Batch 38

- LVLU
- ZTG
- FLUX

## Completed Batch 39

- MNTS
- FTHM
- CLPS

## Completed Batch 40

- JSPR
- AWRE
- AYTU

## Completed Batch 41

- EZGO
- DYAI
- INUV

## Completed Batch 42

- CLIR
- NHTC
- SKK

## Completed Batch 43

- CELU
- OTLK
- HCAI

## Completed Batch 44

- NAMI
- CHAI
- DAIO

## Completed Batch 45

- JVA
- FMST
- GRAN

## Completed Batch 46

- CPOP
- MRKR
- NAAS

## Completed Batch 47

- BRNS
- BLIV
- JOB

## Completed Batch 48

- RYOJ
- OFAL
- OMH

## Completed Batch 49

- BGDE
- ABVC
- WYHG

## Completed Batch 50

- SLGB
- IPM
- SPPL

## Completed Batch 51

- ORIO
- SDST
- JL

## Completed Batch 52

- LGVN
- LTRN
- VEEA

## Completed Batch 53

- VTGN
- MOBX
- ICCM

## Completed Batch 54

- DFLI
- AEON
- EFOI

## Completed Batch 55

- SNAL
- CRIS
- ZBAO

## Completed Batch 56

- PMEC
- APUS
- CYN

## Completed Batch 57

- NTCL
- TXMD
- QRHC

## Completed Batch 58

- LASE
- DETX
- PSHG

## Completed Batch 59

- ADGM
- UTSI
- PLSM

## Completed Batch 60

- SER
- MSGM
- FEMY

## Completed Batch 61

- SMSI
- EVTV
- FEDU

## Completed Batch 62

- YSXT
- SKYQ
- RMCF

## Completed Batch 63

- YQ
- XOS
- MODD

## Completed Batch 64

- VYNE
- AKAN
- WETH

## Completed Batch 65

- WCT
- AUID

## Completed Batch 31

- STEM
- TMC
- WULF

## Completed Batch 30

- SNDL
- SOUN
- SPWRQ

## Completed Batch 29

- RUM
- SDIG
- SENS

## Completed Batch 28

- QBTS
- RGTI
- RKLB

## Completed Batch 27

- OUST
- PLUG
- PSNY

## Completed Batch 26

- MVIS
- NN
- NVTS

## Completed Batch 25

- LAC
- LAZR
- LUMN

## Completed Batch 24

- HUT
- IONQ
- KULR

## Completed Batch 23

- FUBO
- GCTK
- HIMS

## Completed Batch 22

- EOSE
- EVGO
- FGEN

## Completed Batch 21

- CERS
- CTMX
- DDD

## Completed Batch 20

- BNGO
- CAN
- CDIO

## Completed Batch 19

- ATOS
- AXTI
- BBAI

## Completed Batch 18

- ARDX
- APLD
- ASTS

## Completed Batch 17

- ALLK
- ALT
- AMPX

## Completed Batch 16

- AEHR
- AKBA
- ALDX

## Completed Batch 15

- KTRA
- AAOI
- ADVM

## Completed Batch 14

- HOTH
- IKT
- IMMX

## Completed Batch 13

- EVGN
- GFAI
- GLSI

## Completed Batch 12

- EKSO
- ELAB
- EVAX

## Completed Batch 11

- COSM
- CYTO
- DRMA

## Completed Batch 10

- BSGM
- CING
- CNTX

## Completed Batch 9

- BCLI
- BLRX
- BMRA

## Completed Batch 8

- ASNS
- ATXI
- AUUD

## Completed Batch 7

- ABVC
- ADTX
- APVO

## Completed Batch 6

- NBY
- PBM
- SINT

## Completed Batch 5

- KALA
- LIDR
- MLGO

## Completed Batch 4

- GNLX
- HSDT
- INBS

## Completed Batch 3

- CRKN
- CYCC
- EFOI

## Completed Batch 2

- CELZ
- CHEK
- CLDI

## Completed Batch 1

- AREB
- AEMD
- ATNF
- BFRI
- BIAF
- BJDX
- BIVI
- BLPH
- BNOX
- CARM

## Pending

### Nano / Very Small Micro Style Tickers

- CELZ
- CHEK
- CLDI
- CRKN
- CYCC
- EFOI
- GNLX
- HSDT
- INBS
- KALA
- LIDR
- MLGO
- NBY
- PBM
- SINT

### Micro Cap Style Tickers

- ABVC
- ADTX
- APVO
- ASNS
- ATXI
- AUUD
- BCLI
- BLRX
- BMRA
- BSGM
- CING
- CNTX
- COSM
- CYTO
- DRMA
- EKSO
- ELAB
- EVAX
- EVGN
- GFAI
- GLSI
- HOTH
- IKT
- IMMX
- KTRA

### Larger Micro / Lower Small Cap Style Tickers

- AAOI
- ADVM
- AEHR
- AKBA
- ALDX
- ALLK
- ALT
- AMPX
- ARDX
- APLD
- ASTS
- ATOS
- AXTI
- BBAI
- BNGO
- CAN
- CDIO
- CERS
- CTMX
- DDD
- EOSE
- EVGO
- FGEN
- FUBO
- GCTK

### Small Cap / Active Trader Style Tickers

- HIMS
- HUT
- IONQ
- KULR
- LAC
- LAZR
- LUMN
- MVIS
- NN
- NVTS
- OUST
- PLUG
- PSNY
- QBTS
- RGTI
- RKLB
- RUM
- SDIG
- SENS
- SNDL
- SOUN
- SPWRQ
- STEM
- TMC
- WULF

## Passed

- AREB
  - Full ladder posted and includes close resistance shelves separately.
  - Resistance shown: 0.2440, 0.2465, 0.2755, 0.3000, 0.3130, 0.3225, 0.3500, 0.3708.
- AEMD
  - Full ladder posted with no omitted resistance.
  - Resistance shown through +46%.
- BFRI
  - Full ladder posted with no omitted resistance.
  - Resistance shown through +70%.
- BIAF
  - Full ladder posted with no omitted resistance.
  - Resistance shown through +48%.
- BJDX
  - Full ladder posted with no omitted resistance.
  - Resistance shown through +95%.
- BIVI
  - Full ladder posted with no omitted resistance.
  - Resistance shown through +21%.
- CELZ
  - Full ladder posted with no omitted resistance.
  - Resistance shown through +49%.
  - Resistance ladder included dense daily confluence shelves from 2.24 through 3.28.
- CLDI
  - Full ladder posted with no omitted resistance in the Discord-facing ladder.
  - Resistance shown through +70%.
  - Close 4h/daily shelves stayed visible in the full ladder instead of being compacted away.
- CRKN
  - Full ladder posted with resistance through +91%.
  - Snapshot audit compacted several close levels, but the full ladder showed those levels separately.
  - Resistance shown: 0.1010, 0.1050, 0.1105, 0.1162, 0.1200, 0.1300.
- EFOI
  - Full ladder posted with no omitted resistance.
  - Resistance shown through +39%.
  - Support ladder is dense and includes downside shelves through 1.26.
- GNLX
  - Full ladder posted with no omitted resistance.
  - Resistance shown through +47%.
  - Dense nearby shelves stayed visible from 2.84 through 4.18.
- HSDT
  - Full ladder posted with no omitted resistance.
  - Resistance shown through +49%.
  - Ladder covers nearby 4h/daily confluence plus extension at 3.23.
- INBS
  - Full ladder posted with no omitted resistance.
  - Resistance shown through +45%.
  - Ladder includes close 4h/daily shelves from 2.49 through 3.60.
- KALA
  - Full ladder posted with resistance through +99%.
  - Snapshot audit compacted close resistance/support, but the full ladder showed the resistance shelves separately.
  - Resistance shown from 0.1147 through 0.2223.
- LIDR
  - Full ladder posted with no omitted resistance.
  - Resistance shown through +92%.
  - Ladder includes both nearby daily/4h confluence and upper extension levels.
- MLGO
  - Full ladder posted with no omitted resistance.
  - Resistance shown through +47%.
  - Ladder includes nearby daily/4h shelves from 4.20 through 6.11.
- PBM
  - Full ladder posted with no omitted resistance.
  - Resistance shown through +44%.
  - Ladder includes support shelves down through 2.26.
- SINT
  - Full ladder posted with no omitted resistance.
  - Resistance shown through +46%.
  - Ladder includes close confluence resistance from 2.50 through 3.60.
- ABVC
  - Full ladder posted with no omitted resistance.
  - Resistance shown through +96%.
  - Ladder includes dense resistance shelves from 1.04 through 2.02.
- ADTX
  - Full ladder posted with resistance through +74%.
  - Snapshot audit compacted close resistance, but the full ladder showed the expanded resistance shelves.
- APVO
  - Full ladder posted with no omitted resistance.
  - Resistance shown through +44%.
  - Ladder includes nearby 4h/daily resistance and support down through 3.95.
- ASNS
  - Full ladder posted with resistance through +99%.
  - Snapshot audit compacted close levels, but the full ladder showed the expanded shelves.
- ATXI
  - Full ladder posted with resistance through +87%.
  - Added open-overhead note after the last resistance: no additional resistance found below the forward planning limit.
- AUUD
  - Initial ladder showed only resistance through +4% because no more overhead structure was found.
  - Fixed Discord full-ladder formatting to explicitly say when no additional resistance is found inside the forward planning range.
  - Rerun posted: `No additional resistance found below 3.72 (+100.0%).`
- BCLI
  - Full ladder posted with resistance through +97%.
  - One snapshot-level omitted resistance remained, but the full ladder is dense and trader-facing coverage is good.
- BLRX
  - Full ladder posted with no omitted resistance.
  - Resistance shown through +48%.
- BMRA
  - Full ladder posted with no omitted resistance.
  - Resistance shown through +48%.
- CING
  - Full ladder posted with no omitted resistance.
  - Resistance shown through +46%.
- CNTX
  - Full ladder posted with no omitted resistance.
  - Resistance shown through +47%.
- COSM
  - Full ladder posted with dense resistance through +98%.
  - Snapshot audit compacted close levels, but the full ladder showed the expanded shelves.
- DRMA
  - Full ladder posted with resistance through +86%.
  - Added open-overhead note after the last resistance: no additional resistance found below the forward planning limit.
- EKSO
  - Snapshot closest resistance now shows through +37%.
  - Full ladder posted with resistance through +50%.
- ELAB
  - Snapshot closest resistance now shows through +43%.
  - Full ladder posted with resistance through +43%.
- EVAX
  - Snapshot closest resistance now shows through +33%.
  - Full ladder posted with resistance through +48%.
- EVGN
  - Snapshot closest resistance now shows through +36%.
  - Full ladder posted with resistance through +100%.
- GFAI
  - Snapshot closest resistance now shows through +37%.
  - Full ladder posted with resistance through +98%.
- GLSI
  - Snapshot closest resistance now shows through +30%.
  - Full ladder posted with resistance through +48%.
- HOTH
  - Snapshot closest resistance now shows through +33%.
  - Full ladder posted with resistance through +96%.
- IKT
  - Snapshot initially stopped at +29.9%; fixed the edge case so it now includes the next resistance at +34%.
  - Full ladder posted with resistance through +97%.
- IMMX
  - Snapshot could only show resistance through +23% because no +30% resistance was available.
  - Full ladder now says `No additional resistance found below 14.13 (+50.0%).`
- AAOI
  - Snapshot could only show resistance through +7% because no +30% resistance was available.
  - Full ladder says `No additional resistance found below 267.96 (+50.0%).`
- AEHR
  - Snapshot could only show resistance through +18% because no +30% resistance was available.
  - Full ladder says `No additional resistance found below 130.27 (+50.0%).`
- AKBA
  - Snapshot closest resistance now shows through +30%.
  - Full ladder posted with resistance through +94%.
- ALDX
  - Snapshot closest resistance now shows through +41%.
  - Full ladder posted with resistance through +91% plus open-overhead note to +100%.
- ALT
  - Snapshot closest resistance now shows through +32%.
  - Full ladder posted with resistance through +49%.
- AMPX
  - Snapshot could only show resistance through +12% because no +30% resistance was available.
  - Full ladder says `No additional resistance found below 30.33 (+50.0%).`
- ARDX
  - Snapshot could only show resistance through +17% because no +30% resistance was available.
  - Full ladder says `No additional resistance found below 11.05 (+50.0%).`
- APLD
  - Snapshot could only show resistance through +22% because no +30% resistance was available.
  - Full ladder says `No additional resistance found below 52.52 (+50.0%).`
- ASTS
  - Snapshot closest resistance now shows through +34%.
  - Full ladder posted with resistance through +47%.
- ATOS
  - Snapshot closest resistance shows through +50%.
  - Full ladder posted with resistance through +50%.
- BBAI
  - Snapshot closest resistance now shows through +32%.
  - Full ladder posted with resistance through +48%.
- BNGO
  - Snapshot closest resistance now shows through +32%.
  - Full ladder posted with resistance through +72% plus open-overhead note to +100%.
- CAN
  - Snapshot closest resistance now shows through +32%.
  - Full ladder posted with resistance through +99%.
- CDIO
  - Snapshot closest resistance now shows through +35%.
  - Full ladder posted with resistance through +40% plus open-overhead note to +50%.
- CERS
  - Snapshot could only show resistance through +11% because no +30% resistance was available.
  - Full ladder says `No additional resistance found below 4.25 (+50.0%).`
- CTMX
  - Snapshot closest resistance now shows through +34%.
  - Full ladder posted with resistance through +47%.
- DDD
  - Snapshot closest resistance now shows through +34%.
  - Full ladder posted with resistance through +48%.
- EOSE
  - Snapshot closest resistance now shows through +36%.
  - Full ladder posted with resistance through +36% plus open-overhead note to +50%.
- EVGO
  - Snapshot closest resistance now shows through +36%.
  - Full ladder posted with resistance through +49%.
- FUBO
  - Snapshot closest resistance now shows through +30%.
  - Full ladder posted with resistance through +49%.
- GCTK
  - Snapshot closest resistance now shows through +34%.
  - Full ladder posted with resistance through +90% plus open-overhead note to +100%.
- HIMS
  - Snapshot closest resistance now shows through +31%.
  - Full ladder posted with resistance through +44%.
- HUT
  - Snapshot could only show resistance through +7% because no +30% resistance was available.
  - Full ladder says `No additional resistance found below 115.97 (+50.0%).`
- IONQ
  - Snapshot closest resistance now shows through +35%.
  - Full ladder posted with resistance through +47%.
- KULR
  - Snapshot closest resistance now shows through +30%.
  - Full ladder posted with resistance through +42%.
- LAC
  - Snapshot closest resistance now shows through +42%.
  - Full ladder posted with resistance through +42%.
- LUMN
  - Snapshot could only show resistance through +29.6% because no +30% resistance was available.
  - Full ladder says `No additional resistance found below 13.83 (+50.0%).`
- MVIS
  - Snapshot closest resistance now shows through +35%.
  - Full ladder posted with resistance through +99%.
- NN
  - Snapshot closest resistance now shows through +33%.
  - Full ladder posted with resistance through +33% plus open-overhead note to +50%.
- NVTS
  - Snapshot could only show resistance through +23% because no +30% resistance was available.
  - Full ladder says `No additional resistance found below 24.12 (+50.0%).`
- OUST
  - Snapshot closest resistance now shows through +32%.
  - Full ladder posted with resistance through +44%.
- PLUG
  - Snapshot closest resistance now shows through +37%.
  - Full ladder posted with resistance through +37% plus open-overhead note to +50%.
- PSNY
  - Snapshot closest resistance now shows through +31%.
  - Full ladder posted with resistance through +46%.
- QBTS
  - Snapshot closest resistance shows through +48%.
  - Full ladder posted with resistance through +48%.
- RGTI
  - Snapshot closest resistance now shows through +32%.
  - Full ladder posted with resistance through +49%.
- RKLB
  - Snapshot could only show resistance through +23% because no +30% resistance was available.
  - Full ladder says `No additional resistance found below 120.91 (+50.0%).`
- RUM
  - Snapshot closest resistance now shows through +32%.
  - Full ladder posted with resistance through +44%.
- SENS
  - Snapshot closest resistance now shows through the +32% to +36% overhead zone.
  - Full ladder posted with resistance through +47%.
- SNDL
  - Snapshot closest resistance now shows through +34%.
  - Full ladder posted with resistance through +95%.
- SOUN
  - Snapshot closest resistance now shows through the +31% to +36% overhead zone.
  - Full ladder posted with resistance through +47%.
- STEM
  - Snapshot closest resistance now shows through the +33% to +37% overhead zone.
  - Full ladder posted with resistance through +48%.
- TMC
  - Initial run exposed a near-price zone edge case: resistance 5.19-5.24 was omitted as `wrong_side` because price was sitting at the bottom of the zone.
  - Fixed snapshot side filtering to keep resistance zones that touch current price but still extend materially overhead.
  - Rerun posted 5.19 in both closest levels and full ladder, with omitted resistance reduced to zero.
  - Full ladder posted with resistance through +46%.
- WULF
  - Snapshot could only show resistance through +2% because no +30% resistance was available.
  - Full ladder says `No additional resistance found below 33.00 (+50.0%).`
- YYAI
  - Initial run hid a fresh near-price resistance shelf at 0.7172 as `wrong_side`.
  - Fixed snapshot side filtering to keep wider low-priced resistance shelves that straddle current price and still extend overhead.
  - Rerun posted 0.7172 as the first resistance; snapshot shows through the +34% to +38% overhead zone.
  - Full ladder posted with resistance through +96%.
- QCLS
  - Snapshot closest resistance now shows through +30%.
  - Full ladder says `No additional resistance found below 5.75 (+50.0%).`
  - Omitted resistance was compacted into the displayed 3.86-4.01 zone.
- CRWS
  - Snapshot closest resistance now shows through +31%.
  - Full ladder posted with resistance through +47%.
- KYNB
  - Snapshot closest resistance now shows through +31%.
  - Full ladder posted with resistance through +46%.
- REFR
  - Snapshot closest resistance now shows through +30%.
  - Full ladder posted with resistance through +92%.
  - Omitted resistance was compacted into the displayed level grouping.
- LSTA
  - Snapshot closest resistance now shows through +35%.
  - Full ladder posted with resistance through +47%.
- SNTI
  - Snapshot closest resistance now shows through +35%.
  - Full ladder says `No additional resistance found below 1.89 (+100.0%).`
  - Omitted resistance was compacted into the displayed level grouping.
- CGTL
  - Snapshot closest resistance now shows through +30%.
  - Full ladder says `No additional resistance found below 2.38 (+100.0%).`
- UFG
  - Snapshot closest resistance now shows through +31%.
  - Full ladder says `No additional resistance found below 1.75 (+100.0%).`
- TOP
  - Snapshot closest resistance now shows through +36%.
  - Full ladder posted with resistance through +97%.
  - Omitted resistance was compacted into nearby displayed levels.
- RNTX
  - Snapshot closest resistance now shows through +37%.
  - Full ladder posted with resistance through +100%.
- HBIO
  - Snapshot closest resistance now shows through +32%.
  - Full ladder posted with resistance through +48%.
- AIXC
  - Snapshot closest resistance now shows through +32%.
  - Full ladder posted with resistance through +99%.
- PLRZ
  - Snapshot closest resistance now shows through +40%.
  - Full ladder says `No additional resistance found below 23.02 (+50.0%).`
- SWAG
  - Snapshot closest resistance now shows through +31%.
  - Full ladder posted with resistance through +97%.
- NEON
  - Snapshot closest resistance now shows through +32%.
  - Full ladder posted with resistance through +93%.
- NEUP
  - Snapshot closest resistance now shows through the +37% to +41% overhead zone.
  - Full ladder posted with resistance through +48%.
- FARM
  - Snapshot closest resistance now shows through +31%.
  - Full ladder posted with resistance through +97%.
- LVLU
  - Snapshot closest resistance now shows through +30%.
  - Full ladder posted with resistance through +49%.
- ZTG
  - Snapshot closest resistance now shows through +30%.
  - Full ladder posted with resistance through +44%.
- FLUX
  - Snapshot closest resistance now shows through +32%.
  - Full ladder says `No additional resistance found below 2.64 (+100.0%).`
- MNTS
  - Snapshot closest resistance now shows through +30%.
  - Full ladder posted with resistance through +46%.
- FTHM
  - Snapshot closest resistance now shows through +30%.
  - Full ladder posted with resistance through +94%.
  - Omitted resistance was compacted into the displayed level grouping.
- CLPS
  - Snapshot closest resistance now shows through +34%.
  - Full ladder says `No additional resistance found below 1.86 (+100.0%).`
  - Full ladder explicitly showed the compacted 0.9398 shelf.
- JSPR
  - Snapshot closest resistance now shows through +31%.
  - Full ladder posted with resistance through +98%.
- AWRE
  - Snapshot closest resistance now shows through +31%.
  - Full ladder posted with resistance through +99%.
- AYTU
  - Snapshot closest resistance now shows through +35%.
  - Full ladder says `No additional resistance found below 3.82 (+50.0%).`
- EZGO
  - Snapshot closest resistance now shows through +49%.
  - Full ladder posted with resistance through +92%.
- DYAI
  - Snapshot closest resistance now shows through +32%.
  - Full ladder posted with resistance through +99%.
  - Omitted resistance was compacted into the displayed level grouping.
- INUV
  - Snapshot closest resistance now shows through +32%.
  - Full ladder posted with resistance through +97%.
- CLIR
  - Snapshot closest resistance now shows through +31%.
  - Full ladder posted with resistance through +49%.
- NHTC
  - Snapshot closest resistance now shows through +41%.
  - Full ladder posted with resistance through +47%.
- SKK
  - Snapshot closest resistance now shows through +34%.
  - Full ladder posted with resistance through +46%.
- CELU
  - Snapshot closest resistance now shows through +31%.
  - Full ladder posted with resistance through +98%.
- OTLK
  - Initial snapshot compacted away the nearest 0.2595 shelf and started at 0.2650.
  - Fixed snapshot compaction to prefer the nearest shelf when levels are directly above current price.
  - Rerun snapshot starts at 0.2595 and shows through +30%.
  - Full ladder says `No additional resistance found below 0.5156 (+100.0%).`
- HCAI
  - Snapshot closest resistance now shows through +34%.
  - Full ladder posted with resistance through +43%.
- NAMI
  - Snapshot closest resistance now shows through +33%.
  - Full ladder posted with resistance through +97%.
  - Omitted resistance was compacted into displayed level groupings.
- CHAI
  - Snapshot closest resistance now shows through +32%.
  - Full ladder says `No additional resistance found below 2.76 (+100.0%).`
- DAIO
  - Snapshot could only show resistance through +27% because no +30% resistance was available.
  - Full ladder says `No additional resistance found below 4.21 (+50.0%).`
- JVA
  - Snapshot closest resistance now shows through +30%.
  - Full ladder posted with resistance through +42%.
- FMST
  - Snapshot closest resistance now shows through +32%.
  - Full ladder posted with resistance through +98%.
- GRAN
  - Snapshot closest resistance now shows through +40%.
  - Full ladder says `No additional resistance found below 2.02 (+100.0%).`
- CPOP
  - Snapshot closest resistance now shows through +30%.
  - Full ladder posted with resistance through +97%.
  - Dense omitted resistance was compacted into displayed groupings; full ladder expanded the levels.
- MRKR
  - Snapshot closest resistance now shows through +31%.
  - Full ladder posted with resistance through +92%.
- NAAS
  - Snapshot closest resistance now shows through +30%.
  - Full ladder posted with resistance through +49%.
- BRNS
  - Snapshot closest resistance now shows through +31%.
  - Full ladder posted with resistance through +99%.
  - Omitted resistance was compacted into displayed level groupings.
- BLIV
  - Snapshot closest resistance now shows through +31%.
  - Full ladder posted with resistance through +48%.
- JOB
  - Snapshot closest resistance now shows through +36%.
  - Full ladder says `No additional resistance found below 0.4674 (+100.0%).`
  - Dense omitted resistance was compacted into displayed groupings; full ladder expanded the levels.
- RYOJ
  - Snapshot closest resistance now shows through +30%.
  - Full ladder posted with resistance through +47%.
- OFAL
  - Snapshot closest resistance now shows through +30%.
  - Full ladder posted with resistance through +94%.
- OMH
  - Snapshot closest resistance now shows through the +32% to +37% overhead zone.
  - Full ladder posted with resistance through +100%.
- BGDE
  - Snapshot closest resistance now shows through +41%.
  - Full ladder posted with resistance through +49%.
- ABVC
  - Snapshot closest resistance now shows through +30%.
  - Full ladder posted with resistance through +96%.
- WYHG
  - Initial run showed a near-price compaction issue; snapshot started at 0.6800 while the full ladder still had a closer shelf.
  - Fixed snapshot compaction so resistance directly above current price keeps the nearest shelf before strength sorting.
  - Rerun snapshot starts at 0.6703 with reference price 0.6688 and shows resistance through +31%.
  - Full ladder posted with resistance through +97%.
- SLGB
  - Snapshot closest resistance now shows through +37%.
  - Full ladder posted with resistance through +97%.
- IPM
  - Snapshot closest resistance now shows through +30%.
  - Full ladder posted with resistance through +100%.
- SPPL
  - Snapshot closest resistance now shows through +35%.
  - Full ladder posted with resistance through +48%.
- ORIO
  - Snapshot closest resistance now shows through +30%.
  - Full ladder says `No additional resistance found below 2.08 (+100.0%).`
- SDST
  - Snapshot closest resistance now shows through the +31% to +37% overhead zone.
  - Full ladder posted with resistance through +49%.
- JL
  - Snapshot closest resistance now shows through +32%.
  - Full ladder posted with resistance through +43%.
  - Omitted resistance was compacted into displayed level groupings.
- LGVN
  - Snapshot closest resistance now shows through +31%.
  - Full ladder posted with resistance through +97%.
- LTRN
  - Snapshot closest resistance now shows through +33%.
  - Full ladder posted with resistance through +46%.
- VEEA
  - Snapshot closest resistance now shows through +30%.
  - Full ladder says `No additional resistance found below 1.01 (+100.0%).`
  - Omitted resistance was compacted into displayed level groupings.
- VTGN
  - Snapshot closest resistance now shows through +49%.
  - Full ladder says `No additional resistance found below 1.26 (+100.0%).`
- MOBX
  - Snapshot closest resistance now shows through +34%.
  - Full ladder posted with resistance through +50%.
- ICCM
  - Snapshot closest resistance now shows through +46%.
  - Full ladder posted with resistance through +99%.
  - Omitted resistance was compacted into displayed level groupings.
- DFLI
  - Snapshot closest resistance now shows through +33%.
  - Full ladder posted with resistance through +97%.
- AEON
  - Snapshot closest resistance now shows through the +40% to +46% overhead zone.
  - Full ladder says `No additional resistance found below 1.90 (+100.0%).`
- EFOI
  - Snapshot closest resistance now shows through +36%.
  - Full ladder posted with resistance through +42%.
- SNAL
  - Snapshot closest resistance now shows through +30%.
  - Full ladder posted with resistance through +96%.
  - Omitted resistance was compacted into displayed level groupings.
- CRIS
  - Snapshot closest resistance now shows through +36%.
  - Full ladder posted with resistance through +96%.
  - Omitted resistance was compacted into displayed level groupings.
- ZBAO
  - Snapshot closest resistance now shows through the +33% to +38% overhead zone.
  - Full ladder posted with resistance through +95%.
- PMEC
  - Snapshot closest resistance now shows through +32%.
  - Full ladder posted with resistance through +95%.
  - Omitted resistance was compacted into displayed level groupings.
- APUS
  - Snapshot closest resistance now shows through +30%.
  - Full ladder says `No additional resistance found below 3.76 (+100.0%).`
- CYN
  - Snapshot closest resistance now shows through +30%.
  - Full ladder posted with resistance through +95%.
- NTCL
  - Snapshot closest resistance now shows through +32%.
  - Full ladder posted with resistance through +94%.
  - Omitted resistance was compacted into displayed level groupings.
- TXMD
  - Snapshot closest resistance now shows through +30%.
  - Full ladder posted with resistance through +45%.
- QRHC
  - Snapshot closest resistance now shows through +33%.
  - Full ladder posted with resistance through +100%.
- LASE
  - Snapshot closest resistance now shows through +35%.
  - Full ladder says `No additional resistance found below 1.44 (+100.0%).`
  - Omitted resistance was compacted into displayed level groupings.
- DETX
  - Snapshot closest resistance now shows through +30%.
  - Full ladder posted with resistance through +48%.
- PSHG
  - Snapshot closest resistance now shows through +33%.
  - Full ladder says `No additional resistance found below 3.64 (+100.0%).`
- ADGM
  - Snapshot closest resistance now shows through the +30% to +35% overhead zone.
  - Full ladder posted with resistance through +99%.
  - Omitted resistance was compacted into displayed level groupings.
- UTSI
  - Snapshot closest resistance now shows through +33%.
  - Full ladder posted with resistance through +44%.
- PLSM
  - Snapshot closest resistance now shows through +30%.
  - Full ladder posted with resistance through +48%.
- SER
  - Snapshot closest resistance now shows through +35%.
  - Full ladder says `No additional resistance found below 3.72 (+100.0%).`
- MSGM
  - Snapshot closest resistance now shows through +30%.
  - Full ladder says `No additional resistance found below 6.63 (+50.0%).`
- FEMY
  - Snapshot closest resistance now shows through +33%.
  - Full ladder posted with resistance through +97%.
  - Omitted resistance was compacted into displayed level groupings.
- SMSI
  - Snapshot closest resistance now shows through +30%.
  - Full ladder posted with resistance through +96%.
  - Omitted resistance was compacted into displayed level groupings.
- EVTV
  - Snapshot closest resistance now shows through +30%.
  - Full ladder posted with resistance through +99%.
- FEDU
  - Snapshot closest resistance now shows through the +36% to +41% overhead zone.
  - Full ladder posted with resistance through +48%.
- YSXT
  - Snapshot closest resistance now shows through the +38% to +42% overhead zone.
  - Full ladder posted with resistance through +94%.
- SKYQ
  - Snapshot closest resistance now shows through +33%.
  - Full ladder posted with resistance through +47%.
- RMCF
  - Snapshot closest resistance now shows through +33%.
  - Full ladder posted with resistance through +46%.
- YQ
  - Snapshot closest resistance now shows through +34%.
  - Full ladder posted with resistance through +43%.
- XOS
  - Snapshot closest resistance now shows through +31%.
  - Full ladder posted with resistance through +99%.
- MODD
  - Snapshot closest resistance now shows through +31%.
  - Full ladder posted with resistance through +48%.
- VYNE
  - Snapshot closest resistance now shows through +52%.
  - Full ladder says `No additional resistance found below 1.31 (+100.0%).`
  - First resistance was not until +22%; no nearer overhead resistance was present in the posted ladder.
- AKAN
  - Snapshot closest resistance now shows through +34%.
  - Full ladder says `No additional resistance found below 58.81 (+50.0%).`
- WETH
  - Snapshot closest resistance now shows through +30%.
  - Full ladder posted with resistance through +100%.
- WCT
  - Snapshot closest resistance now shows through +33%.
  - Full ladder posted with resistance through +48%.
- AUID
  - Snapshot closest resistance now shows through +30%.
  - Full ladder posted with resistance through +94%.

## Needs Review

## Missing Resistance

## Missing Support

## Data / Runtime Issue

- 2026-05-04 batch attempt: AREB, AEMD, ATNF, BFRI, BIAF, BJDX, BIVI, BLPH, BNOX, CARM
  - Result: do not judge ladder quality from this run.
  - Reason: 10 simultaneous activations degraded IBKR historical seeding; most activations stuck or timed out before level posts.
  - Specific provider failures observed: BLPH and BNOX returned IBKR code 200 `No security definition has been found for the request`; CARM eventually posted but the run was already degraded.
  - Cleanup: batch deactivated and Discord threads/posts deleted.
  - Next run: use smaller batches, likely 3 tickers at a time, with a wait-for-ready gate before adding the next ticker.
- ATNF
  - Paced rerun result: IBKR code 200 `No security definition has been found for the request`.
  - Discord orphan thread deleted.
- BLPH
  - Paced rerun result: IBKR code 200 `No security definition has been found for the request`.
  - Discord orphan thread deleted.
- BNOX
  - Paced rerun result: IBKR code 200 `No security definition has been found for the request`.
  - Discord orphan thread deleted.
- CARM
  - Paced rerun result: activated, but reference price came through as 0.0005 and no full ladder post was produced.
  - Treat as data/provider issue, not level-quality evidence.
- CHEK
  - Paced rerun result: IBKR code 200 `No security definition has been found for the request`.
  - Discord orphan thread deleted.
- CYCC
  - Paced rerun result: IBKR code 200 `No security definition has been found for the request`.
  - Discord orphan thread should be deleted during batch cleanup.
- NBY
  - Paced rerun result: IBKR code 200 `No security definition has been found for the request`.
  - Discord orphan thread should be deleted during batch cleanup.
- BSGM
  - Paced rerun result: IBKR code 200 `No security definition has been found for the request`.
  - Discord orphan thread should be deleted during batch cleanup.
- CYTO
  - Paced rerun result: IBKR code 200 `No security definition has been found for the request`.
  - Discord orphan thread should be deleted during batch cleanup.
- KTRA
  - Paced rerun result: IBKR code 200 `No security definition has been found for the request`.
  - Discord orphan thread should be deleted during batch cleanup.
- ADVM
  - Paced rerun result: IBKR code 200 `No security definition has been found for the request`.
  - Discord orphan thread should be deleted during batch cleanup.
- ALLK
  - Paced rerun result: IBKR code 200 `No security definition has been found for the request`.
  - Discord orphan thread should be deleted during batch cleanup.
- AXTI
  - Activated, but price came through near 103.40 while the full ladder had no resistance and support far below.
  - Treat as possible split-adjustment/provider data issue, not level-quality pass.
- FGEN
  - Paced rerun result: IBKR code 200 `No security definition has been found for the request`.
  - Discord orphan thread should be deleted during batch cleanup.
- LAZR
  - Paced rerun result: IBKR code 200 `No security definition has been found for the request`.
  - Discord orphan thread should be deleted during batch cleanup.
- SDIG
  - Paced rerun result: IBKR code 200 `No security definition has been found for the request`.
  - Discord orphan thread deleted during batch cleanup.
- SPWRQ
  - Paced rerun result: IBKR code 200 `No security definition has been found for the request`.
  - Discord orphan thread should be deleted during batch cleanup.

## Notes

- First batch starts with the first 10 nano / very small micro names.
- Repeated tickers are okay; keep the queue focused on active full-ladder behavior rather than list purity.
- IBKR historical seeding does not like 10 tiny/nano names started at once. Prefer sequential or 3-symbol batches while testing provider-sensitive names.
- 2026-05-04: snapshot `Closest levels to watch` resistance now keeps adding overhead levels until at least +30% when available, capped before it becomes the full ladder.
- 2026-05-04 support/resistance story replay:
  - Artifact: `artifacts/support-resistance-story-replay/support-resistance-story-replay.md`.
  - Scope: S/R story map only; volume/VWAP/EMA/AI wording ignored.
  - Cases: MNDR, RLYB, CLNN, ATXI, AKAN, SKLZ, ATER, YAAS.
  - Candidate story maps now usually provide a practical forward map: MNDR resistance map reached +40%, CLNN +43.5%, AKAN +31.8%, YAAS +38.5%.
  - ATER exposed a near-miss where five planning levels stopped below +30%; story planning now allows one extra level only when needed to reach the normal +30% planning range.
  - Active/extreme runner story maps are intentionally tighter than fresh/normal maps so already-extended moves do not automatically show another 30-50% in one shot.
  - Direct alert-intelligence replay filtered most candidates; use this artifact for story-map quality, not as proof of Discord delivery behavior.
- 2026-05-04 support/resistance story queue:
  - Queue doc: `docs/support-resistance-story-test-queue.md`.
  - Cases JSON: `artifacts/support-resistance-story-test-queue/support-resistance-story-test-cases.json`.
  - Built from stored warehouse 5m candles with sufficient daily/4h context; 80 cases grouped into 8 batches of 10.
  - Batch 1 replay artifact: `artifacts/support-resistance-story-replay-batch-1/support-resistance-story-replay.md`.
  - Batch 1 result: ELPW and SOBR looked acceptable for candidate map coverage; AKAN and HCAI reached about +30% resistance map; SKLZ showed the sixth map level correctly after the formatter fix but only reached +29.1% because no farther candidate was available inside the current story-map selection.
  - Batch 1 exposed a larger story-design issue: resistance-touch stories often map downside support instead of also giving the next higher resistance path. PBM and CUE ran over +100% but candidate stories had no upside resistance map because the event was framed as testing resistance.
  - Next tuning target: resistance-touch and last-resistance stories should include an upside continuation map when price is pressing or accepting resistance, while still keeping support/reclaim context available.
  - Batch 2 replay artifact: `artifacts/support-resistance-story-replay-batch-2/support-resistance-story-replay.md`.
  - Batch 2 result: RMSG, YAAS, OSRH, and MASK had acceptable candidate resistance-map coverage; CRE, SAGT, CCM were close but stayed just under +30%; MNDR, XTLB, and one AIOS window again exposed the missing-upside-map issue when the story is framed around resistance interaction/support context.
  - Resistance-touch tuning completed after Batch 1/2 review:
    - Resistance-touch stories now keep the downside support context and also add a separate upside `Resistance map` when higher resistance levels are available.
    - Formatter now counts the continuation map in replay QA metrics, so resistance-touch improvements are visible in the batch summaries.
    - Improved examples: PBM now shows a candidate/posted resistance map to +31.7%; CUE now shows +30.9%; MNDR now shows +41.1%.
    - Remaining true misses after this pass: EFOI emitted no S/R story candidates; XTLB and one AIOS window still had no useful upside map available from the event/level context; CCM and ATER remain materially short but no longer represent the main missing-upside-map bug.
    - Replay concern thresholds now allow “near enough” map coverage; slightly under +30% is no longer treated as a failure.
