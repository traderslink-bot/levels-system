# Futures Universe

Generated at: 2026-05-16T00:39:29.896Z

This is an inventory only. It does not mean futures candles have been backfilled.

## Counts

| Metric | Count |
| --- | ---: |
| Total futures roots/products in universe | 2,178 |
| Seed roots | 49 |
| ICE product-code rows imported | 3,706 |
| ICE futures-like rows imported | 2,253 |
| Unique ICE symbol codes | 3,350 |

## Notes

- This is a futures universe inventory, not a candle-backfill queue.
- Futures contracts require root + exchange + expiry/month before IBKR candle requests can be made.
- Run an IBKR qualification pass later to mark which roots/contracts your account can resolve and download.
- CME-family products are seeded here because the CME public product-slate API blocked automated access from this environment.

## Tier Counts

| Tier | Count |
| --- | ---: |
| tier_2_watch | 20 |
| tier_1_liquid | 29 |
| full_inventory | 2,129 |

## Exchange Counts

| Exchange | Count |
| --- | ---: |
| ICEEU | 1,723 |
| ICEUS | 164 |
| IFLL | 116 |
| NDEX | 67 |
| IFAD | 27 |
| CME | 22 |
| NGXC | 18 |
| CBOT | 13 |
| IFSG | 11 |
| NYMEX | 8 |
| COMEX | 5 |
| IFLX | 4 |

## Tier 1 Liquid Roots

| Root | Name | Exchange | Asset Class | Tier | Source |
| --- | --- | --- | --- | --- | --- |
| MYM | Micro E-mini Dow | CBOT | Equity Index | tier_1_liquid | seed |
| UB | Ultra U.S. Treasury Bond | CBOT | Rates | tier_1_liquid | seed |
| YM | E-mini Dow | CBOT | Equity Index | tier_1_liquid | seed |
| ZB | U.S. Treasury Bond | CBOT | Rates | tier_1_liquid | seed |
| ZF | 5-Year T-Note | CBOT | Rates | tier_1_liquid | seed |
| ZN | 10-Year T-Note | CBOT | Rates | tier_1_liquid | seed |
| ZT | 2-Year T-Note | CBOT | Rates | tier_1_liquid | seed |
| 6A | Australian Dollar FX | CME | FX | tier_1_liquid | seed |
| 6B | British Pound FX | CME | FX | tier_1_liquid | seed |
| 6C | Canadian Dollar FX | CME | FX | tier_1_liquid | seed |
| 6E | Euro FX | CME | FX | tier_1_liquid | seed |
| 6J | Japanese Yen FX | CME | FX | tier_1_liquid | seed |
| BTC | Bitcoin | CME | Crypto | tier_1_liquid | seed |
| ES | E-mini S&P 500 | CME | Equity Index | tier_1_liquid | seed |
| ETH | Ether | CME | Crypto | tier_1_liquid | seed |
| M2K | Micro E-mini Russell 2000 | CME | Equity Index | tier_1_liquid | seed |
| MBT | Micro Bitcoin | CME | Crypto | tier_1_liquid | seed |
| MES | Micro E-mini S&P 500 | CME | Equity Index | tier_1_liquid | seed |
| MET | Micro Ether | CME | Crypto | tier_1_liquid | seed |
| MNQ | Micro E-mini Nasdaq-100 | CME | Equity Index | tier_1_liquid | seed |
| NQ | E-mini Nasdaq-100 | CME | Equity Index | tier_1_liquid | seed |
| RTY | E-mini Russell 2000 | CME | Equity Index | tier_1_liquid | seed |
| GC | Gold | COMEX | Metals | tier_1_liquid | seed |
| HG | Copper | COMEX | Metals | tier_1_liquid | seed |
| MGC | Micro Gold | COMEX | Metals | tier_1_liquid | seed |
| SI | Silver | COMEX | Metals | tier_1_liquid | seed |
| CL | Crude Oil WTI | NYMEX | Energy | tier_1_liquid | seed |
| MCL | Micro WTI Crude Oil | NYMEX | Energy | tier_1_liquid | seed |
| NG | Henry Hub Natural Gas | NYMEX | Energy | tier_1_liquid | seed |

## Tier 2 Watch Roots

| Root | Name | Exchange | Asset Class | Tier | Source |
| --- | --- | --- | --- | --- | --- |
| KE | KC HRW Wheat | CBOT | Agriculture | tier_2_watch | seed |
| ZC | Corn | CBOT | Agriculture | tier_2_watch | seed |
| ZL | Soybean Oil | CBOT | Agriculture | tier_2_watch | seed |
| ZM | Soybean Meal | CBOT | Agriculture | tier_2_watch | seed |
| ZS | Soybeans | CBOT | Agriculture | tier_2_watch | seed |
| ZW | Chicago SRW Wheat | CBOT | Agriculture | tier_2_watch | seed |
| 6M | Mexican Peso FX | CME | FX | tier_2_watch | seed |
| 6N | New Zealand Dollar FX | CME | FX | tier_2_watch | seed |
| 6S | Swiss Franc FX | CME | FX | tier_2_watch | seed |
| GF | Feeder Cattle | CME | Livestock | tier_2_watch | seed |
| HE | Lean Hogs | CME | Livestock | tier_2_watch | seed |
| LE | Live Cattle | CME | Livestock | tier_2_watch | seed |
| SR3 | Three-Month SOFR | CME | Rates | tier_2_watch | seed |
| SIL | Micro Silver | COMEX | Metals | tier_2_watch | seed |
| DX | U.S. Dollar Index | ICEUS | FX | tier_2_watch | seed |
| BZ | Brent Crude Oil Last Day | NYMEX | Energy | tier_2_watch | seed |
| HO | NY Harbor ULSD | NYMEX | Energy | tier_2_watch | seed |
| PA | Palladium | NYMEX | Metals | tier_2_watch | seed |
| PL | Platinum | NYMEX | Metals | tier_2_watch | seed |
| RB | RBOB Gasoline | NYMEX | Energy | tier_2_watch | seed |

## Full Inventory Sample

| Root | Name | Exchange | Asset Class | Tier | Source |
| --- | --- | --- | --- | --- | --- |
| 14V | Fuel Oil Outright - Fuel Oil 3.5% FOB Med Cargoes (Platts) Balmo Mini Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| 14W | Fuel Oil Diff - USAC HSFO (Platts) vs USGC HSFO (Platts) Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| 14X | Fuel Oil Outright - USAC HSFO (Platts) Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| 14Y | Diesel Outright - ULSD 10ppm CIF NWE Cargoes (Platts) Mini Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| 14Z | Diesel Crack - ULSD 10ppm CIF NWE Cargoes (Platts) vs Brent 1st Line Balmo Future (bbl) | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| ABF | Butane, Argus Far East Index (AFEI) Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| ABG | Propane, Argus CIF ARA vs Naphtha CIF NWE Cargoes (Platts) Balmo Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| ABI | Argus Biodiesel RME FOB Rotterdam (RED Compliant) Future | ICEEU | Biofuels | full_inventory | ice_product_codes |
| ABK | Propane, Argus Far East Index vs Naphtha C+F Japan (Platts) Balmo Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| ABM | Butane, Argus CIF ARA Mini Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| ABO | Butane, Argus Sonatrach CP Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| ABR | Butane, Argus CIF ARA Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| ABS | Butane, Argus Saudi CP Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| ACB | Argus WTI Houston vs Dated Brent (Platts) future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| ACL | Crude Diff - Argus WTI Houston vs WTI Trade Month Balmo Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| ACM | Crude Diff - Argus WTI Houston vs WTI Trade Month Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| ACT | Crude Outright - Argus WTI Cushing Trade Month Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| ADA | Option on PJM AEP Dayton Hub Day-Ahead Peak Daily Fixed Price Future | ICEEU | Electricity | full_inventory | ice_product_codes |
| ADB | PJM AEP Dayton Hub Day-Ahead Peak Fixed Price Future | ICEEU | Electricity | full_inventory | ice_product_codes |
| ADC | PJM AEP Dayton Hub Day-Ahead Off-Peak Daily Fixed Price Future | ICEEU | Electricity | full_inventory | ice_product_codes |
| ADD | PJM AEP Dayton Hub Day-Ahead Off-Peak Fixed Price Future | ICEEU | Electricity | full_inventory | ice_product_codes |
| ADO | PJM AEP Dayton Hub Real-Time Off-Peak Daily Fixed Price Future | ICEEU | Electricity | full_inventory | ice_product_codes |
| ADP | NYISO Zone A Day-Ahead Peak Daily Fixed Price Future | ICEEU | Electricity | full_inventory | ice_product_codes |
| ADR | PJM AEP Dayton Hub Day-Ahead Peak Energy + Congestion Fixed Price Future | ICEEU | Electricity | full_inventory | ice_product_codes |
| ADS | PJM AEP Dayton Hub Day-Ahead Off-Peak Energy + Congestion Fixed Price Future | ICEEU | Electricity | full_inventory | ice_product_codes |
| AEA | Gasoline Crack - Argus Eurobob Non-Oxy FOB Rotterdam Barges vs Brent 1st Line Future (in Bbls) | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| AEB | Argus Eurobob Oxy FOB Rotterdam Barges vs Brent 1st Line Future (in Bbls) | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| AEC | AB NIT Basis Future | ICEEU | Natural Gas | full_inventory | ice_product_codes |
| AEE | Argus Eurobob Non-Oxy FOB Rotterdam Barges Futures Balmo | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| AEK | Gasoline Outright - Argus Eurobob Non-Oxy FOB Rotterdam Barges Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| AEL | Gasoline Diff - Argus Eurobob Non-Oxy FOB Rotterdam Barges vs Argus Eurobob Oxy FOB Rotterdam Barges Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| AEN | Gasoline Outright - Argus Eurobob Oxy FOB Rotterdam Barges Balmo Mini Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| AEO | Argus Eurobob Oxy FOB Rotterdam Barges Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| AEP | Argus Eurobob Oxy FOB Rotterdam Barges Balmo Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| AES | Gasoline Crack - Argus Eurobob Oxy FOB Rotterdam Barges vs Brent 1st Line Balmo Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| AFA | Propane, Argus CIF ARA, Mini Balmo Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| AFD | Propane - Daily Argus Far East Mini Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| AFE | Propane, Argus Far East Index (AFEI) Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| AFF | Propane, Argus Far East, Fixed Price Future (Balmo) | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| AFK | Propane, Argus Saudi CP Mini Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| AFL | Propane, Argus Far East Index (AFEI) Mini Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| AFM | Propane, Argus CIF ARA Mini Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| AFR | API4 Richards Bay Coal Futures | ICEEU | Coal | full_inventory | ice_product_codes |
| AFS | Propane, Argus Sonatrach CP Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| AFT | Propane, Argus Far East Index (AFEI) Mini Balmo Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| AFW | Crude Outright - Argus WTI Houston Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| AIL | Crude Diff - Argus WTI Houston vs. WTI 1st Line Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| AIM | Crude Diff - Argus WTI CMA Trade Month Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| AIN | Fuel Oil Diff - Fuel Oil 3.5% CIF Med Cargoes (Platts) vs Fuel Oil 3.5% FOB MED Cargoes (Platts) Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| AIR | Gasoline Crack - Argus Eurobob Oxy FOB Rotterdam Barges vs Brent 1st Line Balmo Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| AIS | AB NIT Index Future | ICEEU | Natural Gas | full_inventory | ice_product_codes |
| AIT | Gasoline Outright - Daily Argus Eurobob Oxy FOB Rotterdam Barges Mini Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| AJA | Crude Diff - Argus SGC vs WTI Trade Month Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| AJB | Crude Diff - Argus SGC vs WTI 1st Line Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| AJC | Gasoline Diff - Argus Gulf Coast CBOB A vs RBOB Gasoline 1st Line Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| ALG | Algonquin Citygates Fixed Price Future | ICEEU | Natural Gas | full_inventory | ice_product_codes |
| ALI | Algonquin Citygates Index Future | ICEEU | Natural Gas | full_inventory | ice_product_codes |
| ALO | MISO Arkansas Hub Day-Ahead Off-Peak Fixed Price Future | ICEEU | Electricity | full_inventory | ice_product_codes |
| ALP | MISO Arkansas Hub Day-Ahead Peak Fixed Price Future | ICEEU | Electricity | full_inventory | ice_product_codes |
| ALQ | Algonquin Citygates Basis Future | ICEEU | Natural Gas | full_inventory | ice_product_codes |
| ALS | Algonquin Citygates Swing Future | ICEEU | Natural Gas | full_inventory | ice_product_codes |
| ANO | ANR SW (Oklahoma) Basis Future | ICEEU | Natural Gas | full_inventory | ice_product_codes |
| ANP | ANR SW (Oklahoma) Fixed Price Future | ICEEU | Natural Gas | full_inventory | ice_product_codes |
| AOA | Ammonia Outright - Argus Ammonia NWE CFR Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| AOC | Ammonia Outright - Ammonia CFR NWE (Weekly) (Platts) Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| AOD | Option on PJM AEP Dayton Hub Real-Time Off-Peak Fixed Price Future | ICEEU | Electricity | full_inventory | ice_product_codes |
| AOH | Ammonia Outright - Argus Ammonia US Gulf CFR Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| AOI | ANR SW (Oklahoma) Index Future | ICEEU | Natural Gas | full_inventory | ice_product_codes |
| AOM | Argus Eurobob Oxy FOB Rotterdam Barges Mini Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| AOP | NYISO Zone A Day-Ahead Off-Peak Fixed Price Future | ICEEU | Electricity | full_inventory | ice_product_codes |
| AOS | ANR SW (Oklahoma) Swing Future | ICEEU | Natural Gas | full_inventory | ice_product_codes |
| AOX | Ammonia Outright - Argus Ammonia US Gulf FOB Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| APC | Propane, Argus CIF ARA Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| APD | Propane, Argus CIF ARA, Fixed Price Balmo Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| API | ANR SE (Louisiana) Index Future | ICEEU | Natural Gas | full_inventory | ice_product_codes |
| APN | Propane, Argus CIF ARA vs Naphtha, Platts CIF NWE Cargoes (Platts) Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| APO | NYISO Zone A Day-Ahead Off-Peak Daily Fixed Price Future | ICEEU | Electricity | full_inventory | ice_product_codes |
| APS | ANR SE (Louisiana) Swing Future | ICEEU | Natural Gas | full_inventory | ice_product_codes |
| ARH | Argus LLS Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| ARI | Crude Diff - Argus LLS vs Brent 1st Line Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| ARK | Crude Diff - Argus LLS vs WTI 1st Line Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| ARL | Crude Diff - Argus LLS vs WTI Trade Month Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| ARM | Argus Mars Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| ARN | Crude Diff - Argus Mars vs Brent 1st Line Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| ARO | Crude Diff - Argus Mars vs WTI 1st Line Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| ARP | Crude Diff - Argus LLS vs WTI 1st Line Balmo Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| ARQ | Crude Diff - Argus LLS vs WTI Trade Month Balmo Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| ARR | Propane, Argus Far East Index (AFEI) vs Naphtha C+F Japan Cargoes (Platts) Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| ART | Crude Diff - Argus Mars vs WTI 1st Line Balmo Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| ARV | Crude Diff - Argus WCS (Houston) Crude Oil Trade Month Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| ARW | Crude Diff - Argus Mars vs WTI Trade Month Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| ARX | Crude Diff - Argus Canadian High TAN (Houston) Crude Oil Trade Month Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| ASS | AB NIT Swing Future | ICEEU | Natural Gas | full_inventory | ice_product_codes |
| ASX | Crude Oil Diff - Argus WCS (Houston) Crude Oil Trade Month Balmo Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| ATD | API2 Rotterdam Coal Cal 1x Options (Futures Style Margin) | ICEEU | Coal | full_inventory | ice_product_codes |
| ATH | API2 Rotterdam Coal Qtr 1x Options (Futures Style Margin) | ICEEU | Coal | full_inventory | ice_product_codes |
| ATW | API2 Rotterdam Coal Futures | ICEEU | Coal | full_inventory | ice_product_codes |
| AVS | Crude Diff - Argus WTS vs WTI Trade Month Balmo Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| AVT | Crude Diff - Argus WTS vs WTI Trade Month Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| AXM | Crude Diff - Argus X-Pipe Midland WTI vs WTI Trade Month Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| B99 | Biofuel Diff - Argus US B99 NYH vs NYH ULSHO 1st Line Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| B9N | Biofuel Diff - Argus US B99 NYH vs Heating Oil 1st Line Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BAC | Crude Diff - Argus Bakken Cushing vs WTI 1st Line Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BAF | Crude Oil Diff - Argus Bakken Cushing vs WTI Trade Month Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BAK | Crude Diff - Argus Bakken (Clearbrook) Crude Oil Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BAL | Fuel Oil Outright - Fuel Oil 3.5% FOB Rotterdam Barges (Platts) Balmo Mini Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BAM | Fuel Oil Mini 3.5% FOB Rotterdam Barges Future (100MT) | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BAO | Gasoil Crack - Singapore Gasoil (Platts) vs Dubai 1st Line (Platts) Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BAP | Gasoil Diff - Singapore Gasoil (Platts) vs Low Sulphur Gasoil 1st Line Future (in Bbls) | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BAQ | Jet Fuel Diff – Singapore Jet Kerosene Cargoes (Platts) vs Singapore Gasoil 10 ppm (Platts) Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BAR | Fuel Oil 3.5% FOB Rotterdam Barges Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BAS | Fuel Oil 3.5% FOB Rotterdam Barges Balmo Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BAT | Jet Fuel Diff - Singapore Jet Kerosene Cargoes (Platts) vs Singapore Gasoil (Platts) Balmo Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BCF | British Columbia Low Carbon Fuel Standard Futures | ICEEU | Biofuels | full_inventory | ice_product_codes |
| BCS | British Columbia Low Carbon Fuel Standard (OPIS) 1st Line Future | ICEEU | Biofuels | full_inventory | ice_product_codes |
| BDA | Biodiesel Outright – Argus HVO FOB ARA Range (Class II) Future | ICEEU | Biofuels | full_inventory | ice_product_codes |
| BDB | Biodiesel Outright - Argus UCOME FOB ARA Range (Red Compliant) Future | ICEEU | Biofuels | full_inventory | ice_product_codes |
| BDE | Option on Daily EU-Style Brent Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BDF | Biodiesel Outright - Argus Biodiesel Advanced FAME Zero FOB ARA Range (RED Compliant) Future | ICEEU | Biofuels | full_inventory | ice_product_codes |
| BDG | Biodiesel Diff - Argus Biodiesel Advanced FAME Zero FOB ARA Range (RED Compliant) vs Low Sulphur Gasoil 1st Line Future | ICEEU | Biofuels | full_inventory | ice_product_codes |
| BDI | Baltic Dry Index (BDI) Future | ICEEU | Dry Freight | full_inventory | ice_product_codes |
| BF1 | Crude Outright - Daily BFOET (Platts) M1 Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BF2 | Crude Outright - Daily BFOET (Platts) M2 Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BF3 | Crude Outright - Daily BFOET (Platts) M3 Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BFA | Biofuel Outright - RVO (OPIS) Current Year Mini Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BFB | Biofuel Outright - Argus RVO Current Year Mini Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BFC | Biofuel Outright - Daily Argus RVO Current Year Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BFD | Biofuel Outright - Argus US B99 NYH Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BFE | Biofuel Outright - RVO (OPIS) Current Year Balmo Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BFF | Biofuel Outright - Argus RVO Current Year Balmo Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BFG | Biofuel Outright - Daily Argus RVO Current Year Mini Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BFH | Biofuel Outright - D3 RINs (OPIS) Current Year Future | ICEEU | Biofuels | full_inventory | ice_product_codes |
| BFI | Biofuel Outright - D5 RINs (OPIS) Current Year Future | ICEEU | Biofuels | full_inventory | ice_product_codes |
| BFJ | Biofuel Outright - RVO (OPIS) Current Year Balmo Mini Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BFK | Biofuel Outright - Argus RVO Current Year Balmo Mini Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BFR | Argus UCOME FOB China Bulk (RED Compliant) Future | ICEEU | Biofuels | full_inventory | ice_product_codes |
| BFT | Argus UCO FOB China Bulk (RED Compliant) Future | ICEEU | Biofuels | full_inventory | ice_product_codes |
| BFU | Argus UCOME FOB Strait of Malacca Bulk (RED Compliant) Future | ICEEU | Biofuels | full_inventory | ice_product_codes |
| BFW | Argus UCO FOB Strait of Malacca Bulk (RED Compliant) Future | ICEEU | Biofuels | full_inventory | ice_product_codes |
| BFZ | Biodiesel Diff - Argus BioD FAME 0 FOB ARA Range (RED Compliant) vs Low Sulphur Gasoil 1st Line Future | ICEEU | Biofuels | full_inventory | ice_product_codes |
| BGA | MISO AMIL.BGS6 Day-Ahead Peak Fixed Price Future | ICEEU | Electricity | full_inventory | ice_product_codes |
| BGB | MISO AMIL.BGS6 Day-Ahead Off-peak Fixed Price Future | ICEEU | Electricity | full_inventory | ice_product_codes |
| BGY | Option on PJM BGE Zone Day-Ahead Peak Fixed Price Future | ICEEU | Electricity | full_inventory | ice_product_codes |
| BGZ | PJM BGE Zone Day-Ahead Off-Peak Fixed Price Future | ICEEU | Electricity | full_inventory | ice_product_codes |
| BIT | Fuel Oil Outright - Argus US Gulf Coast Asphalt Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BM1 | TETCO M2 Fixed Price Future (Receipts) | ICEEU | Natural Gas | full_inventory | ice_product_codes |
| BM2 | TETCO M2 Basis Future (Receipts) | ICEEU | Natural Gas | full_inventory | ice_product_codes |
| BM3 | TETCO M2 Swing Future (Receipts) | ICEEU | Natural Gas | full_inventory | ice_product_codes |
| BMN | Methanol T2 FOB Rotterdam (ICIS) Future | ICEEU | Biofuels | full_inventory | ice_product_codes |
| BMO | Methanol Outright - Argus Methanol FOB Rotterdam Barge Future | ICEEU | Biofuels | full_inventory | ice_product_codes |
| BNB | Brent Bullet Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BOA | Fuel Oil Crack - Fuel Oil 3.5% FOB Rotterdam Barges vs Brent 1st Line Future (in Bbls) | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BOB | Fuel Oil Crack - Fuel Oil 3.5% FOB Rotterdam Barges vs Brent 1st Line Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BOC | Fuel Oil Crack - Fuel Oil 3.5% FOB Med Cargoes (Platts) vs Brent 1st Line Future (in Bbls) | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BOD | Crude Diff - Brent 1st Line vs Dubai 1st Line Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BOF | Base Oils Outright - Base Oils Group II N150 FOB Asia (ICIS) Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BOH | Crude Diff - Brent 1st Line vs Dubai 1st Line (Platts) Balmo Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BOT | Base Oils Outright - Base Oils Group II N150 FCA NWE Truck (ICIS) Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BOU | Base Oils Outright - Base Oils Group II N100/120 FOB USGC Export (ICIS) Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BPC | Benzene, CIF ARA (Platts) Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| BRI | Biodiesel Diff - Argus Bio-D RME FOB ARA Range (RED Compliant) vs Low Sulphur Gasoil 1st Line Future | ICEEU | Biofuels | full_inventory | ice_product_codes |
| BRM | Crude Future - Brent 1-Month Calendar Spread Options | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BRN | Brent Crude Futures | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BSA | Brent Singapore Marker Penultimate Day 1st Line Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BSB | Brent Singapore Marker Penultimate Day 1st Line Balmo Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BSF | Crude Outright - Brent Singapore Marker 1st Line Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BSG | Crude Outright - Brent Singapore Marker 1st Line Balmo Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BSM | Daily CFD - Dated Brent (Platts) vs First Month BFOE (Platts) Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BSP | Brent 1st Line Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BSQ | Brent 1st Line Balmo Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BTD | Crude Diff - WTI 1st Line vs Brent 1st Line Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BTE | Crude Diff - WTI 1st Line vs Brent 1st Line Balmo Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BTM | Daily CFD - Dated Brent (Platts) vs Second Month BFOE (Platts) Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BUC | Benzene, IHS MARKIT US Contract Price Future | ICEEU | Petrochemicals | full_inventory | ice_product_codes |
| BUE | Normal Butane, OPIS LST ISOM Grade Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| BUI | Benzene, IHS MARKIT US Index Fixed Price Future | ICEEU | Petrochemicals | full_inventory | ice_product_codes |
| BUK | Butane Argus CIF ARA Mini Balmo Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| BUL | EU-Style Brent Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BUM | Daily CFD - Dated Brent (Platts) vs Third Month BFOE (Platts) Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| BUN | Butane, Argus CIF ARA Balmo Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| BUQ | Butane, Argus Far East Index (AFEI) Mini Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| BUR | Butane, Argus Far East Index Balmo Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| BUS | Butane, Argus Saudi CP Mini Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| BZF | Benzene Contract Price, I.C.I.S. CIF NWE Future | ICEEU | Petrochemicals | full_inventory | ice_product_codes |
| C30 | California Carbon Allowance Vintage 2030 Future | ICEEU | Physical Environmental | full_inventory | ice_product_codes |
| CAD | CAISO NP-15 Day-Ahead Peak Daily HE 0900-1600 Fixed Price Future | ICEEU | Electricity | full_inventory | ice_product_codes |
| CAE | CAISO SP-15 Day-Ahead Peak Daily HE 0900-1600 Fixed Price Future | ICEEU | Electricity | full_inventory | ice_product_codes |
| CAG | Gasoline Outright - Los Angeles CARBOB Gasoline (OPIS) Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| CAR | Fuel Oil 1% FOB NWE Cargoes Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| CAS | Fuel Oil 1% FOB NWE Cargoes Balmo Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| CAT | Fuel Oil Outright - Fuel Oil 1% FOB NWE Cargoes (Platts) Mini Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| CAY | California Carbon Allowance Vintage 2020 Future | ICEEU | Physical Environmental | full_inventory | ice_product_codes |
| CAZ | California Carbon Allowance Vintage 2021 Future | ICEEU | Physical Environmental | full_inventory | ice_product_codes |
| CB0 | California Carbon Allowance Vintage 2022 Future | ICEEU | Physical Environmental | full_inventory | ice_product_codes |
| CB1 | California Carbon Allowance Vintage 2023 Future | ICEEU | Physical Environmental | full_inventory | ice_product_codes |
| CB4 | California Carbon Allowance Vintage 2024 Future | ICEEU | Physical Environmental | full_inventory | ice_product_codes |
| CB5 | California Carbon Allowance Vintage 2025 Future | ICEEU | Physical Environmental | full_inventory | ice_product_codes |
| CB6 | California Carbon Allowance Vintage 2026 Future | ICEEU | Physical Environmental | full_inventory | ice_product_codes |
| CB7 | California Carbon Allowance Vintage 2027 Future | ICEEU | Physical Environmental | full_inventory | ice_product_codes |
| CB8 | California Carbon Allowance Vintage 2028 Future - CB8 | ICEEU | Physical Environmental | full_inventory | ice_product_codes |
| CB9 | California Carbon Allowance Vintage 2029 Future | ICEEU | Physical Environmental | full_inventory | ice_product_codes |
| CBC | Gasoline Outright - Argus Gulf Coast CBOB A Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| CBD | Diesel Outright - Los Angeles CARB Diesel (OPIS) Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| CBT | CAISO NP-15 Day-Ahead TB4 Fixed Price Future, 7X | ICEEU | Electricity | full_inventory | ice_product_codes |
| CBU | CAISO SP-15 Day-Ahead TB4 Fixed Price Future, 7X | ICEEU | Electricity | full_inventory | ice_product_codes |
| CBV | CAISO NP-15 Day-Ahead TB4 Fixed Price Daily Future | ICEEU | Electricity | full_inventory | ice_product_codes |
| CBW | CAISO SP-15 Day-Ahead TB4 Fixed Price Daily Future | ICEEU | Electricity | full_inventory | ice_product_codes |
| CC0 | California Carbon Allowance Specific Vintage 2020 Future | ICEEU | Physical Environmental | full_inventory | ice_product_codes |
| CC1 | California Carbon Allowance Specific Vintage 2021 Future | ICEEU | Physical Environmental | full_inventory | ice_product_codes |
| CC2 | California Carbon Allowance Specific Vintage 2022 Future | ICEEU | Physical Environmental | full_inventory | ice_product_codes |
| CC3 | California Carbon Allowance Specific Vintage 2023 Future | ICEEU | Physical Environmental | full_inventory | ice_product_codes |
| CC4 | California Carbon Allowance Specific Vintage 2024 Future | ICEEU | Physical Environmental | full_inventory | ice_product_codes |
| CCF | California Low Carbon Fuel Standard Futures | ICEEU | Biofuels | full_inventory | ice_product_codes |
| CCL | Caiso Malin Day-Ahead Peak Daily Fixed Price Future | ICEEU | Electricity | full_inventory | ice_product_codes |
| CCT | California Carbon Allowance Specific Vintage 2025 Future | ICEEU | Physical Environmental | full_inventory | ice_product_codes |
| CCU | California Carbon Allowance Specific Vintage 2026 Future | ICEEU | Physical Environmental | full_inventory | ice_product_codes |
| CCV | California Carbon Allowance Specific Vintage 2027 Future | ICEEU | Physical Environmental | full_inventory | ice_product_codes |
| CCW | California Carbon Allowance Specific Vintage 2028 Future | ICEEU | Physical Environmental | full_inventory | ice_product_codes |
| CCX | California Carbon Allowance Specific Vintage 2029 Future | ICEEU | Physical Environmental | full_inventory | ice_product_codes |
| CCY | California Carbon Allowance Specific Vintage 2030 Future | ICEEU | Physical Environmental | full_inventory | ice_product_codes |
| CEG | ICE C5 PEA 1a Index Futures | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| CEH | ICE C5 ENB 1a Index Futures | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| CEJ | Propane, OPIS Mt. Belvieu Non-TET vs Propane, Argus CIF ARA Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| CEK | Propane, OPIS Mt. Belvieu TET vs Propane, Argus CIF ARA Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| CEO | PJM ComEd Zone Day-Ahead Off-Peak Fixed Price Future | ICEEU | Electricity | full_inventory | ice_product_codes |
| CEP | PJM ComEd Zone Day-Ahead Peak Fixed Price Future | ICEEU | Electricity | full_inventory | ice_product_codes |
| CEY | Propane, OPIS Mt. Belvieu TET vs Propane, Far East Index (AFEI) Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| CEZ | Propane, OPIS Mt. Belvieu Non-TET vs Propane, Far East Index (AFEI) Future | ICEEU | Natural Gas Liquids | full_inventory | ice_product_codes |
| CFB | Chicago Fixed Price Future | ICEEU | Natural Gas | full_inventory | ice_product_codes |
| CFD | Weekly CFD - Dated Brent (Platts) vs First Month BFOE (Platts) Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| CFL | Monthly CFD - Dated Brent CFD (Platts) vs Second Month BFOE (Platts) Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| CFM | Monthly CFD - Dated Brent (Platts) Vs First Month BFOE (Platts) Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| CFT | Weekly CFD - Dated Brent (Platts) vs Second Month (Platts) Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| CFU | Crude Diff - Urals North vs Dated Brent CFD Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| CFV | Urals North vs Dated Brent CFD Balmo Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| CGA | CG-Mainline Fixed Price Future | ICEEU | Natural Gas | full_inventory | ice_product_codes |
| CGB | CG-Mainline Basis Future | ICEEU | Natural Gas | full_inventory | ice_product_codes |
| CGC | Crude Diff - WTI Midland (DAP Rotterdam) (Platts) vs Dated Brent (Platts) Balmo Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| CGD | Crude Diff - WTI Midland (DAP Augusta) (Platts) vs Dated Brent (Platts) Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| CGE | Crude Diff - WTI Midland (DAP Augusta) (Platts) vs Dated Brent (Platts) Balmo Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| CGG | Crude Diff - Daily WTI Midland (DAP Rotterdam) (Platts) vs Dated Brent (Platts) Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| CGH | Crude Diff - Daily WTI Midland (DAP Augusta) (Platts) vs Dated Brent (Platts) Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| CGI | CG-Mainline Index Future | ICEEU | Natural Gas | full_inventory | ice_product_codes |
| CGK | Gasoline Outright - MTBE FOB Singapore (Platts) Mini Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| CGL | Jet Fuel Outright - Singapore Jet Kerosene Cargoes (Platts) Balmo Mini Future | ICEEU | Crude Oil and Refined Products | full_inventory | ice_product_codes |
| CGM | ANR SE (Louisiana) Basis Future | ICEEU | Natural Gas | full_inventory | ice_product_codes |
| CGR | CG-Mainline Swing Future | ICEEU | Natural Gas | full_inventory | ice_product_codes |
| CGS | TCO Swing Future | ICEEU | Natural Gas | full_inventory | ice_product_codes |
| CHB | Japanese (Chubu Area) Power Financial Base Futures | ICEEU | Electricity | full_inventory | ice_product_codes |
| CHP | Japanese (Chubu Area) Power Financial Peak Futures | ICEEU | Electricity | full_inventory | ice_product_codes |
