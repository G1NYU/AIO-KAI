package org.tsugi.fixture;

import androidx.preference.CheckBoxPreference;
import androidx.preference.EditTextPreference;
import androidx.preference.ListPreference;
import androidx.preference.PreferenceScreen;
import androidx.preference.SwitchPreferenceCompat;
import eu.kanade.tachiyomi.source.ConfigurableSourceKt;

/** Original source settings and original loopback pages for recovery tests. */
public final class SettingsFixtureSource extends DownloadFixtureSource {
    @Override public String getName() { return "Tsugi Settings Fixture"; }

    @Override public void setupPreferenceScreen(PreferenceScreen screen) {
        // Deliberately precede supported controls with unsafe or unavailable
        // rows. Filtering must preserve the original engine positions.
        EditTextPreference secret = new EditTextPreference(screen.getContext());
        secret.setKey("fixture_secret");
        secret.setTitle("Original text setting");
        secret.setSummary("tsugi-ci-private-text-summary");
        secret.setDefaultValue("tsugi-ci-private-text-default");
        screen.addPreference(secret); // 0

        EditTextPreference layout = new EditTextPreference(screen.getContext());
        layout.setKey("fixture_layout");
        layout.setTitle("Original hidden layout control");
        layout.setDefaultValue("normal");
        layout.setVisible(false);
        screen.addPreference(layout); // 1: fixed, test-only mutation target

        SwitchPreferenceCompat hidden = new SwitchPreferenceCompat(screen.getContext());
        hidden.setKey("fixture_hidden");
        hidden.setTitle("Original hidden switch");
        hidden.setDefaultValue(true);
        hidden.setVisible(false);
        screen.addPreference(hidden); // 2

        CheckBoxPreference disabled = new CheckBoxPreference(screen.getContext());
        disabled.setKey("fixture_disabled");
        disabled.setTitle("Original disabled checkbox");
        disabled.setDefaultValue(true);
        disabled.setEnabled(false);
        screen.addPreference(disabled); // 3

        SwitchPreferenceCompat anonymous = new SwitchPreferenceCompat(screen.getContext());
        anonymous.setTitle("Original keyless switch");
        anonymous.setDefaultValue(true);
        screen.addPreference(anonymous); // 4: no key

        SwitchPreferenceCompat toggle = new SwitchPreferenceCompat(screen.getContext());
        toggle.setKey("fixture_switch");
        toggle.setTitle("Original switch");
        toggle.setSummary("Original Boolean setting");
        toggle.setDefaultValue(true);

        CheckBoxPreference checkbox = new CheckBoxPreference(screen.getContext());
        checkbox.setKey("fixture_checkbox");
        checkbox.setTitle("Original checkbox");
        checkbox.setDefaultValue(false);
        // The pinned engine ignores the listener's boolean return after
        // persisting. A false return alone must not be reported as failure.
        checkbox.setOnPreferenceChangeListener((preference, value) -> false);

        ListPreference selection = new ListPreference(screen.getContext());
        selection.setKey("fixture_list");
        selection.setTitle("Original list");
        selection.setDefaultValue("first");
        selection.setEntries(new CharSequence[] { "Original first option", "Original second option" });
        selection.setEntryValues(new CharSequence[] { "first", "second" });

        if ("reordered".equals(getSourcePreferences().getString("fixture_layout", "normal"))) {
            screen.addPreference(selection); // 5
            screen.addPreference(checkbox);  // 6
            screen.addPreference(toggle);    // 7
        } else {
            screen.addPreference(toggle);    // 5
            screen.addPreference(checkbox);  // 6
            screen.addPreference(selection); // 7
        }

        CheckBoxPreference failing = new CheckBoxPreference(screen.getContext());
        failing.setKey("fixture_throw");
        failing.setTitle("Original failing listener");
        failing.setDefaultValue(false);
        failing.setOnPreferenceChangeListener((preference, value) -> {
            if (Boolean.TRUE.equals(value)) {
                // The runtime already called saveNewValue/apply(). Commit a
                // second original side effect synchronously before throwing,
                // so displaced XML proves a real write preceded recovery.
                if (!preference.getSharedPreferences().edit()
                        .putBoolean("fixture_throw", true)
                        .putString("fixture_secret", "tsugi-ci-listener-mutated-private-text").commit()) {
                    throw new IllegalStateException("Original listener fixture commit failed");
                }
                // This separate store has no earlier async writer. It gives
                // deterministic evidence of an additional persisted side effect
                // even if the first store's apply/commit saves race each other.
                if (!ConfigurableSourceKt.sourcePreferences("tsugi_settings_listener").edit()
                        .putString("fixture_side_effect", "tsugi-ci-persisted-listener-side-effect").commit()) {
                    throw new IllegalStateException("Original listener side effect commit failed");
                }
                throw new IllegalStateException("Original fixture listener failed after save");
            }
            return true;
        });
        screen.addPreference(failing); // 8
    }
}
