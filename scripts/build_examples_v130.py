"""Generate a six-mode time-control PDF and a photo-grain replay example.
Uses the actual production renderer and exporter; all games are synthetic.
"""
from pathlib import Path
import argparse,base64,json
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser();ap.add_argument('--chromium',default=None);a=ap.parse_args();r=Path(__file__).resolve().parent.parent
with sync_playwright() as pw:
    b=pw.chromium.launch(executable_path=a.chromium,args=['--no-sandbox']);p=b.new_page(bypass_csp=True, viewport={'width':1480,'height':1020})
    p.set_content((r/'standalone/index.html').read_text());p.evaluate('KifuRender.ready()');p.locator('#fileInput').set_input_files(str(r/'samples/01_demo_235.sgf'));p.wait_for_function('!KifuApp.state.loading&&!KifuApp.state.raf')
    result=p.evaluate('''async()=>{const K=KifuCore,R=KifuRender,E=KifuExport,S=KifuApp.state,m=structuredClone(S.meta),s={...K.defaults(),mode:'split',split:'100',infoLayoutHorizontal:'table'};m.notes='';m.include.notes=false;const writer=new E.PdfWriter(6,'時間設定6方式・架空の検証用棋譜'),modes=Object.keys(K.TIME_CONTROLS),summaries=[];
    for(let i=0;i<modes.length;i++){const mode=modes[i];m.time={mode,minutes:'20',seconds:'60',periods:'10',increment:'10',overtimeMinutes:'5',moves:'25',perMoveSeconds:'30'};m.event='時間設定サンプル：'+K.TIME_CONTROLS[mode].label;const plan=R.getPlans(S.model,s,m)[0];plan.index=i+1;plan.totalPages=6;const cv=document.createElement('canvas');R.draw(cv,plan,s,300);const blob=await new Promise(resolve=>cv.toBlob(resolve,'image/jpeg',.98)),jpeg=E.jpegDensity(new Uint8Array(await blob.arrayBuffer()),300);writer.addPage(i,plan,cv,jpeg);summaries.push({mode,fields:K.TIME_CONTROLS[mode].fields.map(f=>f[1]),text:R.metadataFields(m).find(f=>f.key==='time').value})}
    const data=new Uint8Array(await writer.finish().arrayBuffer());let raw='';for(let i=0;i<data.length;i+=32768)raw+=String.fromCharCode(...data.subarray(i,i+32768));return {pdf:btoa(raw),summaries}}''')
    (r/'examples/time_controls.pdf').write_bytes(base64.b64decode(result.pop('pdf')));(r/'docs/test-results/time_samples.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    p.locator('#fileInput').set_input_files(str(r/'samples/03_53_replays_46.sgf'));p.wait_for_function('!KifuApp.state.loading&&!KifuApp.state.raf')
    p.evaluate('''()=>{const S=KifuApp.state;S.settings={...KifuCore.defaults(),grain:'itame',boardColor:'kaya-new',blackPattern:'nachi',whitePattern:'shell',repeatStones:true,repeatStoneStyle:'onStone',repeatBracket:'square',repeatPosition:'right'};S.meta.notes='添付写真を基に再構成した板目。番号付きの碁石と再着手注記も、同じ描画処理で印刷。';KifuApp.render()}''')
    with p.expect_download() as d:p.locator('#downloadButton').click()
    d.value.save_as(str(r/'examples/materials_replay.pdf'));p.wait_for_function('!KifuApp.state.busy');p.locator('#previewCanvas').screenshot(path=str(r/'docs/screenshots/board_photo_grain.png'))
    b.close()
print('Generated 6 time-control pages and photo-grain replay PDF.')
