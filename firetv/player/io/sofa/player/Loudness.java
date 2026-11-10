package io.sofa.player;

import androidx.media3.common.C;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.audio.BaseAudioProcessor;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * A gentle volume leveler, so one film isn't much louder or quieter than the next: it follows the loudness of the
 * last ~10 s (silence left out) and moves it toward one level, by at most 8 dB either way and 1.5 dB a second, so a
 * scene's own quiet and loud parts stay as they are. A limiter keeps the boosted peaks from clipping.
 * 16-bit PCM only (what the stick's decoders and ffmpeg give); anything else passes through untouched.
 */
final class Loudness extends BaseAudioProcessor {
    private static final double TARGET = Math.pow(10, -21 / 20.0);           // RMS level everything goes to
    private static final double MIN_GAIN = Math.pow(10, -8 / 20.0), MAX_GAIN = Math.pow(10, 8 / 20.0);
    private static final double GATE = Math.pow(10, -45 / 20.0);             // quieter than this: silence, not measured
    private static final double CEILING = 0.89;                              // -1 dBFS
    private static final double BLOCK_S = 0.05;

    private int channels, rate, blockFrames, frames;
    private double blockSum, power = -1, gain = 1, limit = 1, heard;

    @Override protected AudioFormat onConfigure(AudioFormat in) {
        if (in.encoding != C.ENCODING_PCM_16BIT) return AudioFormat.NOT_SET;
        channels = in.channelCount; rate = in.sampleRate;
        blockFrames = Math.max(1, (int) (rate * BLOCK_S));
        return in;
    }

    @Override public void queueInput(ByteBuffer input) {
        int n = input.remaining();
        if (n == 0) return;
        ByteBuffer out = replaceOutputBuffer(n);
        input.order(ByteOrder.LITTLE_ENDIAN);
        double release = 1 - Math.exp(-1 / (0.08 * rate));                    // the limiter lets go in ~80 ms
        while (input.remaining() >= 2 * channels) {
            double peak = 0;
            int at = input.position();
            for (int c = 0; c < channels; c++) {
                double x = input.getShort(at + 2 * c) / 32768.0;
                blockSum += x * x;
                double y = Math.abs(x * gain);
                if (y > peak) peak = y;
            }
            if (peak * limit > CEILING) limit = CEILING / peak; else limit += (1 - limit) * release;
            double g = gain * limit;
            for (int c = 0; c < channels; c++) {
                int v = (int) Math.round(input.getShort() * g);
                out.putShort((short) Math.max(-32768, Math.min(32767, v)));
            }
            if (++frames >= blockFrames) block();
        }
        input.position(input.limit());
        out.flip();
    }

    // Every 50 ms: update the loudness estimate (fast at the start, then over ~10 s) and step the gain toward it.
    private void block() {
        double ms = blockSum / (frames * channels);
        blockSum = 0; frames = 0;
        if (ms < GATE * GATE) return;
        heard += BLOCK_S;
        double tau = Math.min(10, Math.max(1, heard));
        power = power < 0 ? ms : power + (ms - power) * (BLOCK_S / tau);
        double want = Math.max(MIN_GAIN, Math.min(MAX_GAIN, TARGET / Math.sqrt(power)));
        double step = Math.pow(10, 1.5 * BLOCK_S / 20);                    // 1.5 dB a second
        gain = want > gain ? Math.min(want, gain * step) : Math.max(want, gain / step);
    }

    @Override protected void onReset() {
        power = -1; gain = 1; limit = 1; heard = 0; blockSum = 0; frames = 0;
    }
}
