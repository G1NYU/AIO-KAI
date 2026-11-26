import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.RandomAccessFile;
import java.net.ServerSocket;
import java.net.SocketTimeoutException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import javax.imageio.ImageIO;

/** Original images only. Run separately from the packaged launcher classpath. */
public final class TsugiCbzImportTest {
    private record Item(String name, byte[] bytes) {}
    private static int passed;

    private static void check(boolean condition, String what) {
        if (!condition) throw new AssertionError(what);
    }

    private static byte[] page(String format, int width, int height, int color) throws Exception {
        var image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        for (int y = 0; y < height; y++) for (int x = 0; x < width; x++) image.setRGB(x, y, color ^ ((x + y) % 3 == 0 ? 0x070707 : 0));
        var output = new ByteArrayOutputStream();
        try { check(ImageIO.write(image, format, output), "standard image writer"); }
        finally { image.flush(); }
        return output.toByteArray();
    }

    private static byte[] archive(List<Item> items, boolean deflated) throws Exception {
        var output = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(output, StandardCharsets.UTF_8)) {
            for (var item : items) {
                var entry = new ZipEntry(item.name());
                entry.setTime(1_700_000_000_000L);
                if (!deflated) {
                    var crc = new CRC32(); crc.update(item.bytes());
                    entry.setMethod(ZipEntry.STORED);
                    entry.setSize(item.bytes().length);
                    entry.setCompressedSize(item.bytes().length);
                    entry.setCrc(crc.getValue());
                }
                zip.putNextEntry(entry);
                zip.write(item.bytes());
                zip.closeEntry();
            }
        }
        return output.toByteArray();
    }

    private static long u32(byte[] bytes, int at) { return Integer.toUnsignedLong(ByteBuffer.wrap(bytes, at, 4).order(ByteOrder.LITTLE_ENDIAN).getInt()); }
    private static int u16(byte[] bytes, int at) { return Short.toUnsignedInt(ByteBuffer.wrap(bytes, at, 2).order(ByteOrder.LITTLE_ENDIAN).getShort()); }
    private static void put32(byte[] bytes, int at, long value) { ByteBuffer.wrap(bytes, at, 4).order(ByteOrder.LITTLE_ENDIAN).putInt((int) value); }
    private static void put16(byte[] bytes, int at, int value) { ByteBuffer.wrap(bytes, at, 2).order(ByteOrder.LITTLE_ENDIAN).putShort((short) value); }

    private static List<Integer> central(byte[] bytes) {
        int end = bytes.length - 22;
        check(u32(bytes, end) == 0x06054b50L, "authored fixture EOCD");
        int at = (int) u32(bytes, end + 16);
        var positions = new ArrayList<Integer>();
        for (int index = 0; index < u16(bytes, end + 10); index++) {
            check(u32(bytes, at) == 0x02014b50L, "authored fixture central header");
            positions.add(at);
            at += 46 + u16(bytes, at + 28) + u16(bytes, at + 30) + u16(bytes, at + 32);
        }
        return positions;
    }

    private static int local(byte[] bytes, int central) { return (int) u32(bytes, central + 42); }

    private static void declaredSize(byte[] bytes, int central, long size) {
        int local = local(bytes, central);
        put32(bytes, central + 24, size);
        if ((u16(bytes, local + 6) & 8) == 0) put32(bytes, local + 22, size);
        else {
            int descriptor = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28) + (int) u32(bytes, central + 20);
            check(u32(bytes, descriptor) == 0x08074b50L, "ordinary deflated descriptor");
            put32(bytes, descriptor + 12, size);
        }
    }

    private static Path source(Path root, byte[] bytes) throws Exception {
        Path source = root.resolve("input.cbz");
        Files.write(source, bytes);
        return source;
    }

    private static void rejected(Path root, byte[] bytes, String what) throws Exception {
        Path input = source(root, bytes), output = root.resolve("pages");
        Files.createDirectory(output);
        boolean refused = false;
        try { TsugiReadLauncher.importCbz(input, output); }
        catch (IllegalArgumentException expected) { refused = true; }
        check(refused, what + " must be rejected");
        try (var files = Files.list(output)) { check(files.count() == 0, what + " must not leave generated pages"); }
        check(Arrays.equals(Files.readAllBytes(input), bytes), what + " changed selected archive");
        Files.delete(output);
        passed++;
    }

    private static void accepted(Path root, byte[] bytes, List<byte[]> expected, String label) throws Exception {
        Path input = source(root, bytes), output = root.resolve("pages");
        Files.createDirectory(output);
        String result = TsugiReadLauncher.importCbz(input, output);
        String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        check(result.contains("\"archiveSha256\":\"" + hash + "\"") && result.contains("\"pageCount\":" + expected.size()), label + " manifest identity/count");
        check(!result.contains("ComicInfo") && !result.contains("private-entry"), "result exposes only generated page names");
        try (var files = Files.list(output)) {
            var pages = files.sorted().toList();
            check(pages.size() == expected.size(), label + " exact generated page inventory");
            for (int index = 0; index < pages.size(); index++) {
                check(Arrays.equals(Files.readAllBytes(pages.get(index)), expected.get(index)), label + " natural page ordering/bytes");
                check(pages.get(index).getFileName().toString().matches(String.format("%04d\\.(png|jpg)", index + 1)), label + " generated filename");
            }
        }
        check(Arrays.equals(Files.readAllBytes(input), bytes), label + " source archive unchanged");
        clean(output);
        passed++;
    }

    private static byte[] dimensions(byte[] png, int width, int height) {
        byte[] changed = png.clone();
        ByteBuffer.wrap(changed, 16, 8).putInt(width).putInt(height);
        var crc = new CRC32(); crc.update(changed, 12, 17);
        ByteBuffer.wrap(changed, 29, 4).putInt((int) crc.getValue());
        return changed;
    }

    private static void clean(Path root) throws Exception {
        if (!Files.exists(root)) return;
        try (var files = Files.walk(root)) {
            for (var file : files.sorted(Comparator.reverseOrder()).toList()) Files.delete(file);
        }
    }

    private static void fixture(Path root, String name, byte[] bytes) throws Exception {
        Files.write(root.resolve(name), bytes, StandardOpenOption.CREATE_NEW);
    }

    public static void main(String[] args) throws Exception {
        check(args.length <= 1, "optional fixture output directory only");
        Path root = Files.createTempDirectory("tsugi-cbz-helper-");
        try {
            byte[] one = page("png", 16, 24, 0x126098), two = page("jpeg", 13, 17, 0x20a060), ten = page("png", 11, 19, 0x9060b0);
            var items = List.of(new Item("private-entry10.png", ten), new Item("private-entry2.jpeg", two), new Item("private-entry1.png", one));
            byte[] stored = archive(items, false), deflated = archive(items, true);
            accepted(root, stored, List.of(one, two, ten), "stored archive");
            accepted(root, deflated, List.of(one, two, ten), "deflated descriptor archive");
            check((u16(deflated, 6) & 8) != 0, "deflated fixture exercises data descriptors");
            accepted(root, archive(List.of(new Item("pages/", new byte[0]), new Item("pages/2.png", ten), new Item("pages/1.png", one)), true), List.of(one, ten), "safe nested names/directories");

            try (var trap = new ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))) {
                trap.setSoTimeout(150);
                String metadata = "<!DOCTYPE ComicInfo SYSTEM \"http://127.0.0.1:" + trap.getLocalPort() + "/never\"><ComicInfo/>";
                accepted(root, archive(List.of(new Item("ComicInfo.xml", metadata.getBytes(StandardCharsets.UTF_8)), new Item("1.png", one)), true), List.of(one), "ignored metadata");
                boolean connected = false;
                try (var socket = trap.accept()) { connected = true; } catch (SocketTimeoutException expected) { /* no metadata network requests */ }
                check(!connected, "ignored XML must never resolve external resources");
            }
            for (String name : List.of("../1.png", "/1.png", "C:/1.png", "\\\\host\\1.png", "a\\1.png", "a//1.png", "a/../1.png", "CON.png", "CON .png", "a /1.png", "1.png ")) {
                rejected(root, archive(List.of(new Item(name, one)), false), "unsafe entry path");
            }
            rejected(root, archive(List.of(new Item("A.png", one), new Item("a.png", one)), false), "case collision");
            rejected(root, archive(List.of(new Item("e\u0301.png", one), new Item("\u00e9.png", one)), false), "Unicode normalization collision");
            rejected(root, archive(List.of(new Item("parent.png", one), new Item("parent.png/1.png", one)), false), "file/parent collision");
            rejected(root, archive(List.of(new Item("readme.txt", one), new Item("1.png", one)), false), "nonimage content");
            rejected(root, archive(List.of(new Item("ComicInfo.xml", new byte[0])), false), "metadata without pages");
            rejected(root, archive(List.of(new Item("1.png", one), new Item("2.png", "<html>not an image</html>".getBytes(StandardCharsets.UTF_8))), true), "disguised image and partial extraction cleanup");
            rejected(root, archive(List.of(new Item("1.png", two)), false), "mismatched image extension");
            rejected(root, archive(List.of(new Item("1.jpg", Arrays.copyOf(two, two.length - 2))), false), "truncated JPEG");
            rejected(root, archive(List.of(new Item("1.png", dimensions(one, 8000, 5000))), false), "decoded pixel bound");
            rejected(root, archive(List.of(new Item("1.png", dimensions(one, 100001, 1))), false), "dimension bound");
            rejected(root, archive(List.of(new Item("ComicInfo.xml", new byte[65537]), new Item("1.png", one)), true), "metadata bound");
            rejected(root, Arrays.copyOf(stored, stored.length - 8), "truncated ZIP");

            byte[] bad = stored.clone(); int first = central(bad).get(0), firstLocal = local(bad, first);
            put32(bad, first + 16, u32(bad, first + 16) ^ 1); put32(bad, firstLocal + 14, u32(bad, firstLocal + 14) ^ 1);
            rejected(root, bad, "actual decompressed CRC");
            bad = stored.clone(); first = central(bad).get(0); bad[local(bad, first) + 30] ^= 1;
            rejected(root, bad, "local/central filename mismatch");
            bad = stored.clone(); first = central(bad).get(0); put16(bad, first + 8, u16(bad, first + 8) | 1); put16(bad, local(bad, first) + 6, u16(bad, local(bad, first) + 6) | 1);
            rejected(root, bad, "encrypted flag");
            bad = stored.clone(); first = central(bad).get(0); put32(bad, first + 38, 0120777L << 16);
            rejected(root, bad, "symlink entry");
            bad = stored.clone(); first = central(bad).get(0); put32(bad, first + 38, 0x400);
            rejected(root, bad, "Windows reparse entry");
            bad = archive(List.of(new Item("a.png", one), new Item("b.png", ten)), false); int second = central(bad).get(1);
            bad[second + 46] = 'a'; bad[local(bad, second) + 30] = 'a';
            rejected(root, bad, "duplicate exact entry name");
            bad = deflated.clone(); first = central(bad).get(0); declaredSize(bad, first, TsugiReadLauncher.CBZ_MAX_PAGE + 1);
            rejected(root, bad, "declared image size bound");
            bad = deflated.clone(); first = central(bad).get(0); declaredSize(bad, first, 1);
            rejected(root, bad, "actual expansion exceeds declared size");
            bad = deflated.clone(); first = central(bad).get(0); int descriptor = local(bad, first) + 30 + u16(bad, local(bad, first) + 26) + u16(bad, local(bad, first) + 28) + (int) u32(bad, first + 20); bad[descriptor + 4] ^= 1;
            rejected(root, bad, "descriptor mismatch");
            var expansion = new ArrayList<Item>();
            for (int index = 0; index < 22; index++) expansion.add(new Item(index + ".png", one));
            bad = archive(expansion, true);
            for (int position : central(bad)) declaredSize(bad, position, TsugiReadLauncher.CBZ_MAX_PAGE);
            rejected(root, bad, "total declared expansion bound before decode");
            var tooMany = new ArrayList<Item>();
            for (int index = 0; index < 2001; index++) tooMany.add(new Item(index + ".png", one));
            rejected(root, archive(tooMany, true), "page count bound");
            tooMany.clear();
            for (int index = 0; index < 4001; index++) tooMany.add(new Item(index + "/", new byte[0]));
            rejected(root, archive(tooMany, false), "entry count bound");
            Path oversized = root.resolve("oversized.cbz"), output = root.resolve("pages");
            try (var file = new RandomAccessFile(oversized.toFile(), "rw")) { file.setLength(TsugiReadLauncher.CBZ_MAX_ARCHIVE + 1); }
            Files.createDirectory(output);
            boolean refused = false;
            try { TsugiReadLauncher.importCbz(oversized, output); } catch (IllegalArgumentException expected) { refused = true; }
            check(refused, "input bound"); Files.delete(oversized); Files.delete(output); passed++;
            Files.createDirectory(output); Files.write(output.resolve("keep.bin"), one);
            refused = false;
            try { TsugiReadLauncher.importCbz(source(root, stored), output); } catch (IllegalArgumentException expected) { refused = true; }
            check(refused && Arrays.equals(Files.readAllBytes(output.resolve("keep.bin")), one), "nonempty output is preserved"); clean(output); passed++;

            // Exercise the production startup gate and argument/result protocol.
            Files.createDirectory(output);
            String java = Path.of(System.getProperty("java.home"), "bin", System.getProperty("os.name").startsWith("Windows") ? "java.exe" : "java").toString();
            var process = new ProcessBuilder(java, "-Xmx384m", "-cp", System.getProperty("java.class.path"), "TsugiReadLauncher", "--import-cbz", source(root, stored).toString(), output.toString()).start();
            process.getOutputStream().write(1); process.getOutputStream().close();
            check(process.waitFor(30, TimeUnit.SECONDS), "helper protocol deadline");
            check(process.exitValue() == 0 && new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8).contains("\"pageCount\":3"), "production helper protocol");
            clean(output); passed++;

            if (args.length == 1) {
                Path fixtures = Path.of(args[0]); Files.createDirectories(fixtures);
                fixture(fixtures, "tsugi-local-import-stored.cbz", stored);
                fixture(fixtures, "tsugi-local-import-deflated.cbz", deflated);
                fixture(fixtures, "tsugi-local-import-traversal.cbz", archive(List.of(new Item("../outside.png", one)), false));
                fixture(fixtures, "tsugi-local-import-page-1.png", one);
                fixture(fixtures, "tsugi-local-import-page-2.jpg", two);
                fixture(fixtures, "tsugi-local-import-page-10.png", ten);
            }
            System.out.println("PASS: " + passed + " bounded CBZ cases; stored/deflated bytes, natural order, CRC/structure, image limits, hostile paths, cleanup, no XML network and production helper protocol.");
        } finally { clean(root); }
    }
}
