"""Revision 1.3 tests on a real localhost origin (persistence, UI and output).
Run: python tests/revision_v130.py --chromium /usr/bin/chromium --output qa-v130
No Google account, personal SGFs or external services are used.
"""
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from functools import partial
import argparse, json, base64
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--chromium',default=None);ap.add_argument('--output',default='qa-v130');ap.add_argument('--offline-store',action='store_true',help='Use an in-memory Storage double if browser navigation is administratively blocked.');a=ap.parse_args()
    out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(ROOT)));Thread(target=server.serve_forever,daemon=True).start()
    url=f'http://127.0.0.1:{server.server_port}/index.html'
    checks=[];errors=[]
    def open_page(pg):
        if not a.offline_store:
            pg.goto(url);return
        pg.evaluate('''()=>{if(!window.__testStore){const data={};window.__testStore=data;Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>Object.hasOwn(data,k)?data[k]:null,setItem:(k,v)=>{data[k]=String(v)},removeItem:k=>{delete data[k]},clear:()=>Object.keys(data).forEach(k=>delete data[k])}})}}''')
        pg.set_content((ROOT/'standalone/index.html').read_text(),wait_until='load')
    with sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=a.chromium,args=['--no-sandbox'])
        context=browser.new_context(bypass_csp=True, viewport={'width':1480,'height':1020},accept_downloads=True)
        page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        def wait(): page.wait_for_function('window.KifuApp && !KifuApp.state.raf && !KifuApp.state.loading && !KifuApp.state.busy')
        def check(name,expr):
            assert page.evaluate(expr),name
            checks.append(name);print('PASS',name,flush=True)
        def load(name='01_demo_235.sgf'):
            page.locator('#fileInput').set_input_files(str(ROOT/'samples'/name));wait()
        def setting(key,value):
            loc=page.locator('[data-setting="'+key+'"]');typ=loc.first.get_attribute('type')
            # Expand only the owning section, just as a user opens its summary.
            loc.first.evaluate('(el)=>{let p=el.closest("details");if(p)p.open=true}')
            if typ=='checkbox':loc.set_checked(value)
            elif typ=='radio':page.locator(f'[data-setting="{key}"][value="{value}"]').check()
            else:loc.fill(str(value));loc.dispatch_event('change')
            wait()
        def meta(key,value):page.locator('#meta_'+key).fill(value);wait()
        def snapshot(name):page.locator('#previewCanvas').screenshot(path=str(out/name))
        def download(name):
            assert not page.locator('#downloadButton').is_disabled(),page.locator('#downloadButton').get_attribute('title')
            with page.expect_download(timeout=180000) as dl:page.locator('#downloadButton').click()
            dl.value.save_as(str(out/name));wait();checks.append('download '+name)
        open_page(page);wait();page.evaluate('KifuRender.ready()')
        check('initial display sections collapsed','document.querySelectorAll("#settingsBody details[open]").length===0')
        check('persistent footer visible before loading SGF','(()=>{const r=document.querySelector("#saveSettings").getBoundingClientRect();return r.height>0&&r.top>0&&r.bottom<innerHeight})()')
        check('local storage initially empty','localStorage.getItem(KifuPreferences.KEY)===null')
        load();check('SGF maps period time to Japanese','KifuApp.state.meta.time.mode==="japanese"')
        setting('mode','split');setting('split','100');meta('notes','共通の所感。全体の構想と攻め合いを振り返る。')
        check('default last page preserves previous behavior','KifuApp.state.plans.filter(p=>p.type==="board"&&p.notesText).map(p=>p.source).join()==="3"')
        setting('notesPlacement.first',True)
        check('first and last checkboxes combine','KifuApp.state.plans.filter(p=>p.type==="board"&&p.notesText).map(p=>p.source).join()==="1,3"')
        setting('notesPlacement.custom',True);setting('notesPageNumbers','2')
        check('custom joins first and last','KifuApp.state.plans.filter(p=>p.type==="board"&&p.notesText).map(p=>p.source).join()==="1,2,3"')
        setting('notesPageNumbers','4')
        check('out of range custom page blocks download','document.querySelector("#downloadButton").disabled&&KifuApp.state.layoutError.includes("1〜3")')
        setting('notesPlacement.all',True)
        check('all takes priority, disables but retains other choices','!document.querySelector("#downloadButton").disabled&&KifuApp.state.settings.notesPlacement.custom&&[...document.querySelectorAll("[data-setting]")].find(e=>e.dataset.setting==="notesPlacement.custom").disabled')
        check('all repeats common note','KifuApp.state.plans.filter(p=>p.type==="board").every(p=>p.notesText===KifuApp.state.meta.notes)')
        setting('notesPlacement.all',False)
        check('unchecking all restores previous selections and their validation','KifuApp.state.settings.notesPageNumbers==="4"&&document.querySelector("#downloadButton").disabled')
        setting('notesPageNumbers','2');setting('notesPlacement.all',True);setting('notesAllMode','individual')
        check('per-page textareas match board count','document.querySelectorAll("[data-note-page]").length===3&&document.querySelector("#meta_notes").hidden')
        notes=['布石：右上の厚みを大切にし、急いで地を囲わない。','中盤：相手の弱い石を攻めながら、自分の石を補強する。','終盤：先手のヨセを優先し、最後まで手順を確認する。']
        for i,text in enumerate(notes,1):page.locator(f'[data-note-page="{i}"]').fill(text);wait()
        check('three different notes appear on intended boards','KifuApp.state.plans.filter(p=>p.type==="board").every(p=>p.notesText===KifuApp.state.meta.notesByPage[p.source])')
        check('editing page note moves preview to correct board','KifuApp.state.plans[KifuApp.state.page].source===3')
        setting('split','50');check('changing split creates five textareas and preserves prior strings','document.querySelectorAll("[data-note-page]").length===5&&KifuApp.state.meta.notesByPage[1].startsWith("布石")')
        page.locator('[data-note-page="5"]').fill('一時保持される5ページ目');wait();setting('split','100')
        check('now-hidden page text kept in memory but not output','KifuApp.state.meta.notesByPage[5]&&document.querySelectorAll("[data-note-page]").length===3&&KifuApp.state.plans.every(p=>p.notesText!==KifuApp.state.meta.notesByPage[5])')
        setting('notesAllMode','same');check('switching back to shared text preserves shared content','KifuApp.state.plans.filter(p=>p.type==="board").every(p=>p.notesText===KifuApp.state.meta.notes)')
        setting('notesAllMode','individual')
        # Input count/order for each new time mode and continuous keyboard input.
        for mode in ['japanese','canadian','fischer','absolute','byoyomi','nhk']:
            page.locator(f'[data-time="mode"][value="{mode}"]').check();wait()
            spec=page.evaluate('KifuCore.TIME_CONTROLS[KifuApp.state.meta.time.mode].fields')
            check('visible fields '+mode,'(()=>{const a=[...document.querySelectorAll("[id^=timeField_]")].filter(e=>!e.hidden).map(e=>e.id.slice(10));return a.join()===KifuCore.TIME_CONTROLS[KifuApp.state.meta.time.mode].fields.map(f=>f[0]).join()})()')
            for key,label,minimum,*_ in spec:
                vals={'minutes':'20','seconds':'60','periods':'10','increment':'10','overtimeMinutes':'5','moves':'25','perMoveSeconds':'30'}
                page.locator('#time_'+key).fill(vals[key]);wait()
            check('time values validate '+mode,'KifuCore.validateMetadata(KifuApp.state.meta).length===0')
        page.locator('#time_perMoveSeconds').fill('');page.locator('#time_perMoveSeconds').press_sequentially('123',delay=80);wait()
        check('time input keeps keyboard focus across edits','document.activeElement.id==="time_perMoveSeconds"&&KifuApp.state.meta.time.perMoveSeconds==="123"')
        page.locator('#time_perMoveSeconds').fill('30');wait()
        page.locator('#include_time').uncheck();wait()
        check('time unchecked hides all options','document.querySelector("#timeOptions").hidden')
        page.locator('#include_time').check();wait()
        meta('black','Aoi12');meta('blackRank','10級');meta('white','Shiro23');meta('whiteRank','15級');meta('result','白1.5目勝ち')
        setting('infoDirection','vertical')
        for variant in ['balanced','table','tiles','focus']:
            setting('infoLayoutVertical',variant)
            check('rank TCY, name digits upright '+variant,'(()=>{const bs=KifuApp.state.plans[0].blocks.filter(b=>b.kind==="vertical"&&b.role==="metadata-value"&&["black","white"].includes(b.field));return bs.length===2&&bs.every(b=>{const ts=b.columns.flatMap(c=>c.tokens);return ts.filter(t=>t.digitPolicy==="none").every(t=>!t.tcy&&!t.rotate)&&ts.some(t=>t.digitPolicy==="rank"&&t.tcy&&["10","15"].includes(t.text))})})()')
        setting('infoDirection','horizontal')
        check('only four requested horizontal layouts','[...document.querySelectorAll("[data-setting=infoLayoutHorizontal]")].map(e=>e.value).join()==="balanced,table,cards,bands"')
        check('only four requested vertical layouts','[...document.querySelectorAll("[data-setting=infoLayoutVertical]")].map(e=>e.value).join()==="balanced,table,tiles,focus"')
        setting('infoLayoutHorizontal','cards');setting('grain','itame');setting('boardColor','kaya-new');setting('blackPattern','nachi');setting('whitePattern','shell')
        snapshot('photo_grain_preview.png');page.screenshot(path=str(out/'desktop.png'))
        # Same plans/output path, with all distinct notes, for both directions.
        for direction in ['horizontal','vertical']:
            setting('infoDirection',direction)
            if direction=='vertical':setting('infoLayoutVertical','table')
            setting('format','pdf');download('notes_'+direction+'.pdf')
            setting('format','jpg');download('notes_'+direction+'_jpg.zip')
            setting('format','png');download('notes_'+direction+'_png.zip')
            refs=page.evaluate('''()=>KifuApp.state.plans.map(p=>{const c=document.createElement('canvas');KifuRender.draw(c,p,KifuApp.state.settings,300);return c.toDataURL('image/png').split(',')[1]})''')
            for i,data in enumerate(refs,1):(out/f'reference_{direction}_{i}.png').write_bytes(base64.b64decode(data))
        # Content and bounds matrix. Rendering at small DPI also catches paths.
        matrix=page.evaluate('''()=>{const out=[],S=KifuApp.state,R=KifuRender,K=KifuCore,cv=document.createElement('canvas');for(const direction of ['horizontal','vertical'])for(const variant of direction==='horizontal'?['balanced','table','cards','bands']:['balanced','table','tiles','focus'])for(const paper of ['A3','A4','A5','B5'])for(const orientation of ['portrait','landscape'])for(const mode of Object.keys(K.TIME_CONTROLS)){
        const s={...K.defaults(),mode:'split',split:'100',infoDirection:direction,[direction==='horizontal'?'infoLayoutHorizontal':'infoLayoutVertical']:variant,paper,orientation,notesPlacement:{all:true},notesAllMode:'individual'};
        const m=structuredClone(S.meta);m.time={...m.time,mode,minutes:'20',seconds:'60',periods:'10',increment:'10',overtimeMinutes:'5',moves:'25',perMoveSeconds:'30'};
        try{const plans=R.getPlans(S.model,s,m);for(const p of plans){const g=R.draw(cv,p,s,24);if(p.type!=='board')continue;const bs=p.blocks.filter(b=>(b.role||'').startsWith('metadata'));
        if(bs.some(b=>b.x<g.box.x-.10||b.x+b.w>g.box.x+g.box.w+.10))throw Error('metadata outside board width');
        if(bs.some(b=>b.y+(b.h||b.lines.length*b.lh)>p.area.y+.1))throw Error('metadata/board overlap');if(p.notesText!==m.notesByPage[p.source])throw Error('wrong notes');}
        out.push({direction,variant,paper,orientation,mode,ok:true});}catch(e){out.push({direction,variant,paper,orientation,mode,ok:false,error:e.message})}}
        return out}''')
        (out/'matrix.json').write_text(json.dumps(matrix,ensure_ascii=False,indent=2));assert len(matrix)==384;failed=[x for x in matrix if not x['ok']];assert not failed,failed[:10];checks.append('384 paper/direction/layout/time combinations with per-page comments; render/bounds pass')
        # Full long-text recovery for individually selected and shared all.
        recovery=page.evaluate('''()=>{const S=KifuApp.state,K=KifuCore,R=KifuRender,results=[];for(const dir of ['horizontal','vertical'])for(const mode of ['same','individual']){const m=structuredClone(S.meta),long=('所感の続き。配置を確認しながら文章を全て残す。\\n').repeat(80).trim();m.notes=long;m.notesByPage={1:long,2:long+'二',3:long+'三'};const s={...K.defaults(),mode:'split',split:'100',infoDirection:dir,notesPlacement:{all:true},notesAllMode:mode};const plans=R.getPlans(S.model,s,m);const count=plans.filter(p=>p.type==='board'&&p.notesText).length;if(count!==3)throw Error('lost notes');if(!plans.some(p=>p.type==='notes'))throw Error('missing supplement');if(mode==='same'&&new Set(plans.filter(p=>p.type==='notes').map(p=>p.source)).size!==1)throw Error('duplicate shared continuation');for(const source of mode==='same'?[1]:[1,2,3]){const parts=plans.filter(p=>(p.type==='board'&&p.source===source)||(p.type==='notes'&&p.source===source)).flatMap(p=>p.blocks.filter(b=>b.role==='notes'));const recovered=parts.map(b=>b.kind==='vertical'?b.columns.flatMap(c=>c.tokens.map(t=>t.raw)).join(''):b.lines.join('')).join('');const expected=mode==='same'?m.notes:m.notesByPage[source];if(recovered.replace(/\\n/g,'')!==expected.replace(/\\n/g,''))throw Error('long-note content loss '+dir+'/'+mode+'/'+source)}results.push({dir,mode,pages:plans.length,boardCount:count,contentRecovery:true});}return results}''')
        checks.append('long notes append supplements; common all continuation is not duplicated');(out/'continuations.json').write_text(json.dumps(recovery,indent=2))
        # Persistence: only explicit save, no game information or comments.
        setting('format','pdf');setting('infoLayoutVertical','tiles');setting('infoDirection','vertical');setting('notesPlacement.all',True)
        check('edits have not silently saved settings','localStorage.getItem(KifuPreferences.KEY)===null')
        page.locator('#saveSettings').click();wait()
        check('explicit save readback succeeds','JSON.parse(localStorage.getItem(KifuPreferences.KEY)).settings.infoLayoutVertical==="tiles"')
        check('saved JSON contains no names, notes text, or SGF','(()=>{const t=localStorage.getItem(KifuPreferences.KEY);return !t.includes("Aoi12")&&!t.includes("布石")&&!t.includes("Shiro23")&&!t.includes("NHK")&&!t.includes("notesByPage")})()')
        open_page(page);wait();page.evaluate('KifuRender.ready()')
        check('reload restores display settings before any SGF','KifuApp.state.settings.infoLayoutVertical==="tiles"&&KifuApp.state.settings.grain==="itame"&&KifuApp.state.settings.notesAllMode==="individual"&&!KifuApp.state.model')
        check('reload never restores private game content','KifuApp.state.meta.black===""&&KifuApp.state.meta.notes===""&&Object.keys(KifuApp.state.meta.notesByPage).length===0')
        check('restoration does not reopen accordions','document.querySelectorAll("#settingsBody details[open]").length===0')
        with page.expect_download() as d:page.locator('#exportSettings').click()
        d.value.save_as(str(out/'preferences.json'));wait()
        load();check('new SGF still clears individual notes','Object.keys(KifuApp.state.meta.notesByPage).length===0')
        setting('infoLayoutVertical','focus');page.locator('#settingsFile').set_input_files(str(out/'preferences.json'));wait()
        check('JSON settings import restores layouts','KifuApp.state.settings.infoLayoutVertical==="tiles"')
        page.locator('#settingsFile').set_input_files({'name':'invalid.json','mimeType':'application/json','buffer':b'{broken'});page.wait_for_function('document.querySelector("#settingsSaveStatus").dataset.error==="true"');wait()
        check('invalid JSON import leaves current settings intact','KifuApp.state.settings.infoLayoutVertical==="tiles"&&document.querySelector("#settingsSaveStatus").dataset.error==="true"')
        # Footer remains visible regardless of setting-panel scroll.
        page.evaluate('document.querySelectorAll("#settingsBody details").forEach(d=>d.open=true);document.querySelector("#settingsBody").scrollTop=99999')
        check('save footer does not scroll away','(()=>{const b=document.querySelector("#saveSettings").getBoundingClientRect();return b.top>0&&b.bottom<innerHeight})()')
        page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(150);page.locator('#leftRail').click()
        check('mobile footer visible without horizontal overflow','(()=>{const b=document.querySelector("#saveSettings").getBoundingClientRect();return b.top>0&&b.bottom<innerHeight&&document.documentElement.scrollWidth<=innerWidth})()')
        page.screenshot(path=str(out/'mobile.png'))
        isolated=browser.new_context(bypass_csp=True);other=isolated.new_page();open_page(other);other.wait_for_function('window.KifuApp');assert other.evaluate('KifuApp.state.settings.grain')=='plain';checks.append('separate browser profile does not receive saved settings');isolated.close()
        page.set_viewport_size({'width':1480,'height':1020});page.evaluate('localStorage.setItem(KifuPreferences.KEY,"{broken")');open_page(page);wait()
        check('corrupt saved settings fallback safely','KifuApp.state.settings.grain==="plain"&&document.querySelector("#settingsSaveStatus").dataset.error==="true"')
        blocked=browser.new_context(bypass_csp=True);blocked.add_init_script("Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new DOMException('blocked','SecurityError')}})")
        other=blocked.new_page();open_page(other);other.evaluate("Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new DOMException('blocked','SecurityError')}})");other.wait_for_function('window.KifuApp');other.locator('#saveSettings').click()
        assert other.locator('#settingsSaveStatus').get_attribute('data-error')=='true';checks.append('blocked storage produces explicit failure, not a false saved message');blocked.close()
        assert not errors,errors;checks.append('no unhandled JavaScript errors')
        report={'version':'2.0.0','browser':browser.version,'checks':checks,'check_count':len(checks),'matrix_cases':len(matrix),'errors':errors,'storage_backend':'in-memory Storage test double' if a.offline_store else 'browser localStorage on localhost','actual_GitHub_Pages_tested':False,'actual_gyosho_tested':False,'physical_device_tested':False}
        (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))
        browser.close()
    server.shutdown()
if __name__=='__main__':main()
