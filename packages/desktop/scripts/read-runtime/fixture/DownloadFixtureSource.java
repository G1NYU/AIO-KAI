package org.tsugi.fixture;

import eu.kanade.tachiyomi.source.model.Page;
import eu.kanade.tachiyomi.source.model.SChapter;
import eu.kanade.tachiyomi.source.model.SManga;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import rx.Observable;

/** Original CI-only pages served by this JVM on an ephemeral loopback port. */
public class DownloadFixtureSource extends FixtureSource {
    private static final byte[] PNG = Base64.getDecoder().decode(
        "iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAIAAAB8wupbAAAAHUlEQVR4nGOsqF3FQApgIkn1qIZRDaMaRjWQrAEA4jkBz8UryC4AAAAASUVORK5CYII="
    );
    private static final AtomicInteger IMAGE_REQUESTS = new AtomicInteger();
    private static final Object IMAGE_GATE = new Object();
    private static volatile boolean paused;
    private static final int PORT = startPages();

    @Override public String getName() { return "Tsugi Download Fixture"; }
    @Override public String getBaseUrl() { return "http://127.0.0.1:" + PORT; }

    private SChapter chapter(int number) {
        SChapter chapter = SChapter.Companion.create();
        chapter.setUrl("/original-comic/chapter-" + number);
        chapter.setName("Cleanup chapter 0" + number);
        chapter.setChapter_number((float) number);
        return chapter;
    }

    @Override public Observable<List<SChapter>> fetchChapterList(SManga manga) {
        return Observable.just(List.of(chapter(1), chapter(2), chapter(3)));
    }

    @Override public Observable<List<Page>> fetchPageList(SChapter chapter) {
        if (!chapter.getUrl().matches("/original-comic/chapter-[123]")) {
            return Observable.error(new IOException("Unknown original fixture chapter"));
        }
        String prefix = getBaseUrl() + chapter.getUrl();
        return Observable.just(List.of(
            new Page(0, "", prefix + "/page-1.png", null),
            new Page(1, "", prefix + "/page-2.png", null)
        ));
    }

    private static int startPages() {
        try {
            ServerSocket listener = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
            Thread server = new Thread(() -> {
                while (!listener.isClosed()) {
                    try {
                        Socket socket = listener.accept();
                        Thread request = new Thread(() -> serve(socket), "tsugi-fixture-page");
                        request.setDaemon(true);
                        request.start();
                    } catch (IOException stopped) {
                        return;
                    }
                }
            }, "tsugi-fixture-pages");
            server.setDaemon(true);
            server.start();
            return listener.getLocalPort();
        } catch (IOException failure) {
            throw new ExceptionInInitializerError(failure);
        }
    }

    private static void serve(Socket socket) {
        try (socket) {
            socket.setSoTimeout(3000);
            ByteArrayOutputStream header = new ByteArrayOutputStream();
            int ending = 0;
            while (header.size() < 4096 && ending != 0x0d0a0d0a) {
                int next = socket.getInputStream().read();
                if (next < 0) return;
                header.write(next);
                ending = (ending << 8) | next;
            }
            if (ending != 0x0d0a0d0a) return;
            String[] request = header.toString(StandardCharsets.US_ASCII).split("\\r\\n", 2)[0].split(" ");
            if (request.length != 3 || !request[2].startsWith("HTTP/1.")) return;
            String method = request[0];
            String path = request[1];
            if (method.equals("POST") && (path.equals("/fixture/pause") || path.equals("/fixture/resume"))) {
                synchronized (IMAGE_GATE) {
                    paused = path.endsWith("pause");
                    IMAGE_GATE.notifyAll();
                }
                respond(socket, 200, "text/plain", new byte[0]);
            } else if (method.equals("GET") && path.equals("/fixture/requests")) {
                respond(socket, 200, "text/plain", Integer.toString(IMAGE_REQUESTS.get()).getBytes(StandardCharsets.US_ASCII));
            } else if (method.equals("GET") && path.matches("/original-comic/chapter-[123]/page-[12]\\.png")) {
                IMAGE_REQUESTS.incrementAndGet();
                long deadline = System.nanoTime() + 20_000_000_000L;
                synchronized (IMAGE_GATE) {
                    while (paused && System.nanoTime() < deadline) IMAGE_GATE.wait(100);
                    if (paused) return;
                }
                // Keep the queue observable while enqueueChapterDownloads
                // installs its upstream update-flow subscription.
                Thread.sleep(150);
                respond(socket, 200, "image/png", PNG);
            } else {
                respond(socket, 404, "text/plain", new byte[0]);
            }
        } catch (IOException | InterruptedException closed) {
            // This fixture serves no user data; JVM shutdown closes all pages.
        }
    }

    private static void respond(Socket socket, int status, String type, byte[] bytes) throws IOException {
        String header = "HTTP/1.1 " + status + (status == 200 ? " OK" : " Not Found") + "\r\n"
            + "Content-Type: " + type + "\r\nContent-Length: " + bytes.length
            + "\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n";
        socket.getOutputStream().write(header.getBytes(StandardCharsets.US_ASCII));
        socket.getOutputStream().write(bytes);
        socket.getOutputStream().flush();
    }
}
