"""Inspect actual outputs made by browser_smoke.py and iframe_smoke.py.
Optional QA dependency: PyMuPDF, Pillow. Not needed to use the app.
"""
from pathlib import Path
import argparse, io, json, zipfile
import fitz
from PIL import Image
p=argparse.ArgumentParser();p.add_argument('directory',nargs='?',default='qa-output');args=p.parse_args()
q=Path(args.directory);result={}
for name in ['replay_53.png','single.jpg']:
    with Image.open(q/name) as im:
        im.load();assert im.size==(2480,3508)
        assert all(abs(float(x)-300)<.01 for x in im.info['dpi'])
        result[name]={'size':im.size,'dpi':im.info['dpi'],'mode':im.mode}
for name in ['two_pages_png.zip','two_pages_jpg.zip']:
    with zipfile.ZipFile(q/name) as z:
        assert z.testzip() is None;assert len(z.namelist())==2
        result[name]=[]
        for entry in z.namelist():
            with Image.open(io.BytesIO(z.read(entry))) as im:
                im.load();assert im.size==(2480,3508)
                assert all(abs(float(x)-300)<.01 for x in im.info['dpi'])
                result[name].append({'file':entry,'size':im.size,'dpi':im.info['dpi']})
for name,expected_count,expected_mm in [('sample_235.pdf',3,(210,297)),('b5_landscape.pdf',1,(257,182)),('long_notes.pdf',8,(210,297)),('iframe_sample.pdf',3,(210,297))]:
    if name=='iframe_sample.pdf' and not (q/name).exists():continue
    with fitz.open(q/name) as doc:
        assert len(doc)==expected_count
        sizes=[]
        for page in doc:
            mm=(page.rect.width*25.4/72,page.rect.height*25.4/72)
            assert all(abs(x-y)<.01 for x,y in zip(mm,expected_mm))
            assert len(page.get_images())==1
            sizes.append(tuple(round(x,3) for x in mm))
        # Save renderings for human visual inspection.
        for i in {0,len(doc)-1}:
            doc[i].get_pixmap(dpi=110,alpha=False).save(q/f'{Path(name).stem}_{i+1}.png')
        result[name]={'pages':len(doc),'mm':sizes,'image_per_page':1}
(q/'artifact_report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2))
