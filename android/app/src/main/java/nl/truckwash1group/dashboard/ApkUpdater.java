package nl.truckwash1group.dashboard;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * De app op een tablet bijwerken.
 *
 * Op Windows doet electron-updater dit: kijken of er een nieuwere versie is,
 * op de achtergrond downloaden, installeren bij het afsluiten. Op Android
 * bestaat dat niet buiten de Play Store om, en de Play Store is voor een app
 * die alleen binnen dit bedrijf draait een omweg met een wachttijd van dagen.
 *
 * Dit bestand is gelijk aan dat van de kassa, op de pakketnaam na.
 *
 * Dus doen we het zelf: de app haalt de APK van GitHub Releases -- dezelfde
 * release waar de Windows-installer aan hangt -- en geeft hem aan Android om
 * te installeren. De gebruiker tikt daarbij één keer op "Installeren"; dat
 * kan niet anders, en dat hoort ook zo. Software die zichzelf zonder een
 * vraag kan vervangen is precies wat het recht hieronder gevaarlijk maakt.
 *
 * Wat hier in Java staat en niet in JavaScript, en waarom:
 *
 *   * downloaden -- een webview kan geen bestand op een plek zetten waar de
 *     installer erbij kan;
 *   * installeren -- dat is een Intent, en die bestaan alleen aan deze kant;
 *   * vragen om toestemming -- idem.
 *
 * Het recht REQUEST_INSTALL_PACKAGES in het manifest is wat dit mogelijk
 * maakt. Google beperkt dat recht in de Play Store, en terecht. Voor een app
 * die je zelf op je eigen tablets zet is het de bedoelde weg.
 */
@CapacitorPlugin(name = "ApkUpdater")
public class ApkUpdater extends Plugin {

    /** Waar de gedownloade APK belandt. Zie res/xml/file_paths.xml. */
    private File updateMap() {
        File map = new File(getContext().getExternalFilesDir(null), "updates");
        if (!map.exists()) {
            map.mkdirs();
        }
        return map;
    }

    /**
     * Mag deze app een installatie starten?
     *
     * Vanaf Android 8 is dat een aparte instelling per app, en die staat
     * standaard uit. Zonder dit uit te vragen zou de download slagen en het
     * installeren stil mislukken -- dan zoekt iemand in de verkeerde hoek.
     */
    @PluginMethod
    public void mogelijk(PluginCall call) {
        JSObject uit = new JSObject();
        boolean mag = true;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            PackageManager pm = getContext().getPackageManager();
            mag = pm.canRequestPackageInstalls();
        }

        uit.put("mag", mag);
        uit.put("versie", Build.VERSION.SDK_INT);
        call.resolve(uit);
    }

    /**
     * De systeeminstelling openen waar de gebruiker het toestaat.
     *
     * We sturen hem rechtstreeks naar de juiste pagina van déze app, niet
     * naar de instellingen in het algemeen. Anders is het zoeken.
     */
    @PluginMethod
    public void toestemmingVragen(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve();
            return;
        }

        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("De instelling kon niet geopend worden: " + e.getMessage());
        }
    }

    /**
     * De APK ophalen.
     *
     * Loopt op een achtergrondthread: een download van vier megabyte over een
     * matige verbinding duurt seconden, en zolang mag het scherm niet
     * bevriezen -- er kan iemand midden in een handeling zitten.
     *
     * De verwachte grootte komt mee vanuit de app. Klopt die niet met wat er
     * binnenkwam, dan is het bestand afgebroken en gooien we het weg. Een
     * halve APK installeert namelijk niet, en de melding die Android dan geeft
     * ("App niet geïnstalleerd") vertelt niet waarom.
     */
    @PluginMethod
    public void download(final PluginCall call) {
        final String url = call.getString("url");
        final String versie = call.getString("versie", "nieuw");
        final int verwachteGrootte = call.getInt("grootte", 0);

        if (url == null || url.isEmpty()) {
            call.reject("Geen adres om te downloaden.");
            return;
        }

        getBridge().execute(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection verbinding = null;
                File doel = new File(updateMap(), "dashboard-" + versie + ".apk");

                try {
                    URL adres = new URL(url);
                    verbinding = (HttpURLConnection) adres.openConnection();
                    verbinding.setInstanceFollowRedirects(true);
                    verbinding.setConnectTimeout(20000);
                    verbinding.setReadTimeout(60000);
                    verbinding.connect();

                    int code = verbinding.getResponseCode();
                    if (code < 200 || code >= 300) {
                        call.reject("De server antwoordde met " + code + ".");
                        return;
                    }

                    long totaal = verbinding.getContentLengthLong();
                    if (totaal <= 0 && verwachteGrootte > 0) {
                        totaal = verwachteGrootte;
                    }

                    InputStream in = verbinding.getInputStream();
                    FileOutputStream out = new FileOutputStream(doel);

                    byte[] buffer = new byte[64 * 1024];
                    long binnen = 0;
                    int laatstGemeld = -1;
                    int gelezen;

                    while ((gelezen = in.read(buffer)) != -1) {
                        out.write(buffer, 0, gelezen);
                        binnen += gelezen;

                        if (totaal > 0) {
                            int procent = (int) (binnen * 100 / totaal);
                            // Alleen bij een hele procent melden; anders
                            // sturen we honderden berichten per seconde naar
                            // de webview en wordt het scherm juist traag.
                            if (procent != laatstGemeld) {
                                laatstGemeld = procent;
                                JSObject stand = new JSObject();
                                stand.put("percent", procent);
                                notifyListeners("voortgang", stand);
                            }
                        }
                    }

                    out.flush();
                    out.close();
                    in.close();

                    if (verwachteGrootte > 0 && doel.length() != verwachteGrootte) {
                        doel.delete();
                        call.reject(
                            "De download is afgebroken (" + doel.length() + " van "
                            + verwachteGrootte + " bytes). Probeer het opnieuw.");
                        return;
                    }

                    // Oudere downloads opruimen: een tablet met vier oude
                    // APK's erop loopt vol, en niemand kijkt daar ooit.
                    File[] oud = updateMap().listFiles();
                    if (oud != null) {
                        for (File f : oud) {
                            if (!f.equals(doel)) {
                                f.delete();
                            }
                        }
                    }

                    JSObject uit = new JSObject();
                    uit.put("pad", doel.getAbsolutePath());
                    uit.put("grootte", doel.length());
                    call.resolve(uit);

                } catch (Exception e) {
                    doel.delete();
                    call.reject("Downloaden lukte niet: " + e.getMessage());
                } finally {
                    if (verbinding != null) {
                        verbinding.disconnect();
                    }
                }
            }
        });
    }

    /**
     * De installatie starten.
     *
     * Android laat geen bestandspad meer toe tussen apps, dus gaat het via de
     * FileProvider: een tijdelijk adres met leesrecht dat alleen voor deze
     * installatie geldt.
     */
    @PluginMethod
    public void installeren(PluginCall call) {
        String pad = call.getString("pad");
        if (pad == null || pad.isEmpty()) {
            call.reject("Geen bestand om te installeren.");
            return;
        }

        File bestand = new File(pad);
        if (!bestand.exists()) {
            call.reject("Het gedownloade bestand staat er niet meer.");
            return;
        }

        try {
            Uri adres = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                bestand);

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(adres, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            Activity activity = getActivity();
            if (activity != null) {
                activity.startActivity(intent);
            } else {
                getContext().startActivity(intent);
            }

            call.resolve();
        } catch (Exception e) {
            call.reject("De installatie kon niet gestart worden: " + e.getMessage());
        }
    }

    /** De huidige versie zoals hij in de APK staat. */
    @PluginMethod
    public void huidigeVersie(PluginCall call) {
        JSObject uit = new JSObject();
        try {
            String naam = getContext()
                .getPackageManager()
                .getPackageInfo(getContext().getPackageName(), 0)
                .versionName;
            uit.put("versie", naam);
        } catch (Exception e) {
            uit.put("versie", "");
        }
        call.resolve(uit);
    }
}
