# Analysis image branding update

Owner-approved scope: exported images only. Keep the two semantic images and all analysis text. Increase section headings from 28 to 42 pixels, change top/bottom website URL to orange. Following owner preview feedback, reduce and lighten horizontal branding, and restore the subtle diagonal overlay across price/content areas. Do not alter the live card or send social posts for testing.

Implementation: each text row is measured with the existing Sharp/Pango renderer. Light grey horizontal branding appears beside the first and fourth price rows only (maximum two per section), subject to width/height fit. Two diagonal traderslink.pro marks are anchored to actual price rows (one if only one row exists), at x=210 (left-of-centre) and ten percent opacity. They do not drift across the image or cover headings. The header/footer remain clear. Website text remains orange at the top and bottom. A new cache suffix applies to newly requested social exports; previously sent/frozen images are retained. Watermarks discourage clean cropping but cannot prevent image editing.

Verification: BKYI retained fixture rendered into two 1000-pixel-wide PNGs (1297 and 1408 pixels tall); visually inspected both with no cut-off content or heading collisions. Input remains unchanged. Orange URL and 42-pixel heading checks pass. Full tsconfig noEmit checkpoint passed before the final coordinate-only adjustment. No live sends. Owner accepted the final preview on September 30, 2026; release pending.

Separate pending work: Watchlist X link cadence every second post; press-release X link cadence every third post belongs to the press-release posting flow. Neither changes Discord captions.
