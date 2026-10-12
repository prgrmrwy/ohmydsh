# Third-party notices

This package redistributes brand icon files. The copyright in those files is held by their
upstream projects, and both upstreams license them under the MIT License. The MIT License
requires the copyright notice and the permission notice to travel with every copy, so both are
reproduced in full below. Nothing in this file grants any right in the trademarks or brand
names concerned — see [Trademarks](#trademarks) at the end.

## Brand SVG assets from `@lobehub/icons-static-svg@1.94.0`

21 of the 22 files in `src/client/assets/` are unmodified copies of icons published in
[`@lobehub/icons-static-svg@1.94.0`](https://www.npmjs.com/package/@lobehub/icons-static-svg)
([lobehub/lobe-icons](https://github.com/lobehub/lobe-icons)). The upstream URL and SHA-256
checksum of every copy are recorded file by file in
[`src/client/assets/README.md`](src/client/assets/README.md).

```
MIT License

Copyright (c) 2023 LobeHub

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

## `src/client/assets/opencode.svg`

An unmodified copy of `packages/ui/src/assets/icons/provider/opencode.svg` from
[`anomalyco/opencode`](https://github.com/anomalyco/opencode) at commit
`5e75e5e9901f0d178f425bfb47f1bd46cbe78a59`.

```
MIT License

Copyright (c) 2025 opencode

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

## Rendering notes

The files on disk are byte-for-byte copies of the upstream SVGs, checksummed in
`src/client/assets/README.md`. Everything below happens in the browser at render time and is
recorded here because it changes what is displayed:

- The injected `<svg>` root element receives `width`, `height`, `aria-hidden` and
  `style="display:block;color:currentColor"`; `width`, `height` and `style` attributes already
  present on the root are dropped. For the 12 files that carry their own brand colours this has
  no visual effect. For the 10 single-colour marks drawn with `currentColor`
  (`anthropic`, `grok`, `hermes`, `kimi`, `longcat`, `mimo`, `openai`, `opencode`, `pi`, `trae`)
  the mark is painted in the host theme's foreground colour instead of black or white.
- For the corner (model) instance of a composite badge, `id` attributes and `url(#…)` references
  are suffixed with `-sub`, so two copies of the same file on one page cannot resolve each
  other's gradient or clip-path definitions.

No path data, colour value, aspect ratio or viewBox is rewritten.

## Trademarks

All brand names and logos are the trademarks or registered trademarks of their respective
owners. They are used here only to identify the provider route or model that the user has
actually selected in DeepSeek Harness. Their use does not imply any affiliation with,
sponsorship of, or endorsement by any brand owner, and no brand owner has reviewed or approved
this plugin. The plugin's own name and its own icon contain no third-party brand.

Brand art is resolved from a single table in `src/client/logos.ts` and a single asset directory,
so a brand can be removed or replaced in one commit if an owner asks.
