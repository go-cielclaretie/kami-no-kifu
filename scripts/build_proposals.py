"""Build the self-contained layout viewer and render all eight production layout plans.
Requires optional Python Playwright + Chromium. Run after build.mjs.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import argparse,base64,json
p=argparse.ArgumentParser();p.add_argument('--chromium',default=None);p.add_argument('--output',default=None);a=p.parse_args()
r=Path(__file__).resolve().parent.parent;out=Path(a.output) if a.output else r/'docs/layouts';out.mkdir(parents=True,exist_ok=True)
scripts='\n'.join((r/'js'/n).read_text() for n in ['core.js','render.js','export.js'])
sample=(r/'samples/01_demo_235.sgf').read_text();ui=(r/'scripts/proposals_ui.js').read_text()
html='''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>対局情報レイアウト比較｜Kifu Print Web v2.0.0</title><style>
*{box-sizing:border-box}body{margin:0;background:#eef1f3;color:#17232b;font:16px/1.75 system-ui,"Yu Gothic",sans-serif}header{background:#172a36;color:white;padding:22px max(24px,calc((100vw - 1120px)/2))}h1{font-size:24px;line-height:1.4;margin:0 0 8px}header p{font-size:13px;margin:0;color:#ccd7de}main{max-width:1168px;margin:24px auto;padding:0 24px}.toolbar{display:flex;gap:20px;align-items:end;flex-wrap:wrap;background:white;padding:18px;border-radius:8px}label{display:block;font-size:13px;font-weight:600}select,button{font:inherit;padding:8px 12px;border:1px solid #b4c1c8;border-radius:5px;background:white}button{background:#173e51;color:white;cursor:pointer}button:disabled{opacity:.5}#description{margin:18px 0 4px}small{color:#526773}#error{color:#a02015}canvas{display:block;width:min(100%,794px);height:auto;background:white;box-shadow:0 4px 20px #14233322;margin:22px auto 36px}.note{font-size:13px;margin-bottom:20px}</style>
<header><h1>対局情報レイアウト比較</h1><p>横書き4種類・縦書き4種類 ／ v2.0.0 ／ 対局情報はタイトルと盤面の間、盤面の横幅以内。</p></header><main><div class="toolbar"><div><label for="variant">レイアウト</label><select id="variant"></select></div><div><label for="density">掲載する情報量</label><select id="density"><option value="all">全項目</option><option value="standard">標準（日時・場所・段級位）</option><option value="minimal">必須項目だけ</option></select></div><button id="savePdf">表示中の見本をPDF保存</button></div><p id="description"></p><small>空欄の枠は作らず、選んだ情報量で再配置する。A4縦・架空の100手。本体の表示設定で選択できる8種類と同じ描画処理。</small><p id="error" role="alert"></p><canvas id="canvas"></canvas><p class="note">縦書き：英字と名前中の数字は1文字ずつ正立。段級位の数字は縦中横。西暦は1桁ずつ、月・日は縦中横。コミ・勝敗の「.5目」は「半目／目半」。持ち時間は意味のまとまりで改列する。フォントを外部取得しない独立した比較ページ。</p></main>'''
html+='<script>'+scripts.replace('</script','<\\/script')+'</script><script>const SAMPLE_SGF='+json.dumps(sample,ensure_ascii=False).replace('</','<\\/')+';\n'+ui+'</script></html>'
(r/'docs/LAYOUTS.html').write_text(html)
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=a.chromium,args=['--no-sandbox']);page=browser.new_page(bypass_csp=True, viewport={'width':1280,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.set_content(html,wait_until='load')
 result=page.evaluate('''async()=>{const results=[],pictures=[],writer=new KifuExport.PdfWriter(8,'対局情報レイアウト 8種類');for(let i=0;i<8;i++){
 for(const density of ['minimal','standard','all']){const {s,plans}=buildProposal(i,density),p=plans[0],g=R.boardGeometry(p,s),bs=p.blocks.filter(b=>(b.role||'').startsWith('metadata'));
 if(bs.some(b=>b.x<g.box.x-.1||b.x+b.w>g.box.x+g.box.w+.1))throw Error('metadata outside board width '+examples[i][0]);
 if(bs.some(b=>b.y+(b.h||b.lines.length*b.lh)>p.area.y+.1))throw Error('metadata/board overlap');
 if(p.infoBounds.w>g.box.w+.1)throw Error('width');results.push({id:examples[i][0],density,boardWidth:g.box.w,metadataWidth:p.infoBounds.w});
 if(density==='all'){p.index=i+1;p.totalPages=8;const c=document.createElement('canvas');R.draw(c,p,s,300);const blob=await new Promise(resolve=>c.toBlob(resolve,'image/jpeg',.98));writer.addPage(i,p,c,new Uint8Array(await blob.arrayBuffer()));R.draw(c,p,s,120);pictures.push({id:examples[i][0],image:c.toDataURL().split(',')[1],headerY:p.infoBounds.y,headerBottom:p.infoBounds.y+p.infoBounds.h,boardWidth:g.box.w});}}
 }const pdf=writer.finish(),buffer=new Uint8Array(await pdf.arrayBuffer());let str='';for(let i=0;i<buffer.length;i+=32768)str+=String.fromCharCode(...buffer.subarray(i,i+32768));return {results,pictures,pdf:btoa(str)};}''')
 (r/'docs/LAYOUTS.pdf').write_bytes(base64.b64decode(result.pop('pdf')))
 for pic in result.pop('pictures'):(out/(pic['id']+'.png')).write_bytes(base64.b64decode(pic['image']))
 (r/'docs/test-results/layout_proposals.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
 assert len(result['results'])==24 and not errors,errors
 page.screenshot(path=str(out/'viewer.png'));browser.close();print('PASS: 8 production layouts x 3 metadata densities; 8-page PDF; standalone viewer.')
