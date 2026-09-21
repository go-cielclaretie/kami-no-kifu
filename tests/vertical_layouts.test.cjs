'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const K = require('../js/core.js');

function fontSize(ctx) {
  const match = String(ctx.font || '').match(/([\d.]+)px/);
  return match ? Number(match[1]) : 10;
}

function fakeContext(draws = []) {
  return {
    font: '400 10px sans-serif',
    fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1,
    textAlign: 'left', textBaseline: 'alphabetic', direction: 'ltr',
    save() {}, restore() {}, setTransform() {}, translate() {}, rotate() {}, scale() {},
    fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    fillText(text, x, y) { draws.push({ text: String(text), x, y, font: this.font }); },
    measureText(text) {
      const size = fontSize(this), count = Math.max(1, Array.from(String(text)).length);
      const width = size * count;
      // Deliberately vary the tiny-size side bearings. The renderer must not
      // turn these per-glyph measurement differences into a wandering x axis.
      const code = String(text).codePointAt(0) || 0;
      const left = size * (.08 + (code % 5) * .035);
      return {
        width,
        actualBoundingBoxLeft: left,
        actualBoundingBoxRight: width - left,
        actualBoundingBoxAscent: size * .82,
        actualBoundingBoxDescent: size * .18
      };
    }
  };
}

function loadRenderer() {
  class FakeImage {}
  const measure = fakeContext();
  const context = vm.createContext({
    KifuCore: K,
    Image: FakeImage,
    document: { createElement: () => ({ getContext: () => measure }) },
    Intl, Promise, console
  });
  vm.runInContext(fs.readFileSync(require.resolve('../js/render.js'), 'utf8'), context);
  return context.KifuRender;
}

const R = loadRenderer();
const metadata = () => K.metadata(K.parse('(;GM[1]SZ[19]EV[第18回本因坊秀策記念大会]DT[2026-09-20]PC[日本棋院・東京本院]PB[藤沢里菜]BR[七段]PW[井山裕太]WR[九段]RU[Japanese]KM[6.5]RE[B+R])').games[0].nodes);

function verticalHeader(variant, pattern) {
  const settings = {
    ...K.defaults(),
    showTitle: false,
    infoDirection: 'vertical',
    infoLayoutVertical: variant,
    infoPatternVertical: String(pattern),
    _layoutVariant: variant,
    _infoBounds: { x: 10, w: 190 }
  };
  return R.header(metadata(), 210, 297, '', settings).blocks;
}

test('vertical glyphs use one fixed horizontal cell axis', () => {
  const draws = [], ctx = fakeContext(draws);
  const canvas = { getContext: () => ctx };
  const columns = R.verticalColumns('白番対局条件', 80, 3, 600, { spacing: 1.14 });
  R.draw(canvas, {
    W: 50, H: 60, margin: 5, type: 'note',
    blocks: [{ kind: 'vertical', role: 'metadata-label', columns, x: 10, y: 8, w: 4, h: 40, pitch: 4, color: '#222222' }]
  }, K.defaults(), 96);
  const glyphs = draws.filter(item => /^[白番対局条件]$/.test(item.text));
  assert.equal(glyphs.length, 6);
  assert.deepEqual([...new Set(glyphs.map(item => item.x))], [0]);
});

test('vertical cell pitch never permits glyph overlap', () => {
  for (const spacing of [.5, .94, 1.01, 1.12, 1.18]) {
    const tokens = R.verticalTokens('野狐囲碁', 10, 400, { spacing });
    assert.ok(tokens.every(token => token.advance >= 11.2 - 1e-9), `spacing ${spacing}`);
  }
});

test('all 25 vertical layouts keep non-space glyph cells separated', () => {
  for (const variant of ['table', 'balanced', 'tiles', 'groups', 'focus']) {
    for (let pattern = 1; pattern <= 5; pattern++) {
      for (const block of verticalHeader(variant, pattern).filter(item => item.kind === 'vertical')) {
        for (const column of block.columns) {
          const tokens = column.tokens.filter(token => !token.newline && !/^\s+$/.test(token.text || ''));
          for (let i = 1; i < tokens.length; i++) {
            assert.ok(tokens[i].offset - tokens[i - 1].offset >= tokens[i - 1].size * 1.12 - 1e-6,
              `${variant}${pattern} ${block.role}/${block.field || ''}`);
          }
        }
      }
    }
  }
});

test('classification layouts show 勝敗 only as the group heading', () => {
  for (let pattern = 1; pattern <= 5; pattern++) {
    const blocks = verticalHeader('groups', pattern);
    const resultGroups = blocks.filter(block => block.kind === 'vertical' && block.role === 'metadata-group')
      .filter(block => block.columns.flatMap(column => column.tokens).map(token => token.text || '').join('') === '勝敗');
    const resultLabels = blocks.filter(block => block.kind === 'vertical' && block.role === 'metadata-label' && block.field === 'result');
    const resultValues = blocks.filter(block => block.kind === 'vertical' && block.role === 'metadata-value' && block.field === 'result');
    assert.equal(resultGroups.length, 1, `D${pattern} group heading`);
    assert.equal(resultLabels.length, 0, `D${pattern} duplicate field label`);
    assert.equal(resultValues.length, 1, `D${pattern} result value`);
  }
});
