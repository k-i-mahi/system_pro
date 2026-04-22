# Golden OCR Fixtures

Put paired `<name>.png` / `<name>.txt` files in this directory. The runner
reads each image through the OCR service at `quality=accurate` and computes
CER + WER against the `.txt` reference transcript.

Recommended variety for the award packet:

- `handwritten-integration.png` — integration by parts, Latin script, blue ink
- `handwritten-matrix.png` — matrix computation, pencil
- `printed-slide.png` — clean slide text
- `scanned-page.png` — phone-photo of a textbook page
- `whiteboard.png` — marker on whiteboard, mild glare
- `math-dense.png` — dense handwritten equations with fractions
- `mixed-lang.png` — English + one Bengali word (known limitation)
- `multi-column.png` — two-column academic paper scan
- `low-contrast.png` — pencil on cream paper
- `high-resolution.png` — 300 DPI baseline (TrOCR's sweet spot)
