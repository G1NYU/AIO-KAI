// Original sanitized test data; invokes Mihon v0.21.3's unmodified BackupWriter.
import eu.kanade.tachiyomi.data.backup.BackupReader
import eu.kanade.tachiyomi.data.backup.BackupWriter
import eu.kanade.tachiyomi.data.backup.models.*
import kotlinx.serialization.protobuf.ProtoBuf
import okio.Buffer
import java.io.File

fun main(args: Array<String>) {
    val manga = listOf(
        BackupManga(
            source = 9007199254740993L, url = "/writer-fixture/one", title = "Writer fixture — 継ぎ",
            chapters = listOf(
                BackupChapter(url = "/writer-fixture/one/read", name = "Read", read = true, lastPageRead = 19, chapterNumber = 1f),
                BackupChapter(url = "/writer-fixture/one/bookmark", name = "Bookmark", bookmark = true, chapterNumber = 2f),
                BackupChapter(url = "/writer-fixture/one/partial", name = "Partial", lastPageRead = 7, chapterNumber = 3f),
            ),
            categories = listOf(2L, 8L),
            history = listOf(
                BackupHistory(url = "/writer-fixture/one/read", lastRead = 1700000000123L, readDuration = 60000),
                BackupHistory(url = "/writer-fixture/one/partial", lastRead = 1700000001123L, readDuration = 20000),
            ),
            tracking = listOf(
                BackupTracking(syncId = 1, libraryId = 0, mediaIdInt = 42),
                BackupTracking(syncId = 2, libraryId = 0, mediaId = 100001L),
            ),
        ),
        BackupManga(source = -9007199254740993L, url = "/writer-fixture/missing", title = "Missing source fixture"),
        BackupManga(source = 9007199254740993L, url = "/writer-fixture/not-followed", title = "Not followed", favorite = false),
    )
    val backup = Backup(
        backupManga = manga,
        backupCategories = listOf(BackupCategory("Reading", 2, 99), BackupCategory("Later", 8, 101), BackupCategory("Empty shelf", 9, 102)),
        backupSources = listOf(BackupSource("Writer source", 9007199254740993L), BackupSource("Missing source", -9007199254740993L)),
        backupPreferences = listOf(BackupPreference("fixture-private-setting", StringPreferenceValue("must-not-survive-app-settings"))),
        backupSourcePreferences = listOf(BackupSourcePreferences("source_9007199254740993", listOf(BackupPreference("fixture-private-setting", StringPreferenceValue("must-not-survive-source-settings"))))),
        backupExtensionStores = listOf(BackupExtensionStore("https://example.invalid/extensions", "Fixture store", null, "fixture-key", "https://example.invalid", null, false, null)),
    )
    val sink = Buffer()
    val writer = BackupWriter(sink, ProtoBuf)
    manga.forEach(writer::writeEntry)
    writer.writeMetadata(backup.copy(backupManga = emptyList()))
    check(!writer.isEmpty)
    val bytes = sink.readByteArray()
    check(bytes.contentEquals(ProtoBuf.encodeToByteArray(Backup.serializer(), backup)))
    val reader = BackupReader(Buffer().write(bytes), ProtoBuf)
    val restored = buildList { while (reader.nextEntry()) add(reader.readEntry()) }
    check(restored.map { it.source } == manga.map { it.source })
    check(restored.first().chapters[2].lastPageRead == 7L)
    check(reader.readMetadata().backupCategories.map { it.order } == listOf(2L, 8L, 9L))
    File(args.single()).writeBytes(bytes)
}
