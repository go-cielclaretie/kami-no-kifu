"""v2 static-site integration tests: split HTTP resources, project subpaths,
settings import, fonts, and no SGF upload. --no-navigation is ONLY a fallback
for environments that prohibit browser navigation. In that mode the real HTTP
resources load under a synthetic base; CSP is bypassed and Storage is a mock.
No browser policy is changed. See the JSON report for the exact mode used.
"""
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.parse import urlparse, unquote
from urllib.request import urlopen
import argparse, json, time, base64
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw): super().__init__(*a, directory=str(ROOT), **kw)
    def log_message(self, *_): pass
    def translate_path(self, path):
        parsed = urlparse(path); p = unquote(parsed.path)
        for prefix in ['/KifuPrintWeb/', '/Other/', '/nested/site/']:
            if p.startswith(prefix): p = '/' + p[len(prefix):]; break
        return super().translate_path(p)
    def end_headers(self):
        # Only this test server needs CORS for the about:blank fallback fixture.
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store'); super().end_headers()

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--chromium',default=None);ap.add_argument('--output',default='qa-v200');ap.add_argument('--no-navigation',action='store_true');ap.add_argument('--test-font',help='Optional local TTF/OTF for API tests; no fonts are copied to outputs.')
    a=ap.parse_args();out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',0), Handler);Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
    checks=[];errors=[];requests=[]
    def ok(name, assertion):
        assert assertion,name
        checks.append(name);print('PASS',name,flush=True)
    with sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=a.chromium,args=['--no-sandbox'])
        context=b.new_context(viewport={'width':1500,'height':1050},accept_downloads=True,bypass_csp=a.no_navigation)
        p=context.new_page();p.on('pageerror',lambda e:errors.append(str(e)));p.on('request',lambda req:requests.append({'method':req.method,'url':req.url,'type':req.resource_type}))
        def wait(page=p, predicate='window.KifuApp && !KifuApp.state.loading && !KifuApp.state.raf && !KifuApp.state.busy', seconds=20):
            end=time.monotonic()+seconds
            while time.monotonic()<end:
                if page.evaluate('() => !!('+predicate+')'):return
                page.wait_for_timeout(30)
            raise AssertionError('wait timed out: '+predicate)
        def open_site(path='/KifuPrintWeb/',page=p):
            url=origin+path
            if a.no_navigation:
                page.evaluate("""() => {if(!window.__testStore){const data={};window.__testStore=data;Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>Object.hasOwn(data,k)?data[k]:null,setItem:(k,v)=>{data[k]=String(v)},removeItem:k=>{delete data[k]},clear:()=>Object.keys(data).forEach(k=>delete data[k])}})}}""")
                html=(ROOT/'index.html').read_text().replace('<head>','<head><base href="'+url+'">')
                page.set_content(html,wait_until='load')
            else:page.goto(url,wait_until='load')
            wait(page);page.evaluate('KifuRender.ready()')
        def setting(key,val):
            p.evaluate("""([key,val])=>{const els=[...document.querySelectorAll('[data-setting]')].filter(e=>e.dataset.setting===key),e=els.find(e=>e.type==='radio'?e.value===String(val):true);if(e.type==='radio'||e.type==='checkbox')e.checked=!!val;else e.value=String(val);e.dispatchEvent(new Event('input',{bubbles:true}))}""",[key,val]);wait()
        def load():p.locator('#fileInput').set_input_files(str(ROOT/'samples/01_demo_235.sgf'));wait()
        def save(filename):
            with p.expect_download(timeout=45000) as task:p.locator('#downloadButton').click()
            task.value.save_as(str(out/filename));wait()
        open_site()
        ok('new version / no GAS object / successful initialization',p.evaluate('KifuApp.version==="2.0.0" && !window.google && document.querySelector("#bootNotice").hidden'))
        ok('all display accordions initially closed',p.evaluate('document.querySelectorAll("#settingsBody details[open]").length===0'))
        ok('project URL derived from actual external script source',p.evaluate('KifuPlatform.baseURL')==origin+'/KifuPrintWeb/')
        resource_urls=[r['url'] for r in requests]
        ok('9 JavaScript modules really loaded over HTTP',len({u for u in resource_urls if '/js/' in u})==9)
        ok('texture loaded over HTTP and relative to repository',any('/KifuPrintWeb/assets/itame-grain.png' in u for u in resource_urls))
        # End-to-end resource validation under different public URL shapes.
        for prefix in ['/', '/KifuPrintWeb/', '/nested/site/']:
            for name in ['index.html','js/ui.js','css/styles.css','assets/itame-grain.png']:
                with urlopen(origin+prefix+name) as res:assert res.status==200 and res.read()
        ok('root/project/nested static resources return HTTP 200',True)
        load();ok('235 moves validated with real split modules',p.evaluate('KifuApp.state.validation.ok&&KifuApp.state.model.total===235'))
        setting('mode','split');setting('grain','itame');setting('boardColor','kaya-new');setting('blackPattern','nachi');setting('whitePattern','shell');setting('infoLayoutHorizontal','cards')
        ok('remote same-site texture is exportable, not a tainted Canvas',bool(p.evaluate('document.querySelector("#previewCanvas").toDataURL("image/png").length>1000')))
        setting('notesPlacement.all',True);setting('notesAllMode','individual')
        for n,note in enumerate(['布石：形を確認する。','中盤：方向と切断を確認する。','終盤：ヨセの順序を振り返る。'],1):
            p.locator(f'[data-note-page="{n}"]').fill(note);wait()
        before=len(requests)
        p.locator('#meta_black').fill('TEST_PRIVATE_NAME_723');wait()
        setting('format','pdf');save('split_http.pdf')
        setting('format','png');save('split_http_png.zip')
        setting('format','jpg');save('split_http_jpg.zip')
        ok('SGF/edit/exports send no network requests after assets are ready',len(requests)==before)
        ok('three distinct page comments retained',p.evaluate('KifuApp.state.plans.filter(p=>p.type==="board").every(p=>p.notesText===KifuApp.state.meta.notesByPage[p.source])'))
        p.screenshot(path=str(out/'desktop.png'))
        # Import a v1.3.0-compatible exported settings file.
        settings=p.evaluate('KifuPreferences.encode(KifuApp.state.settings)')
        record=json.loads(settings);assert record['schema']==1
        setting('infoLayoutHorizontal','bands')
        p.locator('#settingsFile').set_input_files({'name':'v130-settings.json','mimeType':'application/json','buffer':settings.encode()});wait(predicate='KifuApp.state.settings.infoLayoutHorizontal==="cards" && !KifuApp.state.raf')
        ok('legacy schema-1 settings import in actual UI',p.evaluate('KifuApp.state.settings.grain==="itame" && KifuApp.state.settings.infoLayoutHorizontal==="cards"'))
        p.locator('#saveSettings').click();wait();saved_key=p.evaluate('KifuPreferences.KEY')
        ok('saved settings exclude private match data',p.evaluate('!localStorage.getItem(KifuPreferences.KEY).includes("TEST_PRIVATE_NAME_723")&&!localStorage.getItem(KifuPreferences.KEY).includes("布石")'))
        open_site('/Other/');ok('different repository does not restore saved settings',p.evaluate('KifuApp.state.settings.grain==="plain" && KifuPreferences.KEY')!=saved_key and p.evaluate('KifuApp.state.settings.grain==="plain"'))
        open_site('/KifuPrintWeb/index.html');ok('index.html and directory URL share same settings scope',p.evaluate('KifuPreferences.KEY')==saved_key and p.evaluate('KifuApp.state.settings.grain==="itame"'))
        ok('restored display settings never restore SGF or text',p.evaluate('!KifuApp.state.model && KifuApp.state.meta.black==="" && KifuApp.state.meta.notes===""'))
        load();setting('mode','split');setting('split','custom');setting('customSplit',73)
        before=len(requests);setting('numberStyle','kanji');wait(predicate='KifuApp.fontState.status!=="loading"')
        ok('no default font download or Google request',len(requests)==before)
        ok('missing gyosho reports a usable local-file fallback',p.evaluate('KifuApp.fontState.status==="ready" || (KifuApp.fontState.status==="error"&&document.querySelector("#downloadButton").disabled&&document.querySelector("#fontStatus").textContent.includes("フォント"))'))
        if a.test_font:
            p.locator('#fontFile').set_input_files(a.test_font);wait(predicate='KifuApp.fontState.status==="ready"&&!KifuApp.state.raf')
            ok('manually selected test font loads without HTTP',len(requests)==before and p.evaluate('!document.querySelector("#downloadButton").disabled'))
            # This validates the file-loading API, not that a substitute is gyosho.
        p.locator('#fontFile').set_input_files({'name':'bad.ttf','mimeType':'font/ttf','buffer':b'<html>not-font</html>'});wait(predicate='KifuApp.fontState.status==="error"&&!KifuApp.state.raf')
        ok('invalid selected font blocks output with explicit error',p.evaluate('document.querySelector("#downloadButton").disabled && KifuApp.fontState.error.includes("フォント")'))
        setting('numberStyle','arabic')
        ok('Arabic restoration keeps previous custom split 73',p.evaluate('KifuApp.state.settings.split==="custom"&&Number(KifuApp.state.settings.customSplit)===73'))
        # Verify root and nested project paths in actual external-script loading.
        for path in ['/', '/nested/site/']:
            open_site(path);ok('browser modules boot at '+path,p.evaluate('KifuPlatform.baseURL')==origin+path)
        p.set_viewport_size({'width':390,'height':844});p.wait_for_timeout(100);p.locator('#leftRail').click()
        ok('mobile save control is visible and page fits width',p.evaluate('(()=>{const r=document.querySelector("#saveSettings").getBoundingClientRect();return r.bottom<innerHeight&&r.top>=0&&document.documentElement.scrollWidth<=innerWidth})()'))
        p.screenshot(path=str(out/'mobile.png'))
        ok('no unhandled JavaScript errors',not errors)
        ok('no Google or external-service requests',all(r['url'].startswith(origin) for r in requests))
        report={'version':'2.0.0','browser':b.version,'checks':checks,'count':len(checks),'errors':errors,'mode':'HTTP subresources under synthetic base; CSP bypass and in-memory Storage' if a.no_navigation else 'native HTTP navigation and localStorage','native_storage_verified':not a.no_navigation,'public_GitHub_deployment_verified':False,'font_API_with_substitute_verified':bool(a.test_font),'actual_gyosho_verified':False,'requests':requests}
        (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
        b.close()
    server.shutdown()
    print('PASSED',len(checks))
if __name__=='__main__':main()
