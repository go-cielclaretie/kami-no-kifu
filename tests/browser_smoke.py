"""Optional Chromium integration tests; no HTTP server or external request needed.
Usage: python tests/browser_smoke.py --chromium /usr/bin/chromium --output /tmp/kifu-qa
Requires Python 3.10+, playwright (installed Chromium or `playwright install chromium`).
The web app itself does not require Python/Playwright. No font is included here.
"""
from __future__ import annotations
import argparse, json, pathlib, time
from playwright.sync_api import sync_playwright

def main() -> None:
    parser=argparse.ArgumentParser()
    parser.add_argument('--chromium',default=None)
    parser.add_argument('--output',default='qa-output')
    args=parser.parse_args()
    root=pathlib.Path(__file__).resolve().parent.parent
    out=pathlib.Path(args.output);out.mkdir(parents=True,exist_ok=True)
    checks=[];errors=[]
    with sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'])
        page=browser.new_page(bypass_csp=True, viewport={'width':1440,'height':1050},device_scale_factor=1)
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content((root/'standalone/index.html').read_text(encoding='utf-8'),wait_until='load')
        def check(label,expression):
            assert page.evaluate(expression),label
            checks.append(label)
        def wait():
            page.wait_for_function('!KifuApp.state.raf && !KifuApp.state.loading && !KifuApp.state.busy')
        def load(filename):
            page.locator('#fileInput').set_input_files(str(root/'samples'/filename));wait()
        def setting(key,value):
            page.evaluate("""([key,value])=>{const list=Array.from(document.querySelectorAll('[data-setting]')).filter(e=>e.dataset.setting===key);
            const el=list.find(e=>e.type==='radio'?e.value===String(value):true); if(!el)throw Error(key);
            if(el.type==='checkbox')el.checked=value;else if(el.type==='radio')el.checked=true;else el.value=String(value);
            el.dispatchEvent(new Event('input',{bubbles:true}));}""",[key,value]);wait()
        def meta(key,value):
            page.evaluate("""([key,value])=>{const el=document.querySelector('[data-meta="'+key+'"]');el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));}""",[key,value]);wait()
        def save(name):
            with page.expect_download(timeout=45000) as task:page.locator('#downloadButton').click()
            download=task.value;download.save_as(str(out/name));wait()
            checks.append('download: '+name)
        check('initial download disabled','document.querySelector("#downloadButton").disabled')
        load('01_demo_235.sgf')
        check('235 legal moves and one whole-game page','KifuApp.state.model.total===235 && KifuApp.state.plans.length===1 && KifuApp.state.validation.ok')
        check('SGF names/ranks and time parsed','KifuApp.state.meta.black==="サンプル黒" && KifuApp.state.meta.blackRank==="10級" && KifuApp.state.meta.time.seconds==="30"')
        page.screenshot(path=str(out/'desktop_whole.png'))
        page.locator('[data-setting="mode"][value="split"]').evaluate('(e)=>e.closest("details").open=true');page.locator('[data-setting="mode"][value="split"]').check();wait()
        check('100-move split makes three pages','KifuApp.state.plans.length===3')
        check('page 2 carries stones without numbers','KifuApp.state.plans[1].diagram.stones.some(s=>s.carried && s.n===0)')
        page.screenshot(path=str(out/'desktop_split.png'))
        save('sample_235.pdf')
        setting('split','custom');setting('customSplit',75)
        check('custom split produces four pages','KifuApp.state.plans.length===4')
        setting('customSplit',0)
        check('zero split blocked','document.querySelector("#downloadButton").disabled && !!KifuApp.state.layoutError')
        setting('customSplit',75);setting('numberStyle','kanji')
        page.wait_for_function('KifuApp.fontState.status!=="loading"')
        check('kanji forces split100','KifuApp.state.settings.mode==="split" && KifuApp.state.settings.split==="100" && KifuApp.state.plans.length===3')
        check('missing gyosho font blocks export','KifuApp.fontState.status==="ready" || document.querySelector("#downloadButton").disabled')
        setting('numberStyle','arabic')
        meta('black','')
        check('missing required black name blocked','document.querySelector("#downloadButton").disabled')
        meta('black','サンプル黒')
        page.locator('#include_time').uncheck();wait()
        check('optional time can be omitted','KifuApp.state.meta.include.time===false && !document.querySelector("#downloadButton").disabled')
        page.locator('#include_time').check();wait()
        load('03_53_replays_46.sgf');setting('mode','all')
        check('requested replay example 53(46)','KifuApp.state.plans[0].diagram.repeats.some(e=>KifuCore.repeatText(e,KifuApp.state.plans[0].diagram,KifuApp.state.settings)==="53(46)")')
        setting('boardColor','kaya-old');setting('grain','itame');setting('blackPattern','nachi');setting('whitePattern','shell');setting('shadow',True)
        setting('repeatStones',True)
        for pos in ['top','bottom','right','left']:
            setting('repeatPosition',pos)
            check('replay location '+pos,'!KifuApp.state.layoutError && !!KifuApp.state.plans[0].annotation')
        setting('repeatPosition','bottom');setting('repeatBracket','square')
        check('square replay notation','KifuApp.state.plans[0].annotation.rows.flat().some(e=>e.text==="53[46]")')
        setting('format','png')
        save('replay_53.png')
        page.screenshot(path=str(out/'desktop_wood.png'))
        # Test complete renderer option matrix without downloading every variant.
        result=page.evaluate("""()=>{let count=0;const canvas=document.createElement('canvas');for(const paper of ['A3','A4','A5','B5'])for(const orientation of ['portrait','landscape'])for(const fmt of ['num-kanji','lower-lower','upper-upper','num-lower','num-upper']) {
        const s={...KifuApp.state.settings,paper,orientation,coordFormat:fmt};const plans=KifuRender.getPlans(KifuApp.state.model,s,KifuApp.state.meta);KifuRender.draw(canvas,plans[0],s,50);count++;}
        for(const boardColor of ['bw','kaya-new','kaya-old','hiba','katsura','custom'])for(const grain of ['plain','masame','itame']){
        const s={...KifuApp.state.settings,boardColor,grain};const p=KifuRender.getPlans(KifuApp.state.model,s,KifuApp.state.meta);KifuRender.draw(canvas,p[0],s,50);count++;}
        for(const blackPattern of ['plain','glass','nachi','agate'])for(const whitePattern of ['plain','glass','shell','agate']){
        const s={...KifuApp.state.settings,stoneColor:'custom',blackColor:'#425d99',whiteColor:'#ffbca2',blackPattern,whitePattern};const p=KifuRender.getPlans(KifuApp.state.model,s,KifuApp.state.meta);KifuRender.draw(canvas,p[0],s,50);count++;}return count;}""")
        assert result==74
        checks.append('74 renderer combinations (paper/orientation/coordinate + board/grain + stone patterns)')
        page.locator('#resetSettings').click();wait()
        load('02_capture_replay_9x9.sgf')
        setting('mode','split');setting('split','custom');setting('customSplit',5);setting('format','png')
        save('two_pages_png.zip')
        setting('format','jpg');save('two_pages_jpg.zip')
        setting('mode','all');save('single.jpg')
        setting('format','pdf');setting('paper','B5');setting('orientation','landscape');save('b5_landscape.pdf')
        # Exception remains visible and cancellation never produces a partial download.
        page.evaluate('()=>{window.originalGenerate=KifuExport.generate; KifuExport.generate=async()=>{throw new Error("TEST_EXPORT_ERROR")};}')
        page.locator('#downloadButton').click();wait()
        check('export error retained','document.querySelector("#errorBar").textContent.includes("TEST_EXPORT_ERROR") && !document.querySelector("#errorBar").hidden')
        page.evaluate('()=>{KifuExport.generate=originalGenerate;}')
        setting('paper','A4');setting('orientation','portrait')
        load('01_demo_235.sgf')
        setting('mode','split');setting('split','custom');setting('customSplit',5)
        page.locator('#downloadButton').click();page.locator('#cancelExport').click();wait()
        check('cancellation retained','KifuApp.state.exportError.includes("中止") && !document.querySelector("#errorBar").hidden')
        load('06_missing_metadata.sgf')
        check('missing SGF metadata not invented','KifuApp.state.meta.black==="" && KifuApp.state.meta.handicap==="" && document.querySelector("#downloadButton").disabled')
        load('invalid_occupied.sgf')
        check('occupied move rejected after valid file','KifuApp.state.validation && !KifuApp.state.validation.ok && !KifuApp.state.model && document.querySelector("#downloadButton").disabled')
        load('invalid_ko.sgf')
        check('immediate ko recapture rejected','!KifuApp.state.validation.ok')
        load('05_variations.sgf')
        check('all three branches checked','KifuApp.state.validation.ok && KifuApp.state.validation.branches.length===3')
        page.locator('#branchSelect').evaluate('(e)=>e.closest("details").open=true');page.locator('#branchSelect').select_option('2');wait()
        check('branch selection applies','KifuApp.state.branch===2')
        load('07_fischer.sgf')
        check('Fischer time parsed','KifuApp.state.meta.time.mode==="fischer" && KifuApp.state.meta.time.increment==="5"')
        # Drop uses a real DataTransfer, not an SGF parser shortcut.
        data=(root/'samples/02_capture_replay_9x9.sgf').read_text()
        page.evaluate("""sgf=>{const dt=new DataTransfer();dt.items.add(new File([sgf],'drop.sgf',{type:'application/x-go-sgf'}));document.querySelector('#center').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));}""",data);wait()
        check('drag and drop loads SGF','KifuApp.state.file.name==="drop.sgf" && KifuApp.state.model.total===10')
        # A literal SGF string is never injected into HTML.
        meta('black','<img src=x onerror=alert(1)>')
        check('imported text stays text','document.querySelectorAll("img").length===0 && KifuApp.state.meta.black.startsWith("<img")')
        meta('black','サンプル黒')
        page.locator('#include_notes').check();wait()
        meta('notes','所感の自動折り返しを確認するための長い文章。\n'*240)
        check('long notes use continuation pages','KifuApp.state.plans.some(p=>p.type==="notes") && !KifuApp.state.layoutError')
        setting('format','pdf');save('long_notes.pdf')
        page.locator('#include_notes').uncheck();wait()
        load('01_demo_235.sgf');page.locator('#resetSettings').click();wait();setting('mode','split')
        page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(120)
        check('mobile both panels initially stowed','document.querySelector("#workspace").classList.contains("left-collapsed") && document.querySelector("#workspace").classList.contains("right-collapsed")')
        check('mobile no document horizontal overflow','document.documentElement.scrollWidth<=innerWidth')
        page.screenshot(path=str(out/'mobile.png'))
        page.locator('#leftRail').click();page.wait_for_timeout(120)
        check('mobile left panel opens','!document.querySelector("#workspace").classList.contains("left-collapsed")')
        page.screenshot(path=str(out/'mobile_settings.png'))
        page.locator('#rightRail').click();page.wait_for_timeout(120)
        check('mobile one side panel at a time','document.querySelector("#workspace").classList.contains("left-collapsed") && !document.querySelector("#workspace").classList.contains("right-collapsed")')
        page.screenshot(path=str(out/'mobile_info.png'))
        assert not errors,errors
        checks.append('no uncaught browser JavaScript errors')
        version=browser.version;browser.close()
    report={'browser':'Chromium '+version,'check_count':len(checks),'checks':checks,'javascript_errors':errors,'font_note':'Actual gyosho appearance and same-site licensed font setup not tested; missing-font blocking checked.'}
    (out/'browser_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
