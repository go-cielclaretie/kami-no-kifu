"""v1.2.0 regression, typography, layout and real-download tests.
Run after `node scripts/build.mjs`.
Requires Playwright/Chromium; output verification also uses Pillow/PyMuPDF.
Never installs, downloads or distributes a font.
"""
from pathlib import Path
import argparse, base64, json
from playwright.sync_api import sync_playwright


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--chromium',default=None);ap.add_argument('--output',default='qa-v120');a=ap.parse_args()
    root=Path(__file__).resolve().parent.parent;out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
    checks=[];errors=[]
    with sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=a.chromium,args=['--no-sandbox'])
        page=browser.new_page(bypass_csp=True, viewport={'width':1600,'height':1120},device_scale_factor=1)
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content((root/'standalone/index.html').read_text(),wait_until='load')
        def wait():page.wait_for_function('!KifuApp.state.raf&&!KifuApp.state.loading&&!KifuApp.state.busy')
        def check(name,expr):
            assert page.evaluate(expr),name
            checks.append(name)
        def load(name):page.locator('#fileInput').set_input_files(str(root/'samples'/name));wait()
        def setting(key,value):
            page.evaluate('''([key,value])=>{const e=[...document.querySelectorAll('[data-setting]')].find(e=>e.dataset.setting===key&&(e.type!=='radio'||e.value===String(value)));if(!e)throw Error(key);if(e.type==='radio'||e.type==='checkbox')e.checked=e.type==='radio'||value;else e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));}''',[key,value]);wait()
        def meta(key,value):page.locator('[data-meta="'+key+'"]').fill(value);wait()
        def save(name):
            with page.expect_download(timeout=60000) as task:page.locator('#downloadButton').click()
            task.value.save_as(str(out/name));wait();checks.append('actual UI download: '+name)
        def preview(name):
            (out/name).write_bytes(base64.b64decode(page.evaluate('document.querySelector("#previewCanvas").toDataURL().split(",")[1]')))
        check('every initial display-settings details is collapsed', 'document.querySelectorAll("#settingsBody details").length>5&&document.querySelectorAll("#settingsBody details[open]").length===0')
        load('01_demo_235.sgf')
        check('loading a valid SGF does not expand settings','document.querySelectorAll("#settingsBody details[open]").length===0')
        check('notes editor ready without a hidden publication prerequisite','!document.querySelector("#meta_notes").disabled&&KifuApp.state.meta.include.notes')
        setting('mode','split');setting('split','custom');setting('customSplit',73)
        setting('numberStyle','kanji')
        check('kanji UI forces split100 and saves custom73','KifuApp.state.settings.split==="100"&&Number(KifuApp.state.settings.paginationBeforeKanji.customSplit)===73')
        setting('numberStyle','arabic')
        check('Arabic UI restores split/custom/73','KifuApp.state.settings.mode==="split"&&KifuApp.state.settings.split==="custom"&&Number(KifuApp.state.settings.customSplit)===73&&KifuApp.state.plans.length===4')
        setting('mode','all');setting('numberStyle','kanji');setting('numberStyle','arabic')
        check('Arabic UI restores whole-game mode','KifuApp.state.settings.mode==="all"&&KifuApp.state.plans.length===1')
        setting('mode','split');setting('split','100')
        notes='中盤では厚みを生かして攻められた。\n終盤は先手のヨセを優先したい。所感の出力確認。'
        meta('notes',notes)
        check('typing notes automatically previews their last-board page','KifuApp.state.page===2&&KifuApp.state.plans[2].blocks.some(b=>b.role==="notes")&&document.querySelector("#notesPageHint").textContent.includes("3ページ")')
        preview('notes_horizontal_preview.png')
        preview_diff=page.evaluate('''()=>{const c=document.createElement('canvas'),a=document.querySelector('#previewCanvas');KifuRender.draw(c,KifuApp.state.plans[KifuApp.state.page],KifuApp.state.settings,110);if(c.width!==a.width||c.height!==a.height)throw Error('dimensions');const x=a.getContext('2d').getImageData(0,0,a.width,a.height).data,y=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let sum=0,max=0;for(let i=0;i<x.length;i++){const d=Math.abs(x[i]-y[i]);sum+=d;max=Math.max(d,max);}return {meanAbsoluteChannelDifference:sum/x.length,maxChannelDifference:max};}''')
        assert preview_diff['meanAbsoluteChannelDifference']<.05,preview_diff
        checks.append('preview vs shared renderer: identical dimensions, mean channel difference below 0.05/255')
        (out/'preview_pixel_comparison.json').write_text(json.dumps(preview_diff,indent=2))
        page.locator('#include_notes').uncheck();wait()
        check('notes can still be intentionally unpublished','!KifuApp.state.meta.include.notes&&KifuApp.state.plans.every(p=>p.blocks.every(b=>b.role!=="notes"))')
        page.locator('#include_notes').check();wait()
        check('publishing notes focuses their page again','KifuApp.state.page===2')
        page.evaluate('()=>{KifuApp.state.page=0;KifuApp.render();}');page.locator('#showNotesPage').click();wait()
        check('explicit notes-page button works','KifuApp.state.page===2')
        # These three formats all come from exactly the same page plans.
        for direction in ['horizontal','vertical']:
            setting('infoDirection',direction)
            preview('notes_'+direction+'_preview.png')
            exact=page.evaluate('''()=>{const p=KifuApp.state.plans[KifuApp.state.page],c=document.createElement('canvas');KifuRender.draw(c,p,KifuApp.state.settings,300);return {image:c.toDataURL().split(',')[1],notes:p.blocks.filter(b=>b.role==='notes').map(b=>({x:b.x,y:b.y,w:b.w,h:b.h||b.lines.length*b.lh})),pages:KifuApp.state.plans.length};}''')
            (out/('notes_'+direction+'_reference300.png')).write_bytes(base64.b64decode(exact.pop('image')))
            (out/('notes_'+direction+'_plan.json')).write_text(json.dumps(exact,ensure_ascii=False,indent=2))
            for fmt in ['pdf','png','jpg']:
                setting('format',fmt);save('notes_'+direction+('.pdf' if fmt=='pdf' else '_'+fmt+'.zip'))
        meta('black','Aoi12');meta('white','Ren34');meta('result','白1.5目勝ち');meta('komi','0.5');meta('date','2026-09-18')
        page.locator('[data-time="mode"][value="fischer"]').check();wait()
        page.locator('#time_minutes').fill('20');wait();page.locator('#time_increment').fill('10');wait()
        check('vertical Latin names are upright and name digits are individual','KifuApp.state.plans[0].blocks.filter(b=>b.kind==="vertical"&&b.role==="metadata-value"&&["black","white"].includes(b.field)).every(b=>b.columns.every(c=>c.tokens.filter(t=>t.digitPolicy!=="rank").every(t=>!t.rotate&&!t.tcy)))')
        check('vertical komi/result use half-point Japanese notation without modifying inputs','(()=>{const f=KifuRender.metadataFields(KifuApp.state.meta,true);return f.find(f=>f.key==="komi").value==="半目"&&f.find(f=>f.key==="result").value==="白1目半勝ち"&&KifuApp.state.meta.result==="白1.5目勝ち";})()')
        check('half-point formatting covers zero, multi-digit and trailing decimal zeros','[KifuRender.halfPoints("0.5目"),KifuRender.halfPoints("6.50目"),KifuRender.halfPoints("白10.5目勝ち")].join("|")==="半目|6目半|白10目半勝ち"')
        check('year is upright digit-by-digit and month/day use TCY with Japanese suffixes','(()=>{const b=KifuApp.state.plans[0].blocks.find(b=>b.role==="metadata-value"&&b.field==="date"),t=b.columns.flatMap(c=>c.tokens);return t.map(t=>t.raw).join("")==="2026年9月18日"&&t.slice(0,4).every(t=>!t.tcy&&!t.rotate)&&t.some(t=>t.text==="18"&&t.tcy);})()')
        check('Fischer time breaks at semantic lines only','(()=>{const b=KifuApp.state.plans[0].blocks.find(b=>b.role==="metadata-value"&&b.field==="time");return b.columns.map(c=>c.tokens.map(t=>t.raw).join("").trim()).join("|")==="フィッシャー式　20分|1手ごとに10秒加算";})()')
        check('all vertical values and continuation columns share the common value start','(()=>{const b=KifuApp.state.plans[0].blocks.filter(b=>b.role==="metadata-value");return b.length>5&&new Set(b.map(b=>b.y)).size===1&&b.every(b=>b.columns.every(c=>c.tokens[0]?.offset===0));})()')
        check('vertical label and value columns share the horizontal grid','KifuApp.state.plans[0].blocks.filter(b=>b.role==="metadata-value").every(b=>{const l=KifuApp.state.plans[0].blocks.find(l=>l.role==="metadata-label"&&l.field===b.field);return l.x===b.x&&l.w===b.w&&l.pitch===b.pitch&&l.y+l.h<b.y;})')
        preview('vertical_typography.png')
        # Multiple repeats including same-color replay and a setup reference.
        repeated='(;FF[4]GM[1]SZ[9]PB[黒]PW[白]RU[Japanese]KM[6.5]RE[B+R]AB[ab][ba][bc]AW[bb][ca][cc][db]PL[B];B[cb];W[hh];B[hg];W[bb];B[gh];W[gg];B[cb];W[ii];B[ih];W[bb])'
        page.locator('#fileInput').set_input_files({'name':'repeat_test.sgf','mimeType':'application/x-go-sgf','buffer':repeated.encode()});wait()
        page.locator('#resetSettings').click();wait()
        check('reset collapses display settings','document.querySelectorAll("#settingsBody details[open]").length===0')
        check('repeat options use one checkbox and exactly two labeled radios','document.querySelector("[data-setting=repeatStones]").type==="checkbox"&&[...document.querySelectorAll("[data-setting=repeatStoneStyle]")].map(e=>e.value).join("|")==="beside|onStone"')
        setting('repeatStones',True);setting('repeatStoneStyle','onStone');setting('repeatBracket','square')
        for side in ['left','right']:
            setting('repeatPosition',side)
            check(side+' multiple repeat entries are vertical without commas','KifuApp.state.plans[0].annotation.rows.length>=3&&KifuApp.state.plans[0].annotation.rows.every(r=>r.length===1&&!r[0].comma)')
            preview('repeat_'+side+'_on_stones.png')
        check('on-stone annotation contains actual image instructions, not circled Unicode','KifuApp.state.plans[0].annotation.rows.flat().every(e=>e.graphical&&e.graphical.parts.some(p=>p.kind==="stone"))')
        check('same-color repeated moves retain historical reference color','(()=>{const e=KifuApp.state.plans[0].annotation.rows.flat().find(e=>e.label==="7");return e.graphical.parts.filter(p=>p.kind==="stone").every(p=>p.color===1);})()')
        for side in ['top','bottom']:
            setting('repeatPosition',side)
            check(side+' entries retain comma-separated horizontal layout','KifuApp.state.plans[0].annotation.rows.flat().some(e=>e.comma===",")')
        setting('repeatStoneStyle','beside')
        check('beside option retains text plus small stone behavior','KifuApp.state.plans[0].annotation.rows.flat().every(e=>e.graphical===null)')
        setting('repeatStones',False)
        check('stone radio options hidden when unchecked','document.querySelector("#repeatStoneOptions").hidden')
        check('annotation header is not printed','KifuApp.state.plans.every(p=>p.blocks.every(b=>!b.lines||!b.lines.join("").includes("同地点着手")))')
        load('03_53_replays_46.sgf')
        matrix=page.evaluate('''()=>{const results=[],cv=document.createElement('canvas'),base=KifuCore.defaults(),model=KifuApp.state.model,meta=KifuApp.state.meta;let maxCenterError=0;
        for(const paper of ['A3','A4','A5','B5'])for(const orientation of ['portrait','landscape'])for(const infoDirection of ['horizontal','vertical'])for(const repeatPosition of ['top','bottom','left','right'])for(const style of ['none','beside','onStone']){
        const s={...base,paper,orientation,infoDirection,repeatPosition,repeatStones:style!=='none',repeatStoneStyle:style==='none'?'beside':style};
        const p=KifuRender.getPlans(model,s,meta)[0],g=KifuRender.draw(cv,p,s,40),a=p.annotation;
        const error=['top','bottom'].includes(repeatPosition)?Math.abs(a.x+a.w/2-g.centerX):Math.abs(a.y+a.h/2-g.centerY);maxCenterError=Math.max(maxCenterError,error);if(error>1e-6)throw Error('annotation center');
        if(a.x<0||a.y<0||a.x+a.w>p.W||a.y+a.h>p.H)throw Error('annotation bounds');
        const cap=p.blocks.find(b=>b.role==='captures');if(cap.align!=='right'||Math.abs(cap.x+cap.w-g.box.x-g.box.w)>.001||cap.y<g.box.y+g.box.h)throw Error('captures not lower right');
        if(a.vertical&&a.rows.some(r=>r.length!==1||r.some(e=>e.comma)))throw Error('side comma');
        results.push({paper,orientation,infoDirection,repeatPosition,style});}return {count:results.length,maxCenterError,results};}''')
        assert matrix['count']==192;checks.append('192 paper/orientation/direction/repeat-style cases: centered annotations and lower-right captures')
        (out/'layout_matrix.json').write_text(json.dumps(matrix,ensure_ascii=False,indent=2))
        coord=page.evaluate('''()=>{const rows=[];for(const f of ['num-kanji','lower-lower','upper-upper','num-lower','num-upper']){
        const t=KifuRender.horizontalCoordinateLayout(Array.from({length:19},(_,i)=>KifuRender.coordLabel(i+1,'h',f)),3.2,40);if(new Set(t.map(t=>t.baseline)).size!==1)throw Error('unstable baseline');rows.push({format:f,baseline:t[0].baseline});}return rows;}''')
        checks.append('all five horizontal coordinate formats use one baseline per row')
        (out/'coordinate_baselines.json').write_text(json.dumps(coord,ensure_ascii=False,indent=2))
        setting('coordFormat','lower-lower')
        # Long notes are not truncated. Recovery includes explicit newlines.
        setting('infoDirection','vertical');long_notes=('長文所感の継続確認。改行と文末を失わない。\n'*160).strip();meta('notes',long_notes)
        recovered=page.evaluate('KifuApp.state.plans.flatMap(p=>p.blocks.filter(b=>b.role==="notes"&&b.kind==="vertical").flatMap(b=>b.columns.flatMap(c=>c.tokens.map(t=>t.raw)))).join("")')
        assert recovered==long_notes;checks.append('long vertical notes survive continuation pages byte-for-byte')
        check('notes focus stays on the last board, not an invisible supplement','KifuApp.state.plans[KifuApp.state.page].type==="board"&&KifuApp.state.plans.some(p=>p.type==="notes")')
        # Render traces distinguish material implementations (no shell paths in agate).
        material=page.evaluate('''()=>{const traces=[];for(const [color,patterns] of [[1,['plain','glass','nachi','agate']],[2,['plain','glass','shell','agate']]])for(const pat of patterns){const cv=document.createElement('canvas');cv.width=cv.height=220;const c=cv.getContext('2d');let bezier=0,fillCount=0;const bz=c.bezierCurveTo.bind(c),fill=c.fill.bind(c);c.bezierCurveTo=(...args)=>{bezier++;bz(...args)};c.fill=(...args)=>{fillCount++;fill(...args)};KifuRender.stone(c,110,110,90,color,{...KifuCore.defaults(),blackPattern:pat,whitePattern:pat},1,2);traces.push({color,pattern:pat,bezier,fillCount});if(pat==='agate'&&bezier!==0)throw Error('agate shell stripes');if(pat==='shell'&&bezier<20)throw Error('missing shell');if(pat==='nachi'&&fillCount<1000)throw Error('missing grain');}return traces;}''')
        checks.append('agate has no shell-striping paths; shell and nachi have distinct material traces')
        (out/'material_traces.json').write_text(json.dumps(material,ensure_ascii=False,indent=2))
        # End with clean, useful desktop/mobile screenshots.
        load('03_53_replays_46.sgf');page.locator('#resetSettings').click();wait()
        setting('repeatStones',True);setting('repeatStoneStyle','onStone');setting('repeatPosition','right')
        page.screenshot(path=str(out/'desktop_v120.png'))
        page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(120);page.locator('#leftRail').click()
        check('mobile collapsible settings accessible without horizontal overflow','document.documentElement.scrollWidth<=innerWidth&&document.querySelector("[data-setting=repeatStones]")')
        page.screenshot(path=str(out/'mobile_v120.png'))
        assert not errors,errors;checks.append('no uncaught JavaScript errors')
        report={'version':'2.0.0 (v1.2 regression suite)','browser':browser.version,'check_count':len(checks),'checks':checks,'errors':errors,'geometry_cases':matrix['count'],'actual_GitHub_Pages_deployment_tested':False,'actual_mobile_device_tested':False,'gyosho_font_tested':False}
        (out/'revision_v120_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2));browser.close()

if __name__=='__main__':main()
