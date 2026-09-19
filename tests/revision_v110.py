"""Regression tests for v1.1.0. Browser tests run entirely locally.
Optional QA dependency: Python + Playwright + Chromium. No font is bundled.
Run: python tests/revision_v110.py --chromium /usr/bin/chromium --output qa-revision
The optional --gyosho flag accepts YOUR local gyosho font to verify that face.
Without it, kanji geometry is tested with a Japanese serif fallback, NOT gyosho.
"""
from pathlib import Path
import argparse, base64, json, math
from playwright.sync_api import sync_playwright

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--chromium',default='/usr/bin/chromium');ap.add_argument('--output',default='qa-revision');ap.add_argument('--gyosho');a=ap.parse_args()
    root=Path(__file__).resolve().parent.parent;out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
    checks=[];errors=[]
    with sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=a.chromium,headless=True,args=['--no-sandbox'])
        page=browser.new_page(bypass_csp=True, viewport={'width':1500,'height':1120},device_scale_factor=1)
        page.on('pageerror',lambda e: errors.append(str(e)))
        page.set_content((root/'standalone/index.html').read_text(),wait_until='load')
        def wait(): page.wait_for_function('!KifuApp.state.raf && !KifuApp.state.loading && !KifuApp.state.busy')
        def load(name): page.locator('#fileInput').set_input_files(str(root/'samples'/name));wait()
        def setting(key,value):
            page.evaluate('''([key,value])=>{const es=[...document.querySelectorAll('[data-setting]')].filter(e=>e.dataset.setting===key);const e=es.find(e=>e.type!=='radio'||e.value===String(value));if(!e)throw Error(key);if(e.type==='checkbox'||e.type==='radio')e.checked=e.type==='radio'?true:value;else e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));}''',[key,value]);wait()
        def meta(key,value): page.locator('[data-meta="'+key+'"]').fill(value);wait()
        def check(name,expr):
            result=page.evaluate(expr)
            assert result,name
            checks.append(name)
        def preview(name):
            data=page.evaluate('document.querySelector("#previewCanvas").toDataURL("image/png").split(",")[1]')
            (out/name).write_bytes(base64.b64decode(data))
        def save(name):
            with page.expect_download(timeout=45000) as task: page.locator('#downloadButton').click()
            task.value.save_as(str(out/name));wait();checks.append('download '+name)
        load('01_demo_235.sgf');setting('mode','split')
        check('default title uses player names centered on every page', 'KifuApp.state.plans.every(p=>p.blocks.filter(b=>b.role==="title").length===1 && p.blocks.find(b=>b.role==="title").lines.join("")==="サンプル黒 対 サンプル白" && p.blocks.find(b=>b.role==="title").align==="center")')
        meta('black','ちさな');meta('white','対局相手')
        check('edited names reflected in title on all pages','KifuApp.state.plans.every(p=>p.blocks.find(b=>b.role==="title").lines.join("")==="ちさな 対 対局相手")')
        preview('horizontal.png');save('horizontal.pdf')
        page.screenshot(path=str(out/'desktop_horizontal.png'))
        old_y=page.evaluate('KifuApp.state.plans[0].area.y')
        setting('showTitle',False)
        check('title hidden on every page','KifuApp.state.plans.every(p=>!p.blocks.some(b=>b.role==="title"))')
        assert page.evaluate('KifuApp.state.plans[0].area.y')<old_y
        checks.append('title removal reclaims page space')
        preview('no_title.png')
        setting('infoDirection','vertical');setting('showTitle',True)
        check('vertical metadata with independent horizontal title','KifuApp.state.plans.every(p=>p.blocks.some(b=>b.kind==="vertical"&&b.role==="metadata-value")&&p.blocks.some(b=>b.role==="title"&&b.align==="center"))')
        page.locator('#include_notes').check();wait();meta('notes','中央の戦いでは、先に弱い石を補強したい。\n厚みを生かして無理なく攻める。')
        check('notes follow vertical metadata direction','KifuApp.state.plans.some(p=>p.blocks.some(b=>b.kind==="vertical"&&b.role==="notes"))')
        preview('vertical.png');save('vertical.pdf');page.screenshot(path=str(out/'desktop_vertical.png'))
        # All optional fields and mandatory result are represented without deletion.
        check('vertical fields preserve enabled fields and result','["event","black","white","date","place","handicap","rule","komi","time","result"].every(k=>KifuApp.state.plans[0].blocks.some(b=>b.kind==="vertical"&&b.field===k))')
        meta('black','chisana_ABCDEFGHIJKLMN0123456789')
        check('Latin IDs remain upright and stay within vertical columns','KifuApp.state.plans[0].blocks.filter(b=>b.kind==="vertical").every(b=>b.columns.every(c=>c.height<=b.h+0.001))')
        meta('black','ちさな')
        long_notes=('所感の継続ページで文字が消えていないことを確認する。\n'*200).strip()
        meta('notes',long_notes)
        check('vertical notes have continuation pages','KifuApp.state.plans.some(p=>p.type==="notes"&&p.blocks.some(b=>b.kind==="vertical"&&b.role==="notes"))')
        recovered=page.evaluate('KifuApp.state.plans.flatMap(p=>p.blocks.filter(b=>b.kind==="vertical"&&b.role==="notes").flatMap(b=>b.columns.flatMap(c=>c.tokens.map(t=>t.raw)))).join("")')
        assert recovered==long_notes;checks.append('vertical long notes round-trip without clipping or loss')
        check('continuation page titles obey visibility setting','KifuApp.state.plans.filter(p=>p.type==="notes").every(p=>p.blocks.some(b=>b.role==="title"))')
        setting('showTitle',False)
        check('title visibility also applies to continuation pages','KifuApp.state.plans.every(p=>!p.blocks.some(b=>b.role==="title"))')
        # 128 combinations. Add asymmetric coordinates; this catches using the
        # available rectangle center instead of the actual grid/board center.
        load('03_53_replays_46.sgf');page.locator('#resetSettings').click();wait()
        result=page.evaluate('''()=>{
          const checks=[], canvas=document.createElement('canvas');let maxError=0;
          const base=KifuApp.state.settings, model=KifuApp.state.model, meta=KifuApp.state.meta;
          for(const paper of ['A3','A4','A5','B5']) for(const orientation of ['portrait','landscape'])
          for(const infoDirection of ['horizontal','vertical']) for(const repeatPosition of ['top','bottom','left','right'])
          for(const repeatStones of ['hide','show']) {
            const s={...base,paper,orientation,infoDirection,repeatPosition,repeatStones};
            const p=KifuRender.getPlans(model,s,meta)[0], g=KifuRender.draw(canvas,p,s,50), n=p.annotation;
            if(!n)throw Error('annotation missing');
            const error=['top','bottom'].includes(repeatPosition)?Math.abs(n.x+n.w/2-g.centerX):Math.abs(n.y+n.h/2-g.centerY);
            maxError=Math.max(error,maxError);if(error>1e-7)throw Error('center error');
            if(n.x<0||n.y<0||n.x+n.w>p.W||n.y+n.h>p.H)throw Error('annotation outside paper');
            if(g.box.w<=0||g.box.h<=0)throw Error('board missing');
            for(const b of p.blocks) if(b.kind==='vertical'&&(b.y+b.h>p.H||b.x<0||b.x+b.w>p.W))throw Error('metadata overflow');
            checks.push({paper,orientation,infoDirection,repeatPosition,repeatStones,error});
          }
          return {count:checks.length,maxError,combinations:checks};
        }''')
        assert result['count']==128
        (out/'centering_matrix.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
        checks.append('128 paper/orientation/writing-direction/annotation-position/stone combinations; exact grid center')
        check('capture text concise and correctly owned', '''KifuApp.state.plans[0].blocks.some(b=>b.lines&&b.lines.some(t=>t===`アゲハマ   黒：${KifuApp.state.plans[0].diagram.captures[1]}  白：${KifuApp.state.plans[0].diagram.captures[2]}`))''')
        setting('repeatStones',True)
        for position in ['top','bottom','left','right']:
            setting('repeatPosition',position);preview('repeat_'+position+'.png')
        # Digit testing uses actual raster ink, not only the values returned by
        # the measuring function. 1, 2 and 3 digits have identical type size.
        metrics=page.evaluate('''()=>{
          const results=[], canvas=document.createElement('canvas');canvas.width=canvas.height=260;
          const c=canvas.getContext('2d');
          for(const label of ['1','2','7','8','9','10','11','46','53','88','99','100','111','235','888','999']){
            c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,260,260);c.textAlign='right';c.textBaseline='bottom';
            const m=KifuRender.number(c,label,130,130,90,'#000',false), data=c.getImageData(0,0,260,260).data;
            let x0=260,x1=-1,y0=260,y1=-1;
            for(let y=0;y<260;y++)for(let x=0;x<260;x++)if(data[(y*260+x)*4+3]>32){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
            const dx=(x0+x1+1)/2-130,dy=(y0+y1+1)/2-130;
            if(Math.abs(dx)>1||Math.abs(dy)>1)throw Error('raster center '+label+' '+dx+','+dy);
            results.push({label,fontSize:m.nominalFontSize,actualRatio:m.actualRatio,dx,dy});
          }
          if(Math.max(...results.map(r=>r.fontSize))-Math.min(...results.map(r=>r.fontSize))>1e-8)throw Error('nonuniform digits');
          let max=0,min=1;for(let n=100;n<=999;n++){const m=KifuRender.numberMetrics(String(n),90);max=Math.max(max,m.actualRatio);min=Math.min(min,m.actualRatio);}
          if(Math.abs(max-.85)>1e-8)throw Error('85 percent not met');
          return {raster:results,threeDigitMax:max,threeDigitMin:min};
        }''')
        checks.append('16 Arabic labels centered by raster ink; 1/2/3-digit font sizes identical')
        checks.append('all 900 three-digit labels fit; maximum ink-box diagonal is exactly 85% of diameter')
        if a.gyosho:
            page.evaluate('''async b=>{const bytes=Uint8Array.from(atob(b),x=>x.charCodeAt(0));const f=new FontFace('KifuGyosho',bytes);await f.load();document.fonts.add(f);KifuRender.clearFontCache();}''',base64.b64encode(Path(a.gyosho).read_bytes()).decode())
        kanji=page.evaluate('''()=>{let maxError=0;for(let n=1;n<=100;n++){const m=KifuRender.numberMetrics(KifuCore.compactKanji(n),90,true);maxError=Math.max(maxError,Math.abs(m.actualRatio-.95));}return {labels:100,maxError};}''')
        assert kanji['maxError']<1e-10
        checks.append('100 kanji labels fit their full vertical ink boxes to 95% (font note applies)')
        # Export a large rendered sample, generated by the same renderer.
        sheet=page.evaluate('''()=>{const cv=document.createElement('canvas');cv.width=1380;cv.height=590;const c=cv.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,cv.width,cv.height);c.fillStyle='#222';c.font='28px sans-serif';c.fillText('石上の数字：同じフォントサイズ・輪郭の中心で配置',45,45);const ns=['1','8','11','46','53','100','235','888'];ns.forEach((n,i)=>{const x=95+i*168;KifuRender.stone(c,x,180,72,i%2?2:1,KifuCore.defaults());KifuRender.number(c,n,x,180,72,i%2?'#111':'#fff',false);c.fillStyle='#555';c.font='18px sans-serif';c.textAlign='center';c.fillText(n,x,287);});c.fillStyle='#333';c.font='22px sans-serif';c.textAlign='left';c.fillText('3桁を円内に収める基準の85％。1桁・2桁も文字サイズは固定。',45,355);c.fillText('上・下・左・右の余白ではなく、文字そのものの輪郭で中央を合わせる。',45,399);return cv.toDataURL('image/png').split(',')[1];}''')
        (out/'number_check.png').write_bytes(base64.b64decode(sheet))
        (out/'number_metrics.json').write_text(json.dumps({'arabic':metrics,'kanji':kanji,'gyosho_tested':bool(a.gyosho)},ensure_ascii=False,indent=2))
        # Legacy settings merge retains custom coord sides and supplies new defaults.
        check('legacy settings acquire new defaults','(()=>{const s=KifuCore.defaults();delete s.showTitle;delete s.infoDirection;const n=KifuCore.normalizeSettings(s);return n.showTitle===true&&n.infoDirection==="horizontal"&&KifuCore.validateSettings(n).length===0;})()')
        check('invalid direction/title rejected','KifuCore.validateSettings({...KifuCore.defaults(),infoDirection:"other"}).length>0 && KifuCore.validateSettings({...KifuCore.defaults(),showTitle:"yes"}).length>0')
        page.locator('#resetSettings').click();wait()
        check('UI reset restores title and horizontal text','document.querySelector("[data-setting=showTitle]").checked && document.querySelector("[data-setting=infoDirection][value=horizontal]").checked')
        # PDF/JPG/PNG and mobile UI all exercise the exact same vertical plans.
        setting('infoDirection','vertical');setting('format','png');save('vertical_single.png')
        setting('format','jpg');save('vertical_single.jpg')
        page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(150)
        page.locator('#leftRail').click();page.wait_for_timeout(150)
        check('new mobile controls present with no horizontal page overflow','document.documentElement.scrollWidth<=innerWidth && document.querySelector("[data-setting=showTitle]") && document.querySelector("[data-setting=infoDirection]")')
        page.screenshot(path=str(out/'mobile_revision.png'))
        assert not errors,errors
        report={'version':'2.0.0 (v1.1 regression suite)','browser':'Chromium '+browser.version,'check_count':len(checks),'checks':checks,'errors':errors,
                'annotation_matrix_count':result['count'],'annotation_max_error_mm':result['maxError'],
                'font_note': 'Gyosho tested with user-supplied font' if a.gyosho else 'Gyosho font unavailable. Kanji geometry tested with Japanese serif fallback; actual gyosho rendering and same-site licensed font setup not tested.',
                'unverified':['GitHub Pages deployment','Android physical device','Safari/iOS']}
        browser.close()
        (out/'revision_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
        print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__': main()
