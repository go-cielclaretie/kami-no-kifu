/** Static-site configuration. This file is public: never put secrets here.
 * Only the licensed font files listed below are served from this site.
 * Visitors can also enter a font family already installed on their device.
 * No third-party font service is contacted.
 */
(function (root) {
  'use strict';
  root.KifuConfig = Object.freeze({
    version: '2.0.0',
    localGyoshoNames: Object.freeze([
      '衡山毛筆フォント行書', 'KouzanGyousho', 'HGP行書体', 'HGS行書体', 'HG行書体'
    ]),
    defaultKanjiFontAsset: 'yuji-syuku',
    fontAssets: Object.freeze([
      { id: 'yuji-syuku', name: 'Yuji Syuku（行書）', family: 'KifuGyosho', path: 'fonts/Yuji_Syuku/YujiSyuku-Regular.ttf' },
      { id: 'yuji-mai', name: 'Yuji Mai', family: 'KifuFontYujiMai', path: 'fonts/Yuji_Mai/YujiMai-Regular.ttf' },
      { id: 'kaisei-regular', name: 'Kaisei HarunoUmi Regular', family: 'KifuFontKaiseiRegular', path: 'fonts/Kaisei_HarunoUmi/KaiseiHarunoUmi-Regular.ttf' },
      { id: 'kaisei-medium', name: 'Kaisei HarunoUmi Medium', family: 'KifuFontKaiseiMedium', path: 'fonts/Kaisei_HarunoUmi/KaiseiHarunoUmi-Medium.ttf' },
      { id: 'kaisei-bold', name: 'Kaisei HarunoUmi Bold', family: 'KifuFontKaiseiBold', path: 'fonts/Kaisei_HarunoUmi/KaiseiHarunoUmi-Bold.ttf' },
      { id: 'hina-mincho', name: 'Hina Mincho', family: 'KifuFontHinaMincho', path: 'fonts/Hina_Mincho/HinaMincho-Regular.ttf' },
      { id: 'dot-gothic', name: 'DotGothic16', family: 'KifuFontDotGothic16', path: 'fonts/DotGothic16/DotGothic16-Regular.ttf' },
      { id: 'potta-one', name: 'Potta One', family: 'KifuFontPottaOne', path: 'fonts/Potta_One/PottaOne-Regular.ttf' },
      { id: 'reggae-one', name: 'Reggae One', family: 'KifuFontReggaeOne', path: 'fonts/Reggae_One/ReggaeOne-Regular.ttf' }
    ].map(Object.freeze)),
    gyoshoFonts: Object.freeze([]),
    fontTimeoutMs: 20000
  });
})(globalThis);
