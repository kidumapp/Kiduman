package com.yosefwo.jewishwatch;

import com.kosherjava.zmanim.hebrewcalendar.JewishCalendar;
import java.io.DataOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.zip.GZIPOutputStream;

/** Compile alongside Android's SiddurDay.java and zmanim 2.5.0. */
public final class ExportSiddurCalendar {
    private static final String[] CONDITIONS = {
        "rosh", "chol", "pesach", "sukkot", "chanukah", "hallel", "fullHallel", "fast",
        "tishaBav", "mentionRain", "askRain", "repentance", "tachanun", "regularTorah", "yaanecha", "psalm27"
    };

    public static void main(String[] args) throws Exception {
        LocalDate first = LocalDate.of(2000, 1, 1);
        LocalDate end = LocalDate.of(2151, 1, 1);
        try (DataOutputStream out = new DataOutputStream(new GZIPOutputStream(Files.newOutputStream(Path.of(args[0]))))) {
            out.writeInt((int) first.toEpochDay());
            out.writeInt((int) end.toEpochDay());
            for (LocalDate civil = first; civil.isBefore(end); civil = civil.plusDays(1)) {
                JewishCalendar date = new JewishCalendar();
                date.setGregorianDate(civil.getYear(), civil.getMonthValue() - 1, civil.getDayOfMonth());
                for (boolean israel : new boolean[] {true, false}) {
                    date.setInIsrael(israel);
                    SiddurDay day = new SiddurDay(date, "shacharit", 0);
                    int flags = day.closed() ? 1 << 16 : 0;
                    for (int bit = 0; bit < CONDITIONS.length; bit++) {
                        if (day.includes(CONDITIONS[bit])) flags |= 1 << bit;
                    }
                    if (new SiddurDay(date, "mincha", 0).includes("tachanun")) flags |= 1 << 17;
                    if (new SiddurDay(date, "shacharit", 14).includes("purim")) flags |= 1 << 18;
                    if (new SiddurDay(date, "shacharit", 15).includes("purim")) flags |= 1 << 19;
                    flags |= Math.max(0, date.getDayOfOmer()) << 20;
                    flags |= Math.max(0, date.getDayOfChanukah()) << 26;
                    out.writeInt(flags);
                }
            }
        }
    }
}
