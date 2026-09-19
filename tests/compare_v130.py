"""Optional migration parity check. --baseline is the original v1.3.0 ZIP.
Compares 8 layouts x 6 time-control modes x 3 diagram pages at 60 dpi.
Only synthetic SGF is used; the baseline ZIP itself is not copied to outputs.
"""
from pathlib import Path
import argparse, zipfile, json, hashlib, base64
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser();ap.add_argument('--baseline',type=Path,required=True);ap.add_argument('--chromium',default=None);ap.add_argument('--output',type=Path,default=Path('qa-parity'));a=ap.parse_args();a.output.mkdir(parents=True,exist_ok=True)
r=Path(__file__).resolve().parent.parent
with zipfile.ZipFile(a.baseline) as z:
    names=[n for n in z.namelist() if n.endswith('/web/index.html')];assert len(names)==1
    old=z.read(names[0]).decode()
new=(r/'standalone/index.html').read_text();sgf=(r/'samples/01_demo_235.sgf').read_text()
expr='''sgf=>{const K=KifuCore,R=KifuRender,t=K.parse(sgf).games[0],model=K.replay(t,0,'japanese'),m=K.metadata(t.nodes),out=[],cv=document.createElement('canvas');m.notes='移行の検証。布石から終盤まで振り返る。';m.include.notes=true;
for(const direction of ['horizontal','vertical'])for(const layout of direction==='horizontal'?['balanced','table','cards','bands']:['balanced','table','tiles','focus'])for(const mode of Object.keys(K.TIME_CONTROLS)){
const s={...K.defaults(),mode:'split',split:'100',infoDirection:direction,[direction==='horizontal'?'infoLayoutHorizontal':'infoLayoutVertical']:layout,boardColor:'kaya-new',grain:'itame',blackPattern:'nachi',whitePattern:'shell',repeatStones:true,repeatStoneStyle:'onStone',notesPlacement:{all:true}};
m.time={mode,minutes:'20',seconds:'60',periods:'10',increment:'10',overtimeMinutes:'5',moves:'25',perMoveSeconds:'30'};m.include.time=true;
const plans=R.getPlans(model,s,m);out.push({direction,layout,mode,plan:JSON.stringify(plans),images:plans.map(p=>{R.draw(cv,p,s,60);return cv.toDataURL('image/png').split(',')[1]})});}return out}'''
with sync_playwright() as pw:
    b=pw.chromium.launch(executable_path=a.chromium,args=['--no-sandbox']);results=[]
    for content in [old,new]:
        p=b.new_page(bypass_csp=True);p.set_content(content,wait_until='load');p.evaluate('KifuRender.ready()');results.append(p.evaluate(expr,sgf));p.close()
    b.close()
checks=[]
for x,y in zip(*results):
    assert x['plan']==y['plan'],(x['direction'],x['layout'],x['mode'],'plan changed')
    hx=[hashlib.sha256(base64.b64decode(v)).hexdigest() for v in x['images']];hy=[hashlib.sha256(base64.b64decode(v)).hexdigest() for v in y['images']]
    assert hx==hy,(x['direction'],x['layout'],x['mode'],'image changed')
    checks.append({k:x[k] for k in ['direction','layout','mode']}|{'plan_identical':True,'canvas_png_identical':True,'pages':len(hx),'page_hashes':hy})
assert len(checks)==48
report={'baseline':'v1.3.0','current':'v2.0.0','dpi':60,'cases':48,'pages':sum(x['pages'] for x in checks),'checks':checks}
(a.output/'v130_parity.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print('PASS: 48 cases, 144 page plans and Canvas PNGs identical to v1.3.0')
