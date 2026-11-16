makefun anchor db51e918f8e0ffd258993a4f28301584a6da13d0 round 34014804

# markdown-render-speed-02 v4 — Faster marked-compatible Markdown renderer

A dependency-free JavaScript module `parse.js` whose `parse(markdown)` returns HTML
byte-identical to marked 18.1.3 with default options (GFM on), plus `main.ts`
that renders every case with it. Single-pass index scanner, direct-to-HTML,
no token tree. Written from the prose spec in one recorded session.
