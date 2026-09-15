# HPF Label Generator / 对焦环刻度生成器

An entirely browser-based distance-scale generator for high-precision focusing rings. It is inspired by [OSHPF-Label-generator](https://github.com/RayforLoy/OSHPF-Label-generator) and designed to match the visual language of [LensboardGenerator](https://rayforloy.github.io/LensboardGenerator/).

完全运行于浏览器的高精度对焦环距离刻度生成器。参考了 [OSHPF-Label-generator](https://github.com/RayforLoy/OSHPF-Label-generator) 的计算方法，并采用与 [LensboardGenerator](https://rayforloy.github.io/LensboardGenerator/) 相近的视觉语言。

## Features / 功能

- 391-entry lens database; EFL is preferred and nominal focal length is used as a fallback.
- Live, physically dimensioned preview using the thin-lens equation.
- Chinese/English interface that follows the browser language, with manual switching.
- Dark/light themes, defaulting to dark and using the LensboardGenerator navy/cyan visual palette.
- Bundled Square721 Cn BT Bold, three web-safe bundled alternatives, and local TTF/OTF upload.
- Searchable native lens selector plus adjustable font size, letter spacing, frame width, and INF top margin.
- Independent background, tick, and text colours. The cutting frame automatically contrasts with the background; transparent output uses a black frame.
- JSON, outlined SVG, outlined DXF, and DPI-tagged PNG exports. Vector exports contain no live text objects.
- All processing is local; no lens data, settings, or uploaded fonts leave the browser.

## Development / 开发

Requires Node.js 22 and pnpm 10.

```sh
pnpm install
pnpm dev
pnpm test
pnpm build
```

The production build uses `/HPF_label_generator/` as its base path and is deployed by GitHub Actions to GitHub Pages.

## Calculation / 计算

For focal length `f`, focusing extension `e` at ring angle `θ`, image distance is `v = f + eθ`. Object distance follows `1/f = 1/u + 1/v`. Labels show the total subject-to-image-plane distance `(u + v)` in metres, matching the original OSHPF generator.

## License

GPL-3.0-only. The bundled Roboto font files are distributed under the Apache License 2.0; Square721 Cn BT Bold was supplied with this project by the repository owner.
