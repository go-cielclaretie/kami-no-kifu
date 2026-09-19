/** Static-site configuration. This file is public: never put secrets here.
 * Font binaries are NOT bundled. An operator may add a licensed web font to
 * this same site and list its relative path here. Otherwise visitors can pick
 * a font already on their device. No third-party font service is contacted.
 */
(function (root) {
  'use strict';
  root.KifuConfig = Object.freeze({
    version: '2.0.0',
    localGyoshoNames: Object.freeze([
      '衡山毛筆フォント行書', 'KouzanGyousho', 'HGP行書体', 'HGS行書体', 'HG行書体'
    ]),
    // Example (uncomment only after placing a legally publishable font):
    // gyoshoFonts: [{ path: 'assets/fonts/gyosho.woff2', name: '行書体' }],
    gyoshoFonts: Object.freeze([]),
    fontTimeoutMs: 20000
  });
})(globalThis);
