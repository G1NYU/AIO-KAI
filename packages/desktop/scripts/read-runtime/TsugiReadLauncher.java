/**
 * Tsugi-owned bootstrap for the pinned, unmodified Suwayomi server.
 * The native parent owns stdin exclusively. No commands or external input
 * are accepted: EOF requests normal JVM shutdown, including shutdown hooks.
 */
public final class TsugiReadLauncher {
    private TsugiReadLauncher() {}

    public static void main(String[] args) throws Exception {
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
}
