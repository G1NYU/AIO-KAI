/**
 * Tsugi-owned bootstrap for the pinned, unmodified Suwayomi server.
 * The native parent owns stdin exclusively. One startup byte releases the
 * job-assignment gate; subsequent EOF requests normal JVM shutdown.
 */
public final class TsugiReadLauncher {
    private TsugiReadLauncher() {}

    public static void main(String[] args) throws Exception {
        // Do not load upstream code until the parent has assigned the job.
        if (System.in.read() != 1) {
            return;
        }
        if (args.length != 0) {
            if (args.length == 3 && args[0].equals("--import-cbz")) {
                // A native-owned, heap/time-limited helper JVM. The classpath
                // contains this bootstrap only, never an archive or extension.
                try {
                    System.out.println(importCbz(java.nio.file.Path.of(args[1]), java.nio.file.Path.of(args[2])));
                } catch (Exception rejected) {
                    System.err.println("The CBZ archive could not be imported safely.");
                    System.exit(1);
                }
                return;
            }
            if (args.length == 2 && args[0].equals("--verify-source-preference")) {
                // Native-only protocol. Paths never come from a web message;
                // keys and expected values use the private stdin pipe, not
                // process arguments, output, logs or a portable export.
                try {
                    System.out.write(verifySourcePreference(java.nio.file.Path.of(args[1])) ? '1' : '0');
                } catch (Exception rejected) {
                    System.out.write('0');
                }
                System.out.flush();
                return;
            }
            // A separate, memory-limited JVM inspects archive metadata only.
            // Never put the candidate archive on the classpath or instantiate
            // its classes. The native broker supplies the private file path.
            if (args.length != 2 || !args[0].equals("--inspect-extension")) {
                System.exit(2);
            }
            try {
                inspectExtension(java.nio.file.Path.of(args[1]));
            } catch (Exception rejected) {
                System.err.println("Extension metadata could not be verified.");
                System.exit(1);
            }
            return;
        }
        Thread owner = new Thread(() -> {
            try {
                while (System.in.read() != -1) {
                    // Ignore all bytes. Only closure of the parent pipe matters.
                }
            } catch (java.io.IOException closed) {
                // A broken parent pipe also requests shutdown.
            }
            System.exit(0);
        }, "tsugi-parent-lifetime");
        owner.setDaemon(true);
        owner.start();

        // This is the exact Main-Class of Suwayomi v2.4.2373.
        // Use the ordinary classpath, not a modified upstream JAR.
        Class.forName("suwayomi.tachidesk.MainKt")
            .getMethod("main", String[].class)
            .invoke(null, (Object) new String[0]);
    }

    private static final int MANIFEST_LIMIT = 1024 * 1024;
    private static final String ANDROID = "http://schemas.android.com/apk/res/android";

    private static String privateString(java.io.DataInputStream input, int maximum) throws Exception {
        int size = input.readInt();
        if (size < 0 || size > maximum) throw new IllegalArgumentException();
        byte[] bytes = input.readNBytes(size);
        if (bytes.length != size) throw new IllegalArgumentException();
        return java.nio.charset.StandardCharsets.UTF_8.newDecoder()
            .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
            .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
            .decode(java.nio.ByteBuffer.wrap(bytes)).toString();
    }

    private static boolean verifySourcePreference(java.nio.file.Path data) throws Exception {
        var input = new java.io.DataInputStream(System.in);
        String source = privateString(input, 20);
        String key = privateString(input, 2048);
        String expected = privateString(input, 16384);
        if (input.read() != -1 || !Long.toString(Long.parseLong(source)).equals(source)
            || source.equals("0") || key.isEmpty()) throw new IllegalArgumentException();
        String file = "source_" + source + ".xml";
        var before = privateProperties(data.resolve("extension-recovery/pending/snapshot/settings").resolve(file), true);
        var after = privateProperties(data.resolve("settings").resolve(file), false);
        if (!expected.equals(after.remove(key))) return false;
        before.remove(key);
        return before.equals(after);
    }

    private static java.util.Map<String, String> privateProperties(java.nio.file.Path path, boolean missingAllowed) throws Exception {
        if (!java.nio.file.Files.exists(path, java.nio.file.LinkOption.NOFOLLOW_LINKS)) {
            if (missingAllowed) return new java.util.TreeMap<>();
            throw new IllegalArgumentException();
        }
        var attributes = java.nio.file.Files.readAttributes(path, java.nio.file.attribute.BasicFileAttributes.class,
            java.nio.file.LinkOption.NOFOLLOW_LINKS);
        if (!attributes.isRegularFile() || attributes.isSymbolicLink() || attributes.size() > MANIFEST_LIMIT) throw new IllegalArgumentException();
        byte[] bytes;
        try (var input = java.nio.file.Files.newInputStream(path)) {
            bytes = input.readNBytes(MANIFEST_LIMIT + 1);
        }
        if (bytes.length > MANIFEST_LIMIT || bytes.length != attributes.size()) throw new IllegalArgumentException();
        var factory = javax.xml.parsers.DocumentBuilderFactory.newInstance();
        factory.setFeature(javax.xml.XMLConstants.FEATURE_SECURE_PROCESSING, true);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
        factory.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        factory.setXIncludeAware(false);
        factory.setExpandEntityReferences(false);
        var builder = factory.newDocumentBuilder();
        builder.setEntityResolver((publicId, systemId) -> { throw new org.xml.sax.SAXException("External entities are not supported."); });
        // Do not allow a parser diagnostic to reveal a private setting value.
        builder.setErrorHandler(new org.xml.sax.helpers.DefaultHandler());
        var document = builder.parse(new java.io.ByteArrayInputStream(bytes));
        var type = document.getDoctype();
        if (type == null || !type.getName().equals("properties") || type.getPublicId() != null
            || !"http://java.sun.com/dtd/properties.dtd".equals(type.getSystemId())
            || (type.getInternalSubset() != null && !type.getInternalSubset().isBlank())) throw new IllegalArgumentException();
        var root = document.getDocumentElement();
        if (!root.getTagName().equals("properties") || root.getAttributes().getLength() > 1
            || (root.hasAttribute("version") && !root.getAttribute("version").equals("1.0"))) throw new IllegalArgumentException();
        if (root.getAttributes().getLength() == 1 && !root.hasAttribute("version")) throw new IllegalArgumentException();
        var result = new java.util.TreeMap<String, String>();
        var children = root.getChildNodes();
        for (int index = 0; index < children.getLength(); index++) {
            var node = children.item(index);
            if (node.getNodeType() == org.w3c.dom.Node.TEXT_NODE && node.getTextContent().isBlank()) continue;
            if (!(node instanceof org.w3c.dom.Element element)) throw new IllegalArgumentException();
            String value = "";
            var pieces = element.getChildNodes();
            StringBuilder text = new StringBuilder();
            for (int piece = 0; piece < pieces.getLength(); piece++) {
                var child = pieces.item(piece);
                if (child.getNodeType() != org.w3c.dom.Node.TEXT_NODE && child.getNodeType() != org.w3c.dom.Node.CDATA_SECTION_NODE)
                    throw new IllegalArgumentException();
                text.append(child.getNodeValue());
            }
            value = text.toString();
            if (element.getTagName().equals("comment") && element.getAttributes().getLength() == 0) continue;
            if (!element.getTagName().equals("entry") || element.getAttributes().getLength() != 1 || !element.hasAttribute("key")
                || result.size() >= 1000 || result.putIfAbsent(element.getAttribute("key"), value) != null) throw new IllegalArgumentException();
        }
        return result;
    }

    private static void inspectExtension(java.nio.file.Path path) throws Exception {
        byte[] manifest;
        try (java.util.zip.ZipFile archive = new java.util.zip.ZipFile(path.toFile())) {
            if (archive.size() > 20000) throw new IllegalArgumentException();
            int manifests = 0;
            var entries = archive.entries();
            while (entries.hasMoreElements()) {
                if (entries.nextElement().getName().equals("AndroidManifest.xml")) manifests++;
            }
            var entry = archive.getEntry("AndroidManifest.xml");
            if (manifests != 1 || entry == null || entry.isDirectory()
                || entry.getSize() < 1 || entry.getSize() > MANIFEST_LIMIT) {
                throw new IllegalArgumentException();
            }
            try (var input = archive.getInputStream(entry)) {
                manifest = input.readNBytes(MANIFEST_LIMIT + 1);
                if (manifest.length > MANIFEST_LIMIT) throw new IllegalArgumentException();
            }
        }
        // APKs use binary Android XML. Use the metadata-only parser already
        // present in the pinned server, via reflection so the bootstrap has
        // no compile-time dependency on upstream code. It never loads dex.
        if (path.toString().endsWith(".apk")) {
            var type = Class.forName("net.dongliu.apk.parser.ApkFile");
            Object apk = type.getConstructor(java.io.File.class).newInstance(path.toFile());
            try {
                String xml = (String) type.getMethod("getManifestXml").invoke(apk);
                if (xml.length() > MANIFEST_LIMIT) throw new IllegalArgumentException();
                manifest = xml.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                if (manifest.length > MANIFEST_LIMIT) throw new IllegalArgumentException();
            } finally {
                type.getMethod("close").invoke(apk);
            }
        }
        var factory = javax.xml.parsers.DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        factory.setXIncludeAware(false);
        factory.setExpandEntityReferences(false);
        var document = factory.newDocumentBuilder().parse(new java.io.ByteArrayInputStream(manifest));
        var root = document.getDocumentElement();
        if (!root.getTagName().equals("manifest")) throw new IllegalArgumentException();
        String packageName = root.getAttribute("package");
        String versionName = root.getAttributeNS(ANDROID, "versionName");
        int versionCode = Integer.parseInt(root.getAttributeNS(ANDROID, "versionCode"));
        boolean extension = false;
        var features = root.getElementsByTagName("uses-feature");
        for (int i = 0; i < features.getLength(); i++) {
            var feature = (org.w3c.dom.Element) features.item(i);
            if (feature.getAttributeNS(ANDROID, "name").equals("tachiyomi.extension")) extension = true;
        }
        var applications = root.getElementsByTagName("application");
        if (!extension || applications.getLength() != 1 || versionCode < 1) throw new IllegalArgumentException();
        String sourceClass = "";
        var metadata = ((org.w3c.dom.Element) applications.item(0)).getElementsByTagName("meta-data");
        for (int i = 0; i < metadata.getLength(); i++) {
            var value = (org.w3c.dom.Element) metadata.item(i);
            if (value.getAttributeNS(ANDROID, "name").equals("tachiyomi.extension.class")) {
                if (!sourceClass.isEmpty()) throw new IllegalArgumentException();
                sourceClass = value.getAttributeNS(ANDROID, "value");
            }
        }
        if (sourceClass.isEmpty()) throw new IllegalArgumentException();
        System.out.println("{\"package\":" + quoted(packageName) + ",\"versionName\":"
            + quoted(versionName) + ",\"versionCode\":" + versionCode
            + ",\"sourceClass\":" + quoted(sourceClass) + "}");
    }

    private static String quoted(String value) {
        if (value.isEmpty() || value.length() > 512) throw new IllegalArgumentException();
        StringBuilder result = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (Character.isISOControl(c) || Character.isSurrogate(c)) throw new IllegalArgumentException();
            if (c == '"' || c == '\\') result.append('\\');
            result.append(c);
        }
        return result.append('"').toString();
    }

    // No custom nested/anonymous classes: installed runtimes copy exactly
    // TsugiReadLauncher.class. Helpers use only standard JRE classes.
    static final long CBZ_MAX_ARCHIVE = 256L * 1024 * 1024;
    static final long CBZ_MAX_EXPANDED = 512L * 1024 * 1024;
    static final long CBZ_MAX_PAGE = 24L * 1024 * 1024;
    static final int CBZ_MAX_PAGES = 2000;
    static final int CBZ_MAX_ENTRIES = 4000;
    static final long CBZ_MAX_PIXELS = 32_000_000L;
    private static final int CBZ_MAX_DIMENSION = 100_000;
    private static final int CBZ_MAX_METADATA = 64 * 1024;
    private static final int CBZ_MAX_DIRECTORY = 4 * 1024 * 1024;

    private static IllegalArgumentException cbzInvalid() {
        // Never include a selected filename, entry name, metadata or decoder
        // diagnostic in a native-facing error or process output.
        return new IllegalArgumentException("Unsupported or invalid CBZ archive.");
    }

    private static int cbzU16(byte[] bytes, int at) {
        if (at < 0 || at > bytes.length - 2) throw cbzInvalid();
        return (bytes[at] & 255) | ((bytes[at + 1] & 255) << 8);
    }

    private static long cbzU32(byte[] bytes, int at) {
        return Integer.toUnsignedLong(cbzU16(bytes, at) | (cbzU16(bytes, at + 2) << 16));
    }

    private static byte[] cbzRead(java.io.RandomAccessFile file, long at, int size) throws Exception {
        if (at < 0 || size < 0 || size > CBZ_MAX_DIRECTORY || at > file.length() - size) throw cbzInvalid();
        byte[] bytes = new byte[size];
        file.seek(at);
        file.readFully(bytes);
        return bytes;
    }

    private static void cbzExtra(byte[] bytes, int start, int size) {
        int end = start + size;
        if (size > 4096 || start < 0 || end < start || end > bytes.length) throw cbzInvalid();
        while (start < end) {
            if (end - start < 4) throw cbzInvalid();
            int tag = cbzU16(bytes, start);
            int length = cbzU16(bytes, start + 2);
            start += 4;
            // ZIP64, alternate Unicode paths and AES need different contracts.
            if (tag == 1 || tag == 0x7075 || tag == 0x9901 || length > end - start) throw cbzInvalid();
            start += length;
        }
    }

    private static String cbzName(byte[] bytes, int flags) throws Exception {
        if (bytes.length == 0 || bytes.length > 512) throw cbzInvalid();
        var charset = (flags & 0x800) != 0 ? java.nio.charset.StandardCharsets.UTF_8 : java.nio.charset.Charset.forName("IBM437");
        String name = charset.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
            .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(bytes)).toString();
        if (name.startsWith("/") || name.indexOf('\\') >= 0 || name.chars().anyMatch(Character::isISOControl)) throw cbzInvalid();
        String path = name.endsWith("/") ? name.substring(0, name.length() - 1) : name;
        String[] parts = path.split("/", -1);
        if (parts.length == 0 || parts.length > 16) throw cbzInvalid();
        for (String part : parts) {
            if (part.isEmpty() || part.equals(".") || part.equals("..") || part.endsWith(".") || part.endsWith(" ")
                || part.chars().anyMatch(c -> "<>:\"|?*".indexOf(c) >= 0)) throw cbzInvalid();
            String base = part.split("\\.", 2)[0].stripTrailing().toUpperCase(java.util.Locale.ROOT);
            if (base.matches("CON|PRN|AUX|NUL|CONIN\\$|CONOUT\\$|COM[1-9¹²³]|LPT[1-9¹²³]")) throw cbzInvalid();
        }
        return name;
    }

    private static String cbzFold(String value) {
        return java.text.Normalizer.normalize(value, java.text.Normalizer.Form.NFC).toUpperCase(java.util.Locale.ROOT);
    }

    private static long cbzNumber(java.util.Map<String, Object> entry, String field) {
        return ((Number) entry.get(field)).longValue();
    }

    private static java.util.List<java.util.Map<String, Object>> cbzDirectory(java.io.RandomAccessFile file) throws Exception {
        long size = file.length();
        if (size < 22 || size > CBZ_MAX_ARCHIVE) throw cbzInvalid();
        int tailSize = (int) Math.min(size, 65557);
        byte[] tail = cbzRead(file, size - tailSize, tailSize);
        int end = -1;
        for (int at = tail.length - 22; at >= 0; at--) {
            if (cbzU32(tail, at) == 0x06054b50L && at + 22 + cbzU16(tail, at + 20) == tail.length) { end = at; break; }
        }
        if (end < 0 || cbzU16(tail, end + 4) != 0 || cbzU16(tail, end + 6) != 0) throw cbzInvalid();
        int count = cbzU16(tail, end + 10);
        long directorySize = cbzU32(tail, end + 12), directoryOffset = cbzU32(tail, end + 16);
        if (count < 1 || count > CBZ_MAX_ENTRIES || cbzU16(tail, end + 8) != count
            || directorySize > CBZ_MAX_DIRECTORY || directoryOffset + directorySize != size - tailSize + end) throw cbzInvalid();
        byte[] directory = cbzRead(file, directoryOffset, (int) directorySize);
        var entries = new java.util.ArrayList<java.util.Map<String, Object>>();
        var ranges = new java.util.ArrayList<long[]>();
        var names = new java.util.HashSet<String>();
        var files = new java.util.HashSet<String>();
        var parents = new java.util.HashSet<String>();
        int at = 0, pageCount = 0;
        long expanded = 0;
        for (int index = 0; index < count; index++) {
            if (at > directory.length - 46 || cbzU32(directory, at) != 0x02014b50L) throw cbzInvalid();
            int flags = cbzU16(directory, at + 8), method = cbzU16(directory, at + 10);
            int nameLength = cbzU16(directory, at + 28), extraLength = cbzU16(directory, at + 30), commentLength = cbzU16(directory, at + 32);
            int version = cbzU16(directory, at + 6);
            long crc = cbzU32(directory, at + 16), compressed = cbzU32(directory, at + 20), uncompressed = cbzU32(directory, at + 24);
            long external = cbzU32(directory, at + 38), localOffset = cbzU32(directory, at + 42);
            int mode = (int) ((external >>> 16) & 0170000);
            if (version < 10 || version > 20 || (flags & ~0x080e) != 0 || (method != 0 && method != 8)
                || (method == 0 && (flags & 6) != 0) || cbzU16(directory, at + 34) != 0
                || compressed > CBZ_MAX_ARCHIVE || uncompressed > CBZ_MAX_PAGE || commentLength > 1024
                || nameLength > 512 || extraLength > 4096 || at + 46L + nameLength + extraLength + commentLength > directory.length) throw cbzInvalid();
            byte[] rawName = java.util.Arrays.copyOfRange(directory, at + 46, at + 46 + nameLength);
            String name = cbzName(rawName, flags);
            boolean folder = name.endsWith("/");
            if ((mode != 0 && mode != (folder ? 0040000 : 0100000)) || (external & 0x400) != 0
                || (!folder && (external & 0x10) != 0)) throw cbzInvalid();
            String path = folder ? name.substring(0, name.length() - 1) : name;
            String folded = cbzFold(path);
            if (!names.add(folded) || (!folder && parents.contains(folded))) throw cbzInvalid();
            int slash = path.indexOf('/');
            while (slash >= 0) {
                String parent = cbzFold(path.substring(0, slash));
                if (files.contains(parent)) throw cbzInvalid();
                parents.add(parent);
                slash = path.indexOf('/', slash + 1);
            }
            if (!folder) files.add(folded);
            String kind;
            if (folder) {
                if (uncompressed != 0 || crc != 0) throw cbzInvalid();
                kind = "directory";
            } else if (name.equals("ComicInfo.xml")) {
                if (uncompressed > CBZ_MAX_METADATA) throw cbzInvalid();
                kind = "metadata";
            } else {
                String lower = name.toLowerCase(java.util.Locale.ROOT);
                if (lower.endsWith(".png")) kind = "png";
                else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) kind = "jpg";
                else throw cbzInvalid();
                if (uncompressed == 0 || ++pageCount > CBZ_MAX_PAGES) throw cbzInvalid();
            }
            expanded += uncompressed;
            if (expanded > CBZ_MAX_EXPANDED || localOffset + 30 > directoryOffset) throw cbzInvalid();
            cbzExtra(directory, at + 46 + nameLength, extraLength);
            byte[] local = cbzRead(file, localOffset, 30);
            int localNameLength = cbzU16(local, 26), localExtraLength = cbzU16(local, 28);
            if (cbzU32(local, 0) != 0x04034b50L || cbzU16(local, 4) != version || cbzU16(local, 6) != flags
                || cbzU16(local, 8) != method || localNameLength != nameLength || localExtraLength > 4096) throw cbzInvalid();
            byte[] localNames = cbzRead(file, localOffset + 30, localNameLength + localExtraLength);
            if (!java.util.Arrays.equals(rawName, java.util.Arrays.copyOf(localNames, localNameLength))) throw cbzInvalid();
            cbzExtra(localNames, localNameLength, localExtraLength);
            long dataOffset = localOffset + 30 + localNameLength + localExtraLength;
            long dataEnd = dataOffset + compressed;
            if (dataEnd > directoryOffset) throw cbzInvalid();
            if ((flags & 8) == 0) {
                if (cbzU32(local, 14) != crc || cbzU32(local, 18) != compressed || cbzU32(local, 22) != uncompressed) throw cbzInvalid();
            } else {
                for (int field : new int[] {14, 18, 22}) {
                    long expected = field == 14 ? crc : field == 18 ? compressed : uncompressed;
                    if (cbzU32(local, field) != 0 && cbzU32(local, field) != expected) throw cbzInvalid();
                }
                byte[] descriptor = cbzRead(file, dataEnd, 12);
                int prefix = cbzU32(descriptor, 0) == 0x08074b50L ? 4 : 0;
                if (prefix != 0) descriptor = cbzRead(file, dataEnd, 16);
                if (cbzU32(descriptor, prefix) != crc || cbzU32(descriptor, prefix + 4) != compressed
                    || cbzU32(descriptor, prefix + 8) != uncompressed) throw cbzInvalid();
                dataEnd += 12 + prefix;
                if (dataEnd > directoryOffset) throw cbzInvalid();
            }
            if (method == 0 && compressed != uncompressed) throw cbzInvalid();
            ranges.add(new long[] {localOffset, dataEnd});
            entries.add(java.util.Map.of("name", name, "kind", kind, "method", method,
                "offset", dataOffset, "compressed", compressed, "size", uncompressed, "crc", crc));
            at += 46 + nameLength + extraLength + commentLength;
        }
        if (at != directory.length || pageCount == 0) throw cbzInvalid();
        ranges.sort(java.util.Comparator.comparingLong(range -> range[0]));
        long position = 0;
        for (long[] range : ranges) {
            if (range[0] != position || range[1] < range[0]) throw cbzInvalid();
            position = range[1];
        }
        if (position != directoryOffset) throw cbzInvalid();
        return entries;
    }

    private static void cbzDeadline(long deadline) {
        if (System.nanoTime() > deadline) throw cbzInvalid();
    }

    private static String cbzHash(java.io.RandomAccessFile file, long size, long deadline) throws Exception {
        var digest = java.security.MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[65536];
        file.seek(0);
        long remaining = size;
        while (remaining > 0) {
            cbzDeadline(deadline);
            int count = file.read(buffer, 0, (int) Math.min(buffer.length, remaining));
            if (count < 1) throw cbzInvalid();
            digest.update(buffer, 0, count);
            remaining -= count;
        }
        if (file.length() != size) throw cbzInvalid();
        return java.util.HexFormat.of().formatHex(digest.digest());
    }

    private static String cbzExpand(java.io.RandomAccessFile file, java.util.Map<String, Object> entry,
        java.io.OutputStream output, long deadline) throws Exception {
        var crc = new java.util.zip.CRC32();
        var digest = java.security.MessageDigest.getInstance("SHA-256");
        byte[] input = new byte[65536], expanded = new byte[65536];
        long remaining = cbzNumber(entry, "compressed"), actual = 0, size = cbzNumber(entry, "size");
        file.seek(cbzNumber(entry, "offset"));
        var inflater = cbzNumber(entry, "method") == 8 ? new java.util.zip.Inflater(true) : null;
        try {
            while (inflater == null ? remaining > 0 : !inflater.finished()) {
                cbzDeadline(deadline);
                int count;
                if (inflater == null) {
                    count = file.read(expanded, 0, (int) Math.min(expanded.length, remaining));
                    if (count < 1) throw cbzInvalid();
                    remaining -= count;
                } else {
                    if (inflater.needsInput()) {
                        if (remaining == 0) throw cbzInvalid();
                        int read = file.read(input, 0, (int) Math.min(input.length, remaining));
                        if (read < 1) throw cbzInvalid();
                        remaining -= read;
                        inflater.setInput(input, 0, read);
                    }
                    count = inflater.inflate(expanded);
                    if (count == 0 && !inflater.finished() && !inflater.needsInput()) throw cbzInvalid();
                }
                actual += count;
                if (actual > size || actual > CBZ_MAX_PAGE) throw cbzInvalid();
                crc.update(expanded, 0, count);
                digest.update(expanded, 0, count);
                output.write(expanded, 0, count);
            }
            if (remaining != 0 || (inflater != null && inflater.getRemaining() != 0)
                || actual != size || crc.getValue() != cbzNumber(entry, "crc")) throw cbzInvalid();
        } finally {
            if (inflater != null) inflater.end();
        }
        return java.util.HexFormat.of().formatHex(digest.digest());
    }

    static int cbzNaturalCompare(String left, String right) {
        String a = cbzFold(left), b = cbzFold(right);
        int x = 0, y = 0;
        while (x < a.length() && y < b.length()) {
            char ac = a.charAt(x), bc = b.charAt(y);
            if (ac >= '0' && ac <= '9' && bc >= '0' && bc <= '9') {
                int ax = x, by = y;
                while (x < a.length() && a.charAt(x) >= '0' && a.charAt(x) <= '9') x++;
                while (y < b.length() && b.charAt(y) >= '0' && b.charAt(y) <= '9') y++;
                int az = ax, bz = by;
                while (az < x - 1 && a.charAt(az) == '0') az++;
                while (bz < y - 1 && b.charAt(bz) == '0') bz++;
                int length = Integer.compare(x - az, y - bz);
                if (length != 0) return length;
                int number = a.substring(az, x).compareTo(b.substring(bz, y));
                if (number != 0) return number;
                int zeros = Integer.compare(az - ax, bz - by);
                if (zeros != 0) return zeros;
            } else {
                if (ac != bc) return Character.compare(ac, bc);
                x++; y++;
            }
        }
        int length = Integer.compare(a.length() - x, b.length() - y);
        return length != 0 ? length : left.compareTo(right);
    }

    private static int[] cbzDecode(java.nio.file.Path page, String kind) throws Exception {
        javax.imageio.ImageIO.setUseCache(false);
        try (var input = new javax.imageio.stream.FileImageInputStream(page.toFile())) {
            var readers = javax.imageio.ImageIO.getImageReaders(input);
            if (!readers.hasNext()) throw cbzInvalid();
            var reader = readers.next();
            try {
                String format = reader.getFormatName();
                if (!(kind.equals("png") ? format.equalsIgnoreCase("png") : format.equalsIgnoreCase("jpeg"))) throw cbzInvalid();
                boolean[] warning = {false};
                reader.addIIOReadWarningListener((source, message) -> warning[0] = true);
                reader.setInput(input, true, true);
                int width = reader.getWidth(0), height = reader.getHeight(0);
                if (width < 1 || height < 1 || width > CBZ_MAX_DIMENSION || height > CBZ_MAX_DIMENSION
                    || (long) width * height > CBZ_MAX_PIXELS) throw cbzInvalid();
                var image = reader.read(0);
                if (image == null) throw cbzInvalid();
                try {
                    if (warning[0] || image.getWidth() != width || image.getHeight() != height) throw cbzInvalid();
                } finally { image.flush(); }
                return new int[] {width, height};
            } finally { reader.dispose(); }
        }
    }

    static String importCbz(java.nio.file.Path source, java.nio.file.Path output) throws Exception {
        long deadline = System.nanoTime() + 110_000_000_000L;
        var sourceAttributes = java.nio.file.Files.readAttributes(source, java.nio.file.attribute.BasicFileAttributes.class,
            java.nio.file.LinkOption.NOFOLLOW_LINKS);
        var outputAttributes = java.nio.file.Files.readAttributes(output, java.nio.file.attribute.BasicFileAttributes.class,
            java.nio.file.LinkOption.NOFOLLOW_LINKS);
        if (!sourceAttributes.isRegularFile() || sourceAttributes.isSymbolicLink() || sourceAttributes.isOther()
            || sourceAttributes.size() > CBZ_MAX_ARCHIVE || !outputAttributes.isDirectory()
            || outputAttributes.isSymbolicLink() || outputAttributes.isOther()) throw cbzInvalid();
        try (var files = java.nio.file.Files.newDirectoryStream(output)) {
            if (files.iterator().hasNext()) throw cbzInvalid();
        }
        var created = new java.util.ArrayList<java.nio.file.Path>();
        try (var file = new java.io.RandomAccessFile(source.toFile(), "r")) {
            if (file.length() != sourceAttributes.size()) throw cbzInvalid();
            var entries = cbzDirectory(file);
            String archiveHash = cbzHash(file, sourceAttributes.size(), deadline);
            long expanded = 0;
            var pages = new java.util.ArrayList<java.util.Map<String, Object>>();
            for (var entry : entries) {
                expanded += cbzNumber(entry, "size");
                String kind = (String) entry.get("kind");
                if (kind.equals("png") || kind.equals("jpg")) pages.add(entry);
                else cbzExpand(file, entry, java.io.OutputStream.nullOutputStream(), deadline);
            }
            pages.sort((a, b) -> cbzNaturalCompare((String) a.get("name"), (String) b.get("name")));
            StringBuilder result = new StringBuilder("{\"version\":1,\"archiveSha256\":").append(quoted(archiveHash))
                .append(",\"archiveBytes\":").append(sourceAttributes.size()).append(",\"expandedBytes\":").append(expanded)
                .append(",\"pageCount\":").append(pages.size()).append(",\"pages\":[");
            for (int index = 0; index < pages.size(); index++) {
                cbzDeadline(deadline);
                var entry = pages.get(index);
                String kind = (String) entry.get("kind");
                String name = String.format(java.util.Locale.ROOT, "%04d.%s", index + 1, kind);
                var destination = output.resolve(name);
                String sha;
                try (var stream = java.nio.file.Files.newOutputStream(destination, java.nio.file.StandardOpenOption.CREATE_NEW,
                    java.nio.file.StandardOpenOption.WRITE)) {
                    created.add(destination);
                    sha = cbzExpand(file, entry, stream, deadline);
                }
                int[] dimensions = cbzDecode(destination, kind);
                if (index != 0) result.append(',');
                result.append("{\"name\":").append(quoted(name)).append(",\"bytes\":").append(cbzNumber(entry, "size"))
                    .append(",\"sha256\":").append(quoted(sha)).append(",\"width\":").append(dimensions[0])
                    .append(",\"height\":").append(dimensions[1]).append('}');
            }
            result.append("]}");
            if (result.length() > 512 * 1024 || !archiveHash.equals(cbzHash(file, sourceAttributes.size(), deadline))) throw cbzInvalid();
            var current = java.nio.file.Files.readAttributes(source, java.nio.file.attribute.BasicFileAttributes.class,
                java.nio.file.LinkOption.NOFOLLOW_LINKS);
            if (current.isSymbolicLink() || current.isOther() || !current.isRegularFile() || current.size() != sourceAttributes.size()
                || !java.util.Objects.equals(current.fileKey(), sourceAttributes.fileKey())) throw cbzInvalid();
            return result.toString();
        } catch (Exception rejected) {
            for (var path : created) {
                try { java.nio.file.Files.deleteIfExists(path); } catch (Exception ignored) { /* native staging cleanup owns any remainder */ }
            }
            throw cbzInvalid();
        }
    }
}
