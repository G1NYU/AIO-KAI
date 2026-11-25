// Runs only on the separate ebook origin. No native bridge, account data,
// remote book URL or arbitrary JavaScript commands are part of this protocol.
const stage = document.querySelector('#stage');
const allowedParent = location.origin === 'http://tsugi-books.localhost'
  ? 'http://aiostreams.localhost'
  : location.hostname === 'localhost' && location.protocol === 'http:'
    ? 'http://127.0.0.1:' + location.port : '';
const send = (type, data = {}) => parent.postMessage({channel:'tsugi-ebook', type, ...data}, allowedParent);
let view, pdf, page = 1, rendering, sequence = 0, opened = false;
let font = 18, flow = 'paginated', tone = 'dark';
const finite = (n,min,max,fallback) => typeof n === 'number' && Number.isFinite(n) ? Math.max(min,Math.min(max,n)) : fallback;
const clean = value => typeof value === 'string' ? value.slice(0,1000) : '';
function applyStyle() {
  const colors = tone === 'paper' ? ['#f5efdc','#30291e'] : tone === 'light' ? ['#fff','#202020'] : ['#15171b','#e8e6df'];
  stage.style.background = colors[0];
  if (!view?.renderer) return;
  view.renderer.setAttribute('flow',flow);
  view.renderer.setStyles?.('html { color-scheme: '+(tone==='dark'?'dark':'light')+'; background:'+colors[0]+' !important; color:'+colors[1]+' !important; } body { font-family:Georgia,serif !important; font-size:'+font+'px !important; line-height:1.65 !important; } p { line-height:1.65 !important; }');
}
function appearance(message) {
  font = finite(message.font,12,32,font);
  tone = ['dark','paper','light'].includes(message.tone) ? message.tone : tone;
  flow = message.flow === 'scrolled' ? 'scrolled' : 'paginated';
  applyStyle();
}
function flatten(items, depth=0, output=[]) {
  if (depth>8 || !Array.isArray(items)) return output;
  for (const item of items) {
    if (output.length>=500) break;
    if (typeof item?.href==='string' && typeof item?.label==='string' && item.href.length<=4000)
      output.push({label:clean(item.label),target:item.href});
    flatten(item?.subitems,depth+1,output);
  }
  return output;
}
async function renderPDF() {
  const id = ++sequence;
  rendering?.cancel();
  const current = await pdf.getPage(page);
  if (id !== sequence) return;
  const first = current.getViewport({scale:1});
  const scale = Math.min(2,Math.max(.3,(stage.clientWidth-28)/first.width));
  const viewport = current.getViewport({scale});
  const ratio = Math.min(2,window.devicePixelRatio||1);
  if (!Number.isFinite(viewport.width*viewport.height) || viewport.width*viewport.height*ratio*ratio>24_000_000)
    throw Error('Page too large');
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width*ratio); canvas.height = Math.ceil(viewport.height*ratio);
  canvas.style.width = viewport.width+'px'; canvas.style.height = viewport.height+'px';
  const task = current.render({canvasContext:canvas.getContext('2d'),viewport,transform:ratio===1?null:[ratio,0,0,ratio,0,0]});
  rendering = task;
  try { await task.promise; } catch(error) {
    if (id!==sequence || error?.name==='RenderingCancelledException') return;
    throw error;
  }
  if (id!==sequence) return;
  stage.replaceChildren(canvas); stage.scrollTop=0;
  send('progress',{position:page,fraction:page/pdf.numPages});
}
async function open(message) {
  const file=message.file;
  if (opened || !(file instanceof File) || file.size<=0 || file.size>128*1024*1024) throw Error('Invalid local file');
  const bytes=new Uint8Array(await file.slice(0,5).arrayBuffer());
  opened=true;
  appearance(message);
  if (/\.pdf$/i.test(file.name) && bytes.join(',')==='37,80,68,70,45') {
    const engine=await import('./engine/vendor/pdfjs/pdf.mjs');
    engine.GlobalWorkerOptions.workerSrc=new URL('./engine/vendor/pdfjs/pdf.worker.mjs',import.meta.url).href;
    pdf=await engine.getDocument({
      data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,enableXfa:false,cMapPacked:true,
      cMapUrl:new URL('./engine/vendor/pdfjs/cmaps/',import.meta.url).href,
      standardFontDataUrl:new URL('./engine/vendor/pdfjs/standard_fonts/',import.meta.url).href,
    }).promise;
    if(pdf.numPages<1||pdf.numPages>20000)throw Error('Unsupported page count');
    page=Math.trunc(finite(message.position,1,pdf.numPages,1)); stage.classList.add('pdf');
    await renderPDF();
    send('opened',{title:file.name.replace(/\.pdf$/i,''),format:'pdf',pages:pdf.numPages,toc:[]});
  } else if (/\.epub$/i.test(file.name) && bytes[0]===80 && bytes[1]===75 && bytes[2]===3 && bytes[3]===4) {
    const engine=await import('./engine/view.js');
    // Force a normal EPUB MIME/name so other Foliate formats are never selected.
    const book=await engine.makeBook(new File([file],'local.epub',{type:'application/epub+zip'}));
    if(!book?.sections?.length||book.sections.length>5000)throw Error('Unsupported EPUB');
    view=document.createElement('foliate-view');
    view.addEventListener('external-link',event=>event.preventDefault());
    view.addEventListener('relocate',event=>{
      const detail=event.detail||{};
      if(typeof detail.cfi==='string'&&detail.cfi.length<=4000)
        send('progress',{position:detail.cfi,fraction:finite(detail.fraction,0,1,0)});
    });
    stage.append(view);
    await view.open(book);
    applyStyle();
    await view.init({lastLocation:typeof message.position==='string'&&message.position.startsWith('epubcfi(')?message.position:null,showTextStart:true});
    const raw=book.metadata?.title;
    const title=typeof raw==='string'?raw:raw&&typeof raw==='object'?Object.values(raw).find(v=>typeof v==='string'):'';
    send('opened',{title:clean(title)||file.name.replace(/\.epub$/i,''),format:'epub',toc:flatten(book.toc)});
  } else throw Error('Unsupported book type');
}
async function handle(message) {
  switch(message.type) {
    case 'hello':send('ready');break;
    case 'open':await open(message);break;
    case 'next':
      if(pdf){if(page<pdf.numPages){page++;await renderPDF();}}
      else if(view?.renderer)await view.next();break;
    case 'prev':
      if(pdf){if(page>1){page--;await renderPDF();}}
      else if(view?.renderer)await view.prev();break;
    case 'go':
      if(view?.renderer && typeof message.target==='string' && message.target.length<=4000)await view.goTo(message.target);
      else if(pdf && typeof message.target==='number'){page=Math.trunc(finite(message.target,1,pdf.numPages,page));await renderPDF();}
      break;
    case 'appearance':appearance(message);break;
  }
}
if(window.parent!==window && allowedParent) {
  window.addEventListener('message',event=>{
    if(event.origin!==allowedParent||event.source!==parent||event.data?.channel!=='tsugi-ebook')return;
    void handle(event.data).catch(()=>send('error'));
  });
  let timer;
  window.addEventListener('resize',()=>{clearTimeout(timer);timer=setTimeout(()=>{if(pdf)void renderPDF().catch(()=>send('error'));},180);});
  send('ready');
}
