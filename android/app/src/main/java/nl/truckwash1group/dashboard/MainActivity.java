package nl.truckwash1group.dashboard;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        /*
         * Een plugin die in de app zelf zit (en niet uit een npm-pakket
         * komt) vindt Capacitor niet vanzelf: die moet hier aangemeld
         * worden, en wel vóór super.onCreate -- daarna staat de brug al
         * en is de lijst met plugins dicht.
         */
        registerPlugin(ApkUpdater.class);
        super.onCreate(savedInstanceState);
    }
}
