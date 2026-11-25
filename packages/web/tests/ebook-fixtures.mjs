// Original minimal books. No copyrighted or network content.
export function pdfFixture() {
  const page = label => 'BT /F1 24 Tf 40 700 Td ('+label+') Tj ET\n';
  const stream = label => '<< /Length '+Buffer.byteLength(page(label))+' >>\nstream\n'+page(label)+'endstream';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream('Tsugi original page one'),stream('Tsugi original page two'),
  ];
  let document='%PDF-1.4\n';
  const offsets=[0];
  for (const [i,obj] of objects.entries()) { offsets.push(Buffer.byteLength(document)); document+=(i+1)+' 0 obj\n'+obj+'\nendobj\n'; }
  const xref=Buffer.byteLength(document);
  document+='xref\n0 '+offsets.length+'\n0000000000 65535 f \n'+offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
  return Buffer.from(document);
}
function crc32(buffer) {
  let crc=0xffffffff;
  for (const byte of buffer) { crc^=byte; for(let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
  return (crc^0xffffffff)>>>0;
}
function storedZip(entries) {
  const local=[],central=[];let offset=0;
  for(const [name,content] of Object.entries(entries)){
    const n=Buffer.from(name),data=Buffer.from(content),crc=crc32(data);
    const a=Buffer.alloc(30);a.writeUInt32LE(0x04034b50);a.writeUInt16LE(20,4);a.writeUInt32LE(crc,14);a.writeUInt32LE(data.length,18);a.writeUInt32LE(data.length,22);a.writeUInt16LE(n.length,26);
    const b=Buffer.alloc(46);b.writeUInt32LE(0x02014b50);b.writeUInt16LE(20,4);b.writeUInt16LE(20,6);b.writeUInt32LE(crc,16);b.writeUInt32LE(data.length,20);b.writeUInt32LE(data.length,24);b.writeUInt16LE(n.length,28);b.writeUInt32LE(offset,42);
    local.push(a,n,data);central.push(b,n);offset+=a.length+n.length+data.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22),count=Object.keys(entries).length;
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
export function epubFixture() {
  const chapter=(title,body)=>'<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>'+title+'</title></head><body><h1>'+title+'</h1><p>'+body+'</p><script>document.body.setAttribute("data-unsafe-script-ran","yes")</script></body></html>';
  return storedZip({
    mimetype:'application/epub+zip',
    'META-INF/container.xml':'<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'EPUB/book.opf':'<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">tsugi-original-fixture</dc:identifier><dc:title>Tsugi Original EPUB</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>',
    'EPUB/nav.xhtml':'<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="one.xhtml">Chapter one</a></li><li><a href="two.xhtml">Chapter two</a></li></ol></nav></body></html>',
    'EPUB/one.xhtml':chapter('Chapter one','Original words for the first chapter.'),
    'EPUB/two.xhtml':chapter('Chapter two','Original words for the second chapter.'),
  });
}
