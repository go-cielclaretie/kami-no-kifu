'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const K = require('../js/core.js');

const measure = { font: '400 10px sans-serif', measureText(text) {
  const size = Number(this.font.match(/([\d.]+)px/)[1]);
  return { width: Array.from(String(text)).length * size };
} };
const context = vm.createContext({
  KifuCore: K, Image: class {},
  document: { createElement: () => ({ getContext: () => measure }) },
  Intl, Promise, console
});
vm.runInContext(fs.readFileSync(require.resolve('../js/render.js'), 'utf8'), context);
const R = context.KifuRender;

const sgf = '(;GM[1]SZ[19]PB[chisana]BR[10級]PW[V264963973]WR[10級]DT[2026-09-10]PC[野狐囲碁]RU[Chinese]KM[7.5]RE[W+1.5];B[dd];W[pp])';
const tree = K.parse(sgf).games[0];
const model = K.replay(tree, 0, '');
const meta = K.metadata(tree.nodes);

test('layout B decorations fit within the board width on preview and export plans', () => {
  for (const paper of ['A3', 'A4', 'A5', 'B5']) for (const orientation of ['portrait', 'landscape']) {
    for (const infoVariant of ['classic', 'accent', 'framed', 'airy']) {
      const settings = { ...K.defaults(), paper, orientation,
        infoDirection: 'horizontal', infoLayoutHorizontal: 'balanced', infoVariant };
      const page = R.getPlans(model, settings, meta)[0];
      const board = R.boardGeometry(page, settings).box;
      const decorations = page.blocks.filter(block => block.kind === 'rect' && block.role === 'metadata');
      assert.ok(decorations.length, `${paper}/${orientation}/${infoVariant}: no decoration`);
      for (const block of page.blocks.filter(block => block.role?.startsWith('metadata'))) {
        const stroke = block.stroke ? .085 : 0;
        assert.ok(block.x - stroke >= board.x - .01,
          `${paper}/${orientation}/${infoVariant}: left edge ${block.x - stroke} < ${board.x}`);
        assert.ok(block.x + block.w + stroke <= board.x + board.w + .01,
          `${paper}/${orientation}/${infoVariant}: right edge ${block.x + block.w + stroke} > ${board.x + board.w}: ${JSON.stringify(block)}`);
      }
    }
  }
});
