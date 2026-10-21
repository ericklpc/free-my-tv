package io.sofa.firetv;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.view.accessibility.AccessibilityEvent;

/**
 * Fire OS doesn't let another app be the home screen: the Home button always opens Amazon's. This sees Amazon's home
 * come to the front and puts Sofá over it, so Home lands on Sofá. Back on Sofá's first screen still reaches Amazon's
 * home on purpose (HomeActivity.leave), and stays there until you open something else.
 */
public class HomeService extends AccessibilityService {
    private static final String AMAZON_HOME = "com.amazon.tv.launcher";

    /** Set when you leave Sofá for Amazon's home on purpose; cleared when another app comes up. */
    static volatile boolean stayOnAmazon;

    @Override public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED || e.getPackageName() == null) return;
        String pkg = e.getPackageName().toString();
        if (!AMAZON_HOME.equals(pkg)) {
            // Overlays (volume, the Home long-press menu) don't count as opening something else.
            if (!pkg.equals(getPackageName()) && !pkg.startsWith("com.android.systemui")) stayOnAmazon = false;
            return;
        }
        if (stayOnAmazon) return;
        startActivity(new Intent(this, HomeActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_NO_ANIMATION));
    }

    @Override public void onInterrupt() {}
}
