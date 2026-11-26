# Blue Finance pitch deck

14 slides in one file, `index.html`. Open it in a browser.

- Arrows or space move between slides, `F` toggles full screen, `#6` in the address opens slide 6.
- Slide text is plain HTML. The charts are drawn by the script at the bottom of the file, with their numbers inline.
- Market figures are dated November 2026 and sourced in each slide's footer. Re-check them, and the test count, before reusing the deck.

Export to PDF (macOS, from this folder):

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --allow-file-access-from-files --no-pdf-header-footer --virtual-time-budget=5000 \
  --print-to-pdf="$PWD/blue-finance-pitch.pdf" "file://$PWD/index.html"
```

Fonts are Instrument Sans and Instrument Serif, under the OFL files in `assets/`.
