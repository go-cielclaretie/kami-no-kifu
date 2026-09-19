"""CSP enabled smoke on the hashed standalone build, without eval-based waits.
This checks that application code itself does not require unsafe-eval/inline.
It is not a claim that a public GitHub Pages URL has been tested.
"""
from pathlib import Path
import argparse,time,json
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser();ap.add_argument('--chromium',default=None);ap.add_argument('--output',type=Path,default=Path('qa-csp'));a=ap.parse_args();a.output.mkdir(parents=True,exist_ok=True);r=Path(__file__).resolve().parent.parent
with sync_playwright() as pw:
    b=pw.chromium.launch(executable_path=a.chromium,args=['--no-sandbox']);p=b.new_page(accept_downloads=True);errors=[];violations=[]
    p.on('pageerror',lambda e:errors.append(str(e)));p.on('console',lambda m:violations.append(m.text) if 'violates the following Content Security Policy' in m.text else None)
    p.set_content((r/'standalone/index.html').read_text(),wait_until='load');p.evaluate('KifuRender.ready()')
    def wait():
        deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            if p.evaluate('() => !!window.KifuApp && !KifuApp.state.loading && !KifuApp.state.raf && !KifuApp.state.busy'):return
            p.wait_for_timeout(25)
        raise AssertionError('Application did not settle')
    p.locator('#fileInput').set_input_files(str(r/'samples/01_demo_235.sgf'));wait()
    p.evaluate("() => {const s=KifuApp.state;s.settings={...s.settings,mode:'split',grain:'itame',boardColor:'kaya-new'};KifuApp.render()}");wait()
    for fmt in ['pdf','png','jpg']:
        p.evaluate("fmt=>{KifuApp.state.settings.format=fmt;KifuApp.render()}",fmt);wait()
        with p.expect_download(timeout=45000) as d:p.locator('#downloadButton').click()
        d.value.save_as(str(a.output/('csp.'+('pdf' if fmt=='pdf' else fmt+'.zip'))));wait()
    assert not errors and not violations,(errors,violations)
    report={'version':'2.0.0','CSP_bypassed':False,'fixture':'generated standalone with script hashes, about:blank','exports':['PDF','PNG ZIP','JPG ZIP'],'page_errors':errors,'CSP_violations':violations,'public_GitHub_verified':False}
    (a.output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));b.close()
print('PASS: CSP enabled application rendering and 3 downloads')
