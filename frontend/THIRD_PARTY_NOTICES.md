# Third-party notices

The frontend bundles the following third-party packages whose licenses require
attribution. The canonical license text is shipped in each npm package and is
reproduced here for the distributed build.

## Vazirmatn 33.003 (self-hosted webfont)

Used as the product typeface (`src/styles/index.css` `@font-face`, files in
`public/fonts/`). Self-hosted on purpose — the UI must not depend on a
third-party font CDN at runtime (standards.md §14). Source:
<https://github.com/rastikerdar/vazirmatn>. License: SIL Open Font License 1.1.

The font files (`Vazirmatn-Regular.woff2`, `Vazirmatn-Medium.woff2`,
`Vazirmatn-SemiBold.woff2`, `Vazirmatn-Bold.woff2`) are unmodified copies of
the official release and remain under the OFL 1.1:
<https://scripts.sil.org/OFL>.

```
Copyright (c) 2015-2024, Saber Rastikerdar <saber.rastikerdar@gmail.com>
with Reserved Font Name "Vazirmatn".

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is available with a FAQ at: https://scripts.sil.org/OFL
```

## thinking-orbs 0.3.2

Used for the shared loading animation (`src/ui/thinking-orb.tsx`). Source:
<https://github.com/Jakubantalik/thinking-orbs>. License: MIT.

```
MIT License

Copyright (c) 2026 Jakub Antalik

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
