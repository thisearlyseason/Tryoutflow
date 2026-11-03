# Store screenshot plan — November 3, 2026

Use current submitted native workspace builds on iPhone/iPad and Android, with synthetic athlete records. Existing artwork is a design reference, not verified native capture: `output/store-artwork-20260923/preview/google-contact-sheet.png` explicitly labels the inserts as web previews. Inspected visually; do not submit these unchanged as native screenshots.

| Order | Caption                            | Actual screen to capture                                | Existing reference       |
| ----- | ---------------------------------- | ------------------------------------------------------- | ------------------------ |
| 1     | Run your tryout in one workspace   | Organization/tryout overview                            | `06-workspace.png`       |
| 2     | Keep check-in moving               | Athlete check-in and assigned number                    | `04-checkin.png`         |
| 3     | Score athletes with clear criteria | Assigned evaluation with save/sync state                | `02-evaluation.png`      |
| 4     | Compare results with context       | Rankings and completion information                     | `03-rankings.png`        |
| 5     | Build your next team               | Draft roster; no automated selection claim              | `05-roster.png`          |
| 6     | See athlete strengths              | Profile/radar, only with matching plan and actual build | `01-athlete-profile.png` |

References above exist in `output/store-artwork-20260923/{google-play,apple-iphone,apple-ipad}/`. Reuse the original brand assets and composition after replacing inserts with device captures. No new duplicate asset trees were created.

Missing: all six current native phone captures, matching iPad captures if tablet screenshots are supplied, and confirmation against the exact Apple build selected for review. Google Console currently has an icon and feature graphic but no phone screenshots. Its visible requirements: 2–8 phone screenshots, PNG/JPEG, up to 8 MB each, 16:9 or 9:16, each side 320–3840 px. For promotion, use at least four at 1080 px minimum per side. Check current Apple device-size specifications at upload rather than resizing a different device's UI.

Feature graphic recommendation: retain the existing 1024 × 500 brand asset only after verifying its text matches the workspace app. Use “Sports tryouts. Organized.” with the TryoutFlow mark and an uncluttered actual workspace crop. No awards, rating claims, price offers or download-button graphics. The existing asset is `output/store-artwork-20260923/google-play/feature-graphic.png`; no new raster is necessary until native captures are available.

Capture is blocked on a controlled native QA session with synthetic records and the exact review binaries. Existing website screenshots in `public/how-to/` remain useful for website guides; they are not presented as proof of native behavior.
