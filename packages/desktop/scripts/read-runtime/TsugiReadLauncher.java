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
}
